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
import { OpenFgaConfig } from '../../create-tenant-stacks';

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
   * OpenFGA configuration
   */
  readonly openFgaConfig: OpenFgaConfig;

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

    // Validate that openFgaConfig is provided
    if (!props.openFgaConfig) {
      throw new Error('openFgaConfig is required in cdk.tenant.json');
    }

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

    // Map storage type string to RDS StorageType enum
    const storageTypeMap: { [key: string]: rds.StorageType } = {
      GP3: rds.StorageType.GP3,
      GP2: rds.StorageType.GP2,
      IO1: rds.StorageType.IO1,
      IO2: rds.StorageType.IO2,
      STANDARD: rds.StorageType.STANDARD,
    };

    // Map instance class string to EC2 InstanceClass
    const instanceClassMap: { [key: string]: ec2.InstanceClass } = {
      T4G: ec2.InstanceClass.T4G,
      T3: ec2.InstanceClass.T3,
      M5: ec2.InstanceClass.M5,
      M6G: ec2.InstanceClass.M6G,
      R5: ec2.InstanceClass.R5,
      R6G: ec2.InstanceClass.R6G,
    };

    // Map instance size string to EC2 InstanceSize
    const instanceSizeMap: { [key: string]: ec2.InstanceSize } = {
      MICRO: ec2.InstanceSize.MICRO,
      SMALL: ec2.InstanceSize.SMALL,
      MEDIUM: ec2.InstanceSize.MEDIUM,
      LARGE: ec2.InstanceSize.LARGE,
      XLARGE: ec2.InstanceSize.XLARGE,
      XLARGE2: ec2.InstanceSize.XLARGE2,
      XLARGE4: ec2.InstanceSize.XLARGE4,
      XLARGE8: ec2.InstanceSize.XLARGE8,
    };

    // Create RDS PostgreSQL instance for OpenFGA
    const dbInstance = new rds.DatabaseInstance(this, 'OpenFgaDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(
        instanceClassMap[props.openFgaConfig.rds.instanceClass],
        instanceSizeMap[props.openFgaConfig.rds.instanceSize]
      ),
      vpc: props.vpc,
      vpcSubnets: {
        subnets: props.subnets,
      },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbCredentialsSecret),
      databaseName: 'openfga',
      allocatedStorage: props.openFgaConfig.rds.allocatedStorage,
      maxAllocatedStorage: props.openFgaConfig.rds.maxAllocatedStorage,
      storageType: storageTypeMap[props.openFgaConfig.rds.storageType],
      removalPolicy: props.removalPolicy,
      deletionProtection: props.openFgaConfig.rds.deletionProtection,
      backupRetention: cdk.Duration.days(props.openFgaConfig.rds.backupRetentionDays),
      preferredBackupWindow: props.openFgaConfig.rds.preferredBackupWindow,
      preferredMaintenanceWindow: props.openFgaConfig.rds.preferredMaintenanceWindow,
      enablePerformanceInsights: props.openFgaConfig.rds.enablePerformanceInsights,
      performanceInsightRetention:
        props.openFgaConfig.rds.enablePerformanceInsights
          ? rds.PerformanceInsightRetention.DEFAULT
          : undefined,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: this.getLogRetentionDays(props.openFgaConfig.logging.retentionDays),
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
        memoryLimitMiB: props.openFgaConfig.ecs.memoryLimitMiB,
        cpu: props.openFgaConfig.ecs.cpu,
      }
    );

    // Grant read access to the database credentials
    dbCredentialsSecret.grantRead(taskDefinition.taskRole);

    // Add OpenFGA container
    const container = taskDefinition.addContainer('OpenFgaContainer', {
      image: ecs.ContainerImage.fromRegistry(`openfga/openfga:${props.openFgaConfig.ecs.imageVersion}`),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'openfga',
        logRetention: this.getLogRetentionDays(props.openFgaConfig.logging.retentionDays),
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
      desiredCount: props.openFgaConfig.ecs.desiredCount,
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

    // Map logging level string to API Gateway MethodLoggingLevel
    const loggingLevelMap: { [key: string]: apigateway.MethodLoggingLevel } = {
      OFF: apigateway.MethodLoggingLevel.OFF,
      ERROR: apigateway.MethodLoggingLevel.ERROR,
      INFO: apigateway.MethodLoggingLevel.INFO,
    };

    // Create HTTP API Gateway
    const api = new apigateway.RestApi(this, 'OpenFgaApi', {
      restApiName: `${props.environment}-${props.tenantId}-openfga-api`,
      description: `OpenFGA API Gateway for tenant ${props.tenantId}`,
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      deployOptions: {
        stageName: 'prod',
        loggingLevel: loggingLevelMap[props.openFgaConfig.apiGateway.loggingLevel] || apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: props.openFgaConfig.apiGateway.dataTraceEnabled,
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
      uri: `http://${nlb.loadBalancerDnsName}/{proxy}`,
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

  /**
   * Helper method to convert retention days number to logs.RetentionDays enum
   */
  private getLogRetentionDays(days: number): logs.RetentionDays {
    const retentionMap: { [key: number]: logs.RetentionDays } = {
      1: logs.RetentionDays.ONE_DAY,
      3: logs.RetentionDays.THREE_DAYS,
      5: logs.RetentionDays.FIVE_DAYS,
      7: logs.RetentionDays.ONE_WEEK,
      14: logs.RetentionDays.TWO_WEEKS,
      30: logs.RetentionDays.ONE_MONTH,
      60: logs.RetentionDays.TWO_MONTHS,
      90: logs.RetentionDays.THREE_MONTHS,
      120: logs.RetentionDays.FOUR_MONTHS,
      150: logs.RetentionDays.FIVE_MONTHS,
      180: logs.RetentionDays.SIX_MONTHS,
      365: logs.RetentionDays.ONE_YEAR,
      400: logs.RetentionDays.THIRTEEN_MONTHS,
      545: logs.RetentionDays.EIGHTEEN_MONTHS,
      731: logs.RetentionDays.TWO_YEARS,
      1827: logs.RetentionDays.FIVE_YEARS,
      3653: logs.RetentionDays.TEN_YEARS,
    };

    return retentionMap[days] || logs.RetentionDays.ONE_WEEK;
  }
}
