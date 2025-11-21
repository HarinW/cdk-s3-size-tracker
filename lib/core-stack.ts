import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

export class CoreStack extends cdk.Stack {
  public readonly dataBucket: s3.Bucket;
  public readonly plotBucket: s3.Bucket;
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'CdkS3SizeTrackerQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    // S3 Bucket
    this.dataBucket = new s3.Bucket(this, "DataBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      eventBridgeEnabled: true,
    });

    this.plotBucket = new s3.Bucket(this, "PlotBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // DynamoDB table with PK/SK and a GSI for max(total_size)
    this.table = new dynamodb.Table(this, "SizeHistoryTable", {
      partitionKey: { name: "bucket", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "ts", type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "gsi_size",
      partitionKey: { name: "bucket", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "total_size", type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, "BucketName", {
      value: this.dataBucket.bucketName,
    });
    new cdk.CfnOutput(this, "PlotBucketName", {
      value: this.plotBucket.bucketName,
    });
    new cdk.CfnOutput(this, "TableName", { value: this.table.tableName });
  }
}
