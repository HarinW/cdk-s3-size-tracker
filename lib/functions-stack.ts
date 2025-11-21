import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

import * as sqs from "aws-cdk-lib/aws-sqs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";

// import * as events from "aws-cdk-lib/aws-events";
// import * as targets from "aws-cdk-lib/aws-events-targets";

import * as path from "path";
import * as iam from "aws-cdk-lib/aws-iam";

const plotParamName = "/size-tracker/plot-url";

interface FunctionsStackProps extends cdk.StackProps {
  dataBucketArn: string;
  plotBucketArn: string;
  tableArn: string;
  sizeQueueArn: string;
  logQueueArn: string;
}

export class FunctionsStack extends cdk.Stack {
  public readonly driverLambda: lambda.Function;
  public readonly sizeTrackingLambda: lambda.Function;
  public readonly plottingLambda: lambda.Function;

  public readonly loggingLambda: lambda.Function;
  public readonly cleanerLambda: lambda.Function;

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

    const dataBucket = s3.Bucket.fromBucketArn(
      this,
      "DataBucket",
      props.dataBucketArn
    );

    const plotBucket = s3.Bucket.fromBucketArn(
      this,
      "PlotBucket",
      props.plotBucketArn
    );

    const table = dynamodb.Table.fromTableArn(
      this,
      "ImportedTable",
      props.tableArn
    );

    const sizeQueue = sqs.Queue.fromQueueArn(
      this,
      "ImportedSizeQueue",
      props.sizeQueueArn
    );
    const logQueue = sqs.Queue.fromQueueArn(
      this,
      "ImportedLogQueue",
      props.logQueueArn
    );

    const dataBucketName =
      (dataBucket as any).bucketName ??
      cdk.Token.asString(dataBucket.bucketArn);
    const plotBucketName =
      (plotBucket as any).bucketName ??
      cdk.Token.asString(plotBucket.bucketArn);
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

    // ---- Lambdas ----

    // Size-Tracking Lambda Function
    this.sizeTrackingLambda = new lambda.Function(this, "SizeTrackingLambda", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "size_tracking_lambda.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/size_tracking")),
      timeout: cdk.Duration.seconds(20),
      memorySize: 512,
      environment: {
        DDB_TABLE: tableName,
        BUCKET_NAME: dataBucketName,
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
        DATA_BUCKET: dataBucketName,
        PLOT_BUCKET: plotBucketName,
        PLOT_KEY: "plot",
        WINDOW_SECONDS: "60", // adjust time window
      },
      layers: matplotlibLayer ? [matplotlibLayer] : undefined,
    });

    // Logging Lambda Function
    this.loggingLambda = new lambda.Function(this, "LoggingLambda", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "logging_lambda.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/logging")),
      timeout: cdk.Duration.seconds(20),
      memorySize: 256,
    });

    // Cleaner Lambda Function
    this.cleanerLambda = new lambda.Function(this, "CleanerLambda", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "cleaner_lambda.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/cleaner")),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        BUCKET_NAME: dataBucketName,
      },
    });

    // Driver Lambda
    this.driverLambda = new lambda.Function(this, "DriverLambda", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "driver_lambda.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/driver")),
      timeout: cdk.Duration.seconds(900), // adjusted for longer sleeps
      memorySize: 512,
      environment: {
        BUCKET_NAME: dataBucketName,
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

    // Logging Lambda needs CW Logs read to backfill deleted object size
    this.loggingLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["logs:FilterLogEvents"],
        resources: [
          `arn:${cdk.Aws.PARTITION}:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/*`,
        ],
      })
    );

    // Permissions
    dataBucket.grantRead(this.sizeTrackingLambda); // includes ListBucket/GetObject
    table.grantWriteData(this.sizeTrackingLambda); // PutItem

    table.grantReadData(this.plottingLambda); // Query (table + GSI)
    plotBucket.grantWrite(this.plottingLambda); // PutObject (for the plot)

    dataBucket.grantWrite(this.driverLambda); // Put/Delete objects

    dataBucket.grantReadWrite(this.cleanerLambda); // Read/Delete objects
    // S3 → Size-tracking notifications
    // const rule = new events.Rule(this, "S3EventsToSizeTracker", {
    //   eventPattern: {
    //     source: ["aws.s3"],
    //     detailType: ["Object Created", "Object Deleted"],
    //     detail: { bucket: { name: [(bucket as any).bucketName] } },
    //   },
    // });
    // rule.addTarget(new targets.LambdaFunction(this.sizeTrackingLambda));

    // ---- Event sources (SQS) ----
    this.sizeTrackingLambda.addEventSource(
      new SqsEventSource(sizeQueue, { batchSize: 5 })
    );

    this.loggingLambda.addEventSource(
      new SqsEventSource(logQueue, { batchSize: 5 })
    );

    // ---- CloudWatch Metric Filter (extract size_delta) ----
    const loggingGroup = logs.LogGroup.fromLogGroupName(
      this,
      "LoggingGroup",
      `/aws/lambda/${this.loggingLambda.functionName}`
    );

    new logs.MetricFilter(this, "SizeDeltaMetricFilter", {
      logGroup: loggingGroup,
      metricNamespace: "Assignment4App",
      metricName: "TotalObjectSize",
      filterPattern: logs.FilterPattern.literal("{$.size_delta = *}"),
      metricValue: "$.size_delta", // from the JSON log
    });

    // ---- Alarm on SUM > 20, fire Cleaner ----
    const metric = new cloudwatch.Metric({
      namespace: "Assignment4App",
      metricName: "TotalObjectSize",
      statistic: "sum",
      period: cdk.Duration.minutes(1), // shortest possible period
    });

    const alarm = new cloudwatch.Alarm(this, "TotalSizeAlarm", {
      metric,
      threshold: 20,
      evaluationPeriods: 1, // period within 1 min requires high-resolution alarms
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cw_actions.LambdaAction(this.cleanerLambda));

    new cdk.CfnOutput(this, "DriverLambdaName", {
      value: this.driverLambda.functionName,
    });
    new cdk.CfnOutput(this, "PlottingLambdaName", {
      value: this.plottingLambda.functionName,
    });
    new cdk.CfnOutput(this, "SizeTrackingLambdaName", {
      value: this.sizeTrackingLambda.functionName,
    });
    new cdk.CfnOutput(this, "LoggingLambdaName", {
      value: this.loggingLambda.functionName,
    });
    new cdk.CfnOutput(this, "CleanerLambdaName", {
      value: this.cleanerLambda.functionName,
    });
  }
}
