#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CoreStack } from "../lib/core-stack";
import { FunctionsStack } from "../lib/functions-stack";
import { ApiStack } from "../lib/api-stack";
import { EventsStack } from "../lib/events-stack";

const app = new cdk.App();

const core = new CoreStack(app, "SizeTracker-CoreStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

const funcs = new FunctionsStack(app, "SizeTracker-FunctionsStack", {
  // bucket: core.bucket,
  // table: core.table,
  bucketArn: core.bucket.bucketArn,
  tableArn: core.table.tableArn,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

const api = new ApiStack(app, "SizeTracker-ApiStack", {
  plottingLambdaArn: funcs.plottingLambda.functionArn,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

// funcs.driverLambda.addEnvironment(
//   "PLOTTING_API_URL",
//   api.httpApi.apiEndpoint + "/plot"
// );

// new CdkS3SizeTrackerStack(app, "CdkS3SizeTrackerStack", {
//   /* If you don't specify 'env', this stack will be environment-agnostic.
//    * Account/Region-dependent features and context lookups will not work,
//    * but a single synthesized template can be deployed anywhere. */
//   /* Uncomment the next line to specialize this stack for the AWS Account
//    * and Region that are implied by the current CLI configuration. */
//   // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
//   /* Uncomment the next line if you know exactly what Account and Region you
//    * want to deploy the stack to. */
//   // env: { account: '123456789012', region: 'us-east-1' },
//   /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
// });
