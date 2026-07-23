import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendSrc = path.join(__dirname, "../../backend/src");
const frontendDist = path.join(__dirname, "../../frontend/dist");

/** One-time setup (free, SecureString can't be created by CloudFormation):
 *  aws ssm put-parameter --name /drafthelper/session-secret --type SecureString \
 *    --value "$(openssl rand -hex 32)"
 */
const SESSION_SECRET_PARAM = "/drafthelper/session-secret";

// Existing public zone in this account. The CloudFront certificate below
// requires this stack to deploy in us-east-1.
const DOMAIN_NAME = "draft.clanseafox.com";
const HOSTED_ZONE_ID = "Z0101414E73U97CTHC5N";
const HOSTED_ZONE_NAME = "clanseafox.com";

export class DraftHelperStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ── Data ────────────────────────────────────────────────────────────
    const table = new dynamodb.Table(this, "Table", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Flip to RETAIN before real draft data lives here.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ── Static site ─────────────────────────────────────────────────────
    const siteBucket = new s3.Bucket(this, "Site", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── API Lambda ──────────────────────────────────────────────────────
    const apiFn = new NodejsFunction(this, "Api", {
      entry: path.join(backendSrc, "lambda.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: table.tableName,
        SESSION_SECRET_PARAM,
      },
    });
    table.grantReadWriteData(apiFn);
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          this.formatArn({
            service: "ssm",
            resource: `parameter${SESSION_SECRET_PARAM}`,
          }),
        ],
      })
    );

    const apiUrl = apiFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });

    // ── players-refresh Lambda ──────────────────────────────────────────
    const refreshFn = new NodejsFunction(this, "PlayersRefresh", {
      entry: path.join(backendSrc, "players/refresh.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024, // Sleeper dump is ~15 MB of JSON to parse
      timeout: Duration.minutes(2),
      environment: { SITE_BUCKET: siteBucket.bucketName },
    });
    siteBucket.grantPut(refreshFn);
    new events.Rule(this, "PlayersRefreshSchedule", {
      schedule: events.Schedule.rate(Duration.days(7)),
      targets: [new targets.LambdaFunction(refreshFn)],
    });

    // ── CloudFront: one domain, SPA + /api/* ────────────────────────────
    // Path-less requests (SPA routes) rewrite to index.html via a viewer
    // function instead of distribution-wide 403 error responses, which would
    // also mask real API error codes.
    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          if (!request.uri.includes(".") && !request.uri.startsWith("/api/")) {
            request.uri = "/index.html";
          }
          return request;
        }
      `),
    });

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: HOSTED_ZONE_ID,
      zoneName: HOSTED_ZONE_NAME,
    });

    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: DOMAIN_NAME,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      domainNames: [DOMAIN_NAME],
      certificate,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          {
            function: spaRewrite,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(apiUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Forward everything except Host (Lambda URLs reject a foreign Host),
          // including cookies and query strings.
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: "index.html",
    });

    // Deploy the built SPA when it exists (build frontend before deploy;
    // synth still works without it).
    if (existsSync(frontendDist)) {
      new s3deploy.BucketDeployment(this, "SiteDeployment", {
        sources: [s3deploy.Source.asset(frontendDist)],
        destinationBucket: siteBucket,
        distribution,
        // players.json is refreshed by the Lambda, not the deploy; don't prune it.
        prune: false,
      });
    }

    const aliasTarget = route53.RecordTarget.fromAlias(
      new route53targets.CloudFrontTarget(distribution)
    );
    new route53.ARecord(this, "AliasRecord", {
      zone,
      recordName: DOMAIN_NAME,
      target: aliasTarget,
    });
    new route53.AaaaRecord(this, "AliasRecordV6", {
      zone,
      recordName: DOMAIN_NAME,
      target: aliasTarget,
    });

    new CfnOutput(this, "AppUrl", { value: `https://${DOMAIN_NAME}` });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "PlayersRefreshFunction", {
      value: refreshFn.functionName,
    });
  }
}
