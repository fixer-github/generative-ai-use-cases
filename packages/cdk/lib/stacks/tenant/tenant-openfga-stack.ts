import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

export interface TenantOpenFgaStackProps extends cdk.StackProps {
  /**
   * The tenant identifier
   */
  readonly tenantId: string;

  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * The VPC to deploy OpenFGA into
   */
  readonly vpc: ec2.IVpc;

  /**
   * Private subnets for RDS and ECS
   */
  readonly subnets: ec2.ISubnet[];

  /**
   * Removal policy for stateful resources
   */
  readonly removalPolicy: cdk.RemovalPolicy;

  /**
   * Control plane Lambda role ARN for cross-account access
   */
  readonly controlPlaneLambdaRoleArn?: string;

  /**
   * Description for the stack
   */
  readonly description?: string;
}

/**
 * Stack that creates OpenFGA authorization system for a tenant
 * This includes RDS PostgreSQL, ECS Fargate, NLB, and API Gateway
 */
export class TenantOpenFgaStack extends cdk.Stack {
  /**
   * The API Gateway endpoint for OpenFGA
   */
  public readonly apiEndpoint: string;

  /**
   * The API Gateway ID
   */
  public readonly apiGatewayId: string;

  /**
   * The OpenFGA database endpoint
   */
  public readonly databaseEndpoint: string;

  /**
   * The OpenFGA Store ID
   */
  public readonly storeId: string;

  constructor(scope: Construct, id: string, props: TenantOpenFgaStackProps) {
    super(scope, id, props);

    // Create security group for RDS
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'OpenFgaDbSecurityGroup', {
      vpc: props.vpc,
      description: `Security group for OpenFGA PostgreSQL database (tenant: ${props.tenantId})`,
      allowAllOutbound: false,
    });

    // Create security group for ECS
    const ecsSecurityGroup = new ec2.SecurityGroup(
      this,
      'OpenFgaEcsSecurityGroup',
      {
        vpc: props.vpc,
        description: `Security group for OpenFGA ECS tasks (tenant: ${props.tenantId})`,
        allowAllOutbound: true,
      }
    );

