#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CoreStack } from "../lib/core-stack";
import { FunctionsStack } from "../lib/functions-stack";
import { ApiStack } from "../lib/api-stack";
import { EventsStack } from "../lib/events-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const core = new CoreStack(app, "SizeTracker-CoreStack", { env });

const events = new EventsStack(app, "SizeTracker-EventsStack", {
  bucketArn: core.dataBucket.bucketArn,
  env,
});

const funcs = new FunctionsStack(app, "SizeTracker-FunctionsStack", {
  // bucket: core.dataBucket,
  // table: core.table,
  dataBucketArn: core.dataBucket.bucketArn,
  plotBucketArn: core.plotBucket.bucketArn,
  tableArn: core.table.tableArn,
  // queues from Events stack (as ARNs)
  sizeQueueArn: events.sizeQueue.queueArn,
  logQueueArn: events.logQueue.queueArn,
  env,
});

const api = new ApiStack(app, "SizeTracker-ApiStack", {
  plottingLambdaArn: funcs.plottingLambda.functionArn,
  env,
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
