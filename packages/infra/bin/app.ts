import { App } from "aws-cdk-lib";
import { CiStack } from "../lib/ci-stack.js";
import { DraftHelperStack } from "../lib/drafthelper-stack.js";

const app = new App();
// Pinned: the CloudFront ACM certificate must live in us-east-1.
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: "us-east-1",
};
new DraftHelperStack(app, "DraftHelper", { env });
new CiStack(app, "DraftHelperCi", { env });
