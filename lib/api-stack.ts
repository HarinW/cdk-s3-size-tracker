import { AddEventListenerOptions } from "./../node_modules/undici-types/patch.d";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";

import * as ssm from "aws-cdk-lib/aws-ssm";

interface ApiStackProps extends cdk.StackProps {
  plottingLambdaArn: string;
}

export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'CdkS3SizeTrackerQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    // Import existing lambda by ARN
    const plottingLambda = lambda.Function.fromFunctionArn(
      this,
      "ImportedPlottingLambda",
      props.plottingLambdaArn
    );

    // Define HTTP API
    this.httpApi = new apigwv2.HttpApi(this, "PlotHttpApi", {
      apiName: "S3SizePlotApi",
      createDefaultStage: true, // $default (no stage path)
    });

    const integration = new integrations.HttpLambdaIntegration(
      "PlotIntegration",
      plottingLambda
    );

    this.httpApi.addRoutes({
      path: "/plot",
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });

    const plotUrl = `${this.httpApi.apiEndpoint}/plot`;
    // Use a fixed parameter name to avoid cross-stack refs:
    const paramName = "/size-tracker/plot-url";
    new ssm.StringParameter(this, "PlotApiUrlParam", {
      parameterName: paramName,
      stringValue: plotUrl,
    });

    new cdk.CfnOutput(this, "PlotApiUrlParameterName", { value: paramName });
    new cdk.CfnOutput(this, "InvokeUrl", { value: plotUrl });
  }
}
