import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from "aws-cdk-lib/aws-lambda";
// import * as s3n from "aws-cdk-lib/aws-s3-notifications";
// import { S3EventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as path from "path";

import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";

import * as iam from "aws-cdk-lib/aws-iam";

const plotParamName = "/size-tracker/plot-url";

interface FunctionsStackProps extends cdk.StackProps {
  bucketArn: string;
  tableArn: string;
}

export class FunctionsStack extends cdk.Stack {
  public readonly driverLambda: lambda.Function;
  public readonly sizeTrackingLambda: lambda.Function;
  public readonly plottingLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: FunctionsStackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'CdkS3SizeTrackerQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
    const matplotlibLayerArn = this.node.tryGetContext("matplotlibLayerArn") as
      | string
      | undefined;
    const matplotlibLayer = matplotlibLayerArn
      ? lambda.LayerVersion.fromLayerVersionArn(
          this,
          "MatplotlibLayer",
          matplotlibLayerArn
        )
      : undefined;

    const bucket = s3.Bucket.fromBucketAttributes(this, "ImportedBucket", {
      bucketArn: props.bucketArn,
    });

    const table = dynamodb.Table.fromTableArn(
      this,
      "ImportedTable",
      props.tableArn
    );

    const bucketName =
      (bucket as any).bucketName ?? cdk.Token.asString(bucket.bucketArn);
    const tableName =
      (table as any).tableName ?? cdk.Token.asString(table.tableArn);
    // Compose the index ARN (all GSIs on this table)
    const indexArn = cdk.Arn.format(
      {
        service: "dynamodb",
        resource: "table",
        resourceName: `${tableName}/index/*`,
        partition: cdk.Aws.PARTITION,
        region: cdk.Aws.REGION,
        account: cdk.Aws.ACCOUNT_ID,
      },
      this
    );

    // Size-Tracking Lambda Function
    this.sizeTrackingLambda = new lambda.Function(this, "SizeTrackingLambda", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "size_tracking_lambda.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/size_tracking")),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        DDB_TABLE: tableName,
        BUCKET_NAME: bucketName,
      },
    });

    // Plotting Lambda Function
    this.plottingLambda = new lambda.Function(this, "PlottingLambda", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "plotting_lambda.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/plotting")),
      timeout: cdk.Duration.seconds(60),
      memorySize: 1536,
      environment: {
        DDB_TABLE: tableName,
        BUCKET_NAME: bucketName,
        PLOT_KEY: "plot",
      },
      layers: matplotlibLayer ? [matplotlibLayer] : undefined,
    });

    // Driver Lambda
    this.driverLambda = new lambda.Function(this, "DriverLambda", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "driver_lambda.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/driver")),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        BUCKET_NAME: bucketName,
        PLOTTING_API_PARAM: plotParamName,
      },
    });

    // Extra allow for GSI reads
    this.plottingLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:DescribeTable"],
        resources: [table.tableArn, indexArn],
      })
    );

    // IAM: allow GetParameter on that SSM parameter
    this.driverLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter${plotParamName}`,
        ],
      })
    );

    // Permissions
    bucket.grantRead(this.sizeTrackingLambda); // includes ListBucket/GetObject
    table.grantWriteData(this.sizeTrackingLambda); // PutItem

    table.grantReadData(this.plottingLambda); // Query (table + GSI)
    bucket.grantWrite(this.plottingLambda); // PutObject (for the plot)

    bucket.grantWrite(this.driverLambda); // Put/Delete objects

    // S3 → Size-tracking notifications
    const rule = new events.Rule(this, "S3EventsToSizeTracker", {
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created", "Object Deleted"],
        detail: { bucket: { name: [(bucket as any).bucketName] } },
      },
    });
    rule.addTarget(new targets.LambdaFunction(this.sizeTrackingLambda));

    // props.bucket.addEventNotification(
    //   s3.EventType.OBJECT_CREATED,
    //   new s3n.LambdaDestination(this.sizeTrackingLambda)
    // );
    // props.bucket.addEventNotification(
    //   s3.EventType.OBJECT_REMOVED,
    //   new s3n.LambdaDestination(this.sizeTrackingLambda)
    // );

    // const s3Source = new S3EventSource(props.bucket, {
    //   events: [s3.EventType.OBJECT_CREATED, s3.EventType.OBJECT_REMOVED],
    // });
    // this.sizeTrackingLambda.addEventSource(s3Source);

    new cdk.CfnOutput(this, "DriverLambdaName", {
      value: this.driverLambda.functionName,
    });
    new cdk.CfnOutput(this, "PlottingLambdaName", {
      value: this.plottingLambda.functionName,
    });
    new cdk.CfnOutput(this, "SizeTrackingLambdaName", {
      value: this.sizeTrackingLambda.functionName,
    });
  }
}