    // Allow ECS to connect to RDS
    dbSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow ECS tasks to connect to PostgreSQL'
    );

    // Allow NLB to connect to ECS tasks on port 8080
    ecsSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(8080),
      'Allow NLB health checks and traffic to OpenFGA HTTP server'
    );

    // Create database credentials secret
    const dbCredentialsSecret = new secretsmanager.Secret(
      this,
      'OpenFgaDbCredentials',
      {
        secretName: `${props.environment}-${props.tenantId}-openfga-db-credentials`,
        description: `OpenFGA database credentials for tenant ${props.tenantId}`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            username: 'openfga',
          }),
          generateStringKey: 'password',
          excludePunctuation: true,
          includeSpace: false,
          passwordLength: 32,
        },
        removalPolicy: props.removalPolicy,
      }
    );

    // Create RDS PostgreSQL instance for OpenFGA
    const dbInstance = new rds.DatabaseInstance(this, 'OpenFgaDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      vpc: props.vpc,
      vpcSubnets: {
        subnets: props.subnets,
      },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbCredentialsSecret),
      databaseName: 'openfga',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      removalPolicy: props.removalPolicy,
      deletionProtection: props.removalPolicy === cdk.RemovalPolicy.RETAIN,
      backupRetention:
        props.removalPolicy === cdk.RemovalPolicy.RETAIN
          ? cdk.Duration.days(7)
          : cdk.Duration.days(1),
      preferredBackupWindow: '03:00-04:00',
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
      enablePerformanceInsights: true,
      performanceInsightRetention:
        props.removalPolicy === cdk.RemovalPolicy.RETAIN
          ? rds.PerformanceInsightRetention.DEFAULT
          : rds.PerformanceInsightRetention.DEFAULT,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention:
        props.removalPolicy === cdk.RemovalPolicy.RETAIN
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.ONE_WEEK,
    });

    this.databaseEndpoint = dbInstance.dbInstanceEndpointAddress;

    // Create ECS cluster
    const cluster = new ecs.Cluster(this, 'OpenFgaCluster', {
      vpc: props.vpc,
      clusterName: `${props.environment}-${props.tenantId}-openfga`,
      containerInsights: true,
    });

    // Create task definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'OpenFgaTaskDefinition',
      {
        memoryLimitMiB: 512,
        cpu: 256,
      }
    );

    // Grant read access to the database credentials
    dbCredentialsSecret.grantRead(taskDefinition.taskRole);

    // Add OpenFGA container
    const container = taskDefinition.addContainer('OpenFgaContainer', {
      image: ecs.ContainerImage.fromRegistry('openfga/openfga:v1.8.0'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'openfga',
        logRetention:
          props.removalPolicy === cdk.RemovalPolicy.RETAIN
            ? logs.RetentionDays.ONE_MONTH
            : logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        OPENFGA_DATASTORE_ENGINE: 'postgres',
        // Use placeholder credentials in URI - these will be overridden by secrets
        OPENFGA_DATASTORE_URI: `postgres://placeholder:placeholder@${dbInstance.dbInstanceEndpointAddress}/openfga`,
        OPENFGA_LOG_FORMAT: 'json',
        OPENFGA_PLAYGROUND_ENABLED: 'false',
        OPENFGA_HTTP_ADDR: '0.0.0.0:8080',
        OPENFGA_GRPC_ADDR: '0.0.0.0:8081',
      },
      secrets: {
        // These environment variables override the credentials in OPENFGA_DATASTORE_URI
        OPENFGA_DATASTORE_USERNAME: ecs.Secret.fromSecretsManager(
          dbCredentialsSecret,
          'username'
        ),
        OPENFGA_DATASTORE_PASSWORD: ecs.Secret.fromSecretsManager(
          dbCredentialsSecret,
          'password'
        ),
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          'wget --no-verbose --tries=1 --spider http://localhost:8080/healthz || exit 1',
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    // Add port mappings
    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    });

    // Create Network Load Balancer (internal)
    const nlb = new elbv2.NetworkLoadBalancer(this, 'OpenFgaNlb', {
      vpc: props.vpc,
      internetFacing: false,
      vpcSubnets: {
        subnets: props.subnets,
      },
      crossZoneEnabled: true,
    });

    // Create target group
    const targetGroup = new elbv2.NetworkTargetGroup(this, 'OpenFgaTargetGroup', {
      vpc: props.vpc,
      port: 8080,
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        enabled: true,
        protocol: elbv2.Protocol.HTTP,
        path: '/healthz',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Create listener
    nlb.addListener('OpenFgaListener', {
      port: 80,
      protocol: elbv2.Protocol.TCP,
      defaultTargetGroups: [targetGroup],
    });

    // Create Fargate service
    const service = new ecs.FargateService(this, 'OpenFgaService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: {
        subnets: props.subnets,
      },
      securityGroups: [ecsSecurityGroup],
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      enableExecuteCommand: true,
    });

    // Attach the service to the target group
    service.attachToNetworkTargetGroup(targetGroup);

    // Ensure ECS service starts after database is ready
    service.node.addDependency(dbInstance);

    // Create VPC Link for API Gateway
    const vpcLink = new apigateway.VpcLink(this, 'OpenFgaVpcLink', {
      targets: [nlb],
      description: `VPC Link for OpenFGA API Gateway (tenant: ${props.tenantId})`,
      vpcLinkName: `${props.environment}-${props.tenantId}-openfga-link`,
    });

    // Create HTTP API Gateway
    const api = new apigateway.RestApi(this, 'OpenFgaApi', {
      restApiName: `${props.environment}-${props.tenantId}-openfga-api`,
      description: `OpenFGA API Gateway for tenant ${props.tenantId}`,
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Create integration with VPC Link
    const integration = new apigateway.Integration({
      type: apigateway.IntegrationType.HTTP_PROXY,
      integrationHttpMethod: 'ANY',
      uri: `http://${nlb.loadBalancerDnsName}`,
      options: {
        connectionType: apigateway.ConnectionType.VPC_LINK,
        vpcLink: vpcLink,
        requestParameters: {
          'integration.request.path.proxy': 'method.request.path.proxy',
        },
      },
    });

    // Add proxy resource to forward all requests
    const proxyResource = api.root.addResource('{proxy+}');
    proxyResource.addMethod('ANY', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
      requestParameters: {
        'method.request.path.proxy': true,
      },
    });

    // Also add method to root resource
    api.root.addMethod('ANY', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    });

    // Create resource policy to allow cross-account access
    if (props.controlPlaneLambdaRoleArn) {
      api.addToResourcePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.ArnPrincipal(props.controlPlaneLambdaRoleArn)],
          actions: ['execute-api:Invoke'],
          resources: [api.arnForExecuteApi()],
        })
      );
    }

    this.apiEndpoint = api.url;
    this.apiGatewayId = api.restApiId;

    // Create Lambda for schema initialization
    const schemaInitializerLambda = new NodejsFunction(
      this,
      'SchemaInitializer',
      {
        functionName: `${props.environment}-${props.tenantId}-openfga-schema-init`,
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'handler',
        entry: path.join(__dirname, './custom-resources/openFgaSchemaInitializer.ts'),
        timeout: cdk.Duration.minutes(5),
        memorySize: 512,
        vpc: props.vpc,
        vpcSubnets: {
          subnets: props.subnets,
        },
        environment: {
          NODE_OPTIONS: '--enable-source-maps',
        },
      }
    );

    // Create Custom Resource to initialize schema
    const schemaInitializer = new cdk.CustomResource(
      this,
      'OpenFgaSchemaInit',
      {
        serviceToken: schemaInitializerLambda.functionArn,
        resourceType: 'Custom::OpenFgaSchemaInit',
        properties: {
          InternalEndpoint: `http://${nlb.loadBalancerDnsName}`,
          TenantId: props.tenantId,
        },
      }
    );

    // Ensure schema initialization happens after API Gateway and ECS service are ready
    schemaInitializer.node.addDependency(api);
    schemaInitializer.node.addDependency(service);

    // Get the StoreId from the Custom Resource
    this.storeId = schemaInitializer.getAttString('StoreId');

    // Outputs
    new cdk.CfnOutput(this, 'OpenFgaApiEndpoint', {
      value: this.apiEndpoint,
      description: `OpenFGA API Gateway endpoint for tenant ${props.tenantId}`,
      exportName: `${this.stackName}-ApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'OpenFgaApiGatewayId', {
      value: this.apiGatewayId,
      description: `OpenFGA API Gateway ID for tenant ${props.tenantId}`,
      exportName: `${this.stackName}-ApiGatewayId`,
    });

    new cdk.CfnOutput(this, 'OpenFgaDatabaseEndpoint', {
      value: this.databaseEndpoint,
      description: `OpenFGA database endpoint for tenant ${props.tenantId}`,
      exportName: `${this.stackName}-DatabaseEndpoint`,
    });

    new cdk.CfnOutput(this, 'OpenFgaStoreId', {
      value: this.storeId,
      description: `OpenFGA Store ID for tenant ${props.tenantId}`,
      exportName: `${this.stackName}-StoreId`,
    });

    // Add tags
    cdk.Tags.of(this).add('TenantId', props.tenantId);
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Purpose', 'TenantAuthorization');

    // Set stack description
    this.templateOptions.description =
      props.description ||
      `Creates OpenFGA authorization system for multi-tenant application (tenant: ${props.tenantId})`;
  }
}
