import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

const GITHUB_REPO = "genghis/draft-helper";

/**
 * Deploy role for GitHub Actions, assumed via the account's existing GitHub
 * OIDC provider. It can only pass through to the CDK bootstrap roles, which
 * hold the actual deploy permissions.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const providerArn = this.formatArn({
      service: "iam",
      region: "",
      resource: "oidc-provider/token.actions.githubusercontent.com",
    });

    const role = new iam.Role(this, "DeployRole", {
      roleName: "drafthelper-github-deploy",
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": `repo:${GITHUB_REPO}:ref:refs/heads/main`,
        },
      }),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          this.formatArn({ service: "iam", region: "", resource: "role/cdk-*" }),
        ],
      })
    );

    new CfnOutput(this, "DeployRoleArn", { value: role.roleArn });
  }
}
