import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { Architecture, Runtime, Function, Code } from 'aws-cdk-lib/aws-lambda';
import { 
  HttpApi, 
  HttpMethod, 
  CorsHttpMethod 
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { IAuth } from '../../temp-bedrock-chat/constructs/auth';
import { PptxDb } from '../pptx-db';
import * as path from 'path';

export interface PptxApiProps {
  readonly api: HttpApi;
  readonly auth: IAuth;
  readonly pptxDb: PptxDb;
  readonly templatesBucket: IBucket;
  readonly outputsBucket: IBucket;
  readonly generationQueue: IQueue;
  readonly corsAllowOrigins?: string[];
}

export class PptxApi extends Construct {
  constructor(scope: Construct, id: string, props: PptxApiProps) {
    super(scope, id);

    const { api, auth, pptxDb, templatesBucket, outputsBucket, generationQueue } = props;
    const corsAllowOrigins = props.corsAllowOrigins || ['*'];

    // Create authorizer
    const authorizer = new HttpUserPoolAuthorizer('PptxAuthorizer', 
      auth.userPool,
      {
        userPoolClients: [auth.client],
      }
    );

    // Create shared IAM role for Lambda functions
    const lambdaRole = new iam.Role(this, 'PptxLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant DynamoDB permissions
    pptxDb.templatesTable.grantFullAccess(lambdaRole);
    pptxDb.generationsTable.grantFullAccess(lambdaRole);

    // Grant S3 permissions
    templatesBucket.grantReadWrite(lambdaRole);
    outputsBucket.grantReadWrite(lambdaRole);

    // Grant SQS permissions
    generationQueue.grantSendMessages(lambdaRole);

    // Common Lambda props
    const commonLambdaProps = {
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.X86_64,
      timeout: Duration.minutes(1),
      role: lambdaRole,
      environment: {
        PPTX_TEMPLATES_TABLE: pptxDb.templatesTable.tableName,
        PPTX_GENERATIONS_TABLE: pptxDb.generationsTable.tableName,
        PPTX_TEMPLATES_BUCKET: templatesBucket.bucketName,
        PPTX_OUTPUTS_BUCKET: outputsBucket.bucketName,
        PPTX_GENERATION_QUEUE: generationQueue.queueUrl,
      },
    };

    // Template Upload URL Lambda
    const getTemplateUploadUrlLambda = new Function(this, 'GetTemplateUploadUrl', {
      ...commonLambdaProps,
      code: Code.fromAsset(path.join(__dirname, '../../lambda/pptx')),
      handler: 'getTemplateUploadUrl.handler',
    });

    // Create Template Lambda
    const createTemplateLambda = new Function(this, 'CreateTemplate', {
      ...commonLambdaProps,
      code: Code.fromAsset(path.join(__dirname, '../../lambda/pptx')),
      handler: 'createTemplate.handler',
    });

    // List Templates Lambda
    const listTemplatesLambda = new Function(this, 'ListTemplates', {
      ...commonLambdaProps,
      code: Code.fromAsset(path.join(__dirname, '../../lambda/pptx')),
      handler: 'listTemplates.handler',
    });

    // Delete Template Lambda
    const deleteTemplateLambda = new Function(this, 'DeleteTemplate', {
      ...commonLambdaProps,
      code: Code.fromAsset(path.join(__dirname, '../../lambda/pptx')),
      handler: 'deleteTemplate.handler',
    });

    // Generate PPTX Lambda
    const generatePptxLambda = new Function(this, 'GeneratePptx', {
      ...commonLambdaProps,
      code: Code.fromAsset(path.join(__dirname, '../../lambda/pptx')),
      handler: 'generatePptx.handler',
    });

    // Get Generation Status Lambda
    const getGenerationStatusLambda = new Function(this, 'GetGenerationStatus', {
      ...commonLambdaProps,
      code: Code.fromAsset(path.join(__dirname, '../../lambda/pptx')),
      handler: 'getGenerationStatus.handler',
    });

    // List Generations Lambda
    const listGenerationsLambda = new Function(this, 'ListGenerations', {
      ...commonLambdaProps,
      code: Code.fromAsset(path.join(__dirname, '../../lambda/pptx')),
      handler: 'listGenerations.handler',
    });

    // Download PPTX Lambda
    const downloadPptxLambda = new Function(this, 'DownloadPptx', {
      ...commonLambdaProps,
      code: Code.fromAsset(path.join(__dirname, '../../lambda/pptx')),
      handler: 'downloadPptx.handler',
    });

    // API Routes
    // Template upload URL
    api.addRoutes({
      path: '/pptx/template/upload-url',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('GetTemplateUploadUrlIntegration', getTemplateUploadUrlLambda),
      authorizer,
    });

    // Create template
    api.addRoutes({
      path: '/pptx/template',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('CreateTemplateIntegration', createTemplateLambda),
      authorizer,
    });

    // List templates
    api.addRoutes({
      path: '/pptx/template',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListTemplatesIntegration', listTemplatesLambda),
      authorizer,
    });

    // Delete template
    api.addRoutes({
      path: '/pptx/template/{templateId}',
      methods: [HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('DeleteTemplateIntegration', deleteTemplateLambda),
      authorizer,
    });

    // Generate PPTX
    api.addRoutes({
      path: '/pptx/generate',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('GeneratePptxIntegration', generatePptxLambda),
      authorizer,
    });

    // Get generation status
    api.addRoutes({
      path: '/pptx/generation/{generationId}',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetGenerationStatusIntegration', getGenerationStatusLambda),
      authorizer,
    });

    // List generations
    api.addRoutes({
      path: '/pptx/generation',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListGenerationsIntegration', listGenerationsLambda),
      authorizer,
    });

    // Download PPTX
    api.addRoutes({
      path: '/pptx/download/{generationId}',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('DownloadPptxIntegration', downloadPptxLambda),
      authorizer,
    });

    // Enable CORS for all routes
    const corsOptions = {
      allowCredentials: true,
      allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      allowMethods: [
        CorsHttpMethod.OPTIONS,
        CorsHttpMethod.GET,
        CorsHttpMethod.POST,
        CorsHttpMethod.PUT,
        CorsHttpMethod.DELETE,
      ],
      allowOrigins: corsAllowOrigins,
      exposeHeaders: ['Date'],
      maxAge: Duration.days(10),
    };

    // Note: CORS is typically handled at the HttpApi level, not per route
    // The specific CORS configuration would be applied when creating the HttpApi
  }
}