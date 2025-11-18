// lib/events-stack.ts
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as sqs from "aws-cdk-lib/aws-sqs";

interface EventsStackProps extends cdk.StackProps {
  bucket: s3.IBucket; // from CoreStack
}

export class EventsStack extends cdk.Stack {
  public readonly topic: sns.Topic;
  public readonly sizeQueue: sqs.Queue;
  public readonly logQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: EventsStackProps) {
    super(scope, id, props);

    // SNS topic
    this.topic = new sns.Topic(this, "S3EventsTopic", {
      displayName: "S3 Events Fanout",
    });

    // Two SQS queues (one per consumer)
    this.sizeQueue = new sqs.Queue(this, "SizeTrackingQueue", {
      visibilityTimeout: cdk.Duration.seconds(120),
      retentionPeriod: cdk.Duration.days(1),
    });

    this.logQueue = new sqs.Queue(this, "LoggingQueue", {
      visibilityTimeout: cdk.Duration.seconds(120),
      retentionPeriod: cdk.Duration.days(1),
    });

    // Subscribe both queues; use RawMessageDelivery so queue body == S3 event JSON
    this.topic.addSubscription(
      new subs.SqsSubscription(this.sizeQueue, { rawMessageDelivery: true })
    );
    this.topic.addSubscription(
      new subs.SqsSubscription(this.logQueue, { rawMessageDelivery: true })
    );

    // S3 -> SNS notifications
    props.bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(this.topic)
    );
    props.bucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3n.SnsDestination(this.topic)
    );

    new cdk.CfnOutput(this, "TopicArn", { value: this.topic.topicArn });
    new cdk.CfnOutput(this, "SizeQueueArn", { value: this.sizeQueue.queueArn });
    new cdk.CfnOutput(this, "LogQueueArn", { value: this.logQueue.queueArn });
  }
}
