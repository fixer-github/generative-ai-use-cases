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
import * as cr from 'aws-cdk-lib/custom-resources';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import * as crypto from 'crypto';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import { OpenFgaConfig } from '../../create-tenant-stacks';
import { AUTHORIZATION_MODEL_TYPE_DEFINITIONS } from './custom-resources/openFgaSchema';

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
   * Tenant role ARN for authorization checks
   */
  readonly tenantRoleArn: string;

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
 *
 * Architecture:
 * 1. Database Migration (one-time, before ECS service starts):
 *    - Custom Resource Lambda triggers ECS RunTask with 'openfga migrate'
 *    - Initializes PostgreSQL schema using goose migration tool
 *    - Idempotent: safe to run multiple times
 *
 * 2. Application Server (ECS Fargate Service):
 *    - Runs 'openfga run' command
 *    - Serves HTTP (port 8080) and gRPC (port 8081) APIs
 *    - Auto-scales based on configuration
 *
 * 3. Schema Initialization (after service is healthy):
 *    - Custom Resource creates OpenFGA Store
 *    - Registers authorization model type definitions
 *    - Application-layer setup (separate from database schema)
 *
 * Deployment Order:
 *   RDS Instance → Migration (Custom Resource) → ECS Service → Schema Init (Custom Resource)
 *
 * Based on OpenFGA official recommendations:
 * - Separate 'migrate' from 'run' (Docker Compose pattern)
 * - No /bin/sh in official image (distroless)
 * - Use command array, not shell strings
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
    const dbSecurityGroup = new ec2.SecurityGroup(
      this,
      'OpenFgaDbSecurityGroup',
      {
        vpc: props.vpc,
        description: `Security group for OpenFGA PostgreSQL database (tenant: ${props.tenantId})`,
        allowAllOutbound: false,
      }
    );

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
      backupRetention: cdk.Duration.days(
        props.openFgaConfig.rds.backupRetentionDays
      ),
      preferredBackupWindow: props.openFgaConfig.rds.preferredBackupWindow,
      preferredMaintenanceWindow:
        props.openFgaConfig.rds.preferredMaintenanceWindow,
      enablePerformanceInsights:
        props.openFgaConfig.rds.enablePerformanceInsights,
      performanceInsightRetention: props.openFgaConfig.rds
        .enablePerformanceInsights
        ? rds.PerformanceInsightRetention.DEFAULT
        : undefined,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: this.getLogRetentionDays(
        props.openFgaConfig.logging.retentionDays
      ),
    });

    this.databaseEndpoint = dbInstance.dbInstanceEndpointAddress;

    // Create ECS cluster
    const cluster = new ecs.Cluster(this, 'OpenFgaCluster', {
      vpc: props.vpc,
      clusterName: `${props.environment}-${props.tenantId}-openfga`,
      containerInsights: true,
    });

    // ====================================================
    // Migration Task Definition (one-time execution)
    // ====================================================
    const migrateTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      'OpenFgaMigrateTaskDefinition',
      {
        memoryLimitMiB: 512,
        cpu: 256,
      }
    );

    // Grant read access to the database credentials for migrate task
    dbCredentialsSecret.grantRead(migrateTaskDefinition.taskRole);

    // Add migrate container
    // IMPORTANT: Do not override entryPoint. OpenFGA official image uses /openfga as entrypoint
    // and does not have /bin/sh available (distroless image)
    migrateTaskDefinition.addContainer('MigrateContainer', {
      image: ecs.ContainerImage.fromRegistry(
        `openfga/openfga:${props.openFgaConfig.ecs.imageVersion}`
      ),
      // Only specify command, not entryPoint (use the default /openfga from the image)
      command: ['migrate'],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'openfga-migrate',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        OPENFGA_DATASTORE_ENGINE: 'postgres',
        OPENFGA_DATASTORE_URI: `postgres://placeholder:placeholder@${dbInstance.dbInstanceEndpointAddress}/openfga`,
      },
      secrets: {
        OPENFGA_DATASTORE_USERNAME: ecs.Secret.fromSecretsManager(
          dbCredentialsSecret,
          'username'
        ),
        OPENFGA_DATASTORE_PASSWORD: ecs.Secret.fromSecretsManager(
          dbCredentialsSecret,
          'password'
        ),
      },
    });

    // ====================================================
    // Application Task Definition (openfga run)
    // ====================================================
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
    // IMPORTANT: Do not override entryPoint. OpenFGA official image uses /openfga as entrypoint
    // and does not have /bin/sh available (distroless image)
    const container = taskDefinition.addContainer('OpenFgaContainer', {
      image: ecs.ContainerImage.fromRegistry(
        `openfga/openfga:${props.openFgaConfig.ecs.imageVersion}`
      ),
      // Only specify command, not entryPoint (use the default /openfga from the image)
      command: ['run'],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'openfga',
        logRetention: this.getLogRetentionDays(
          props.openFgaConfig.logging.retentionDays
        ),
      }),
      environment: {
        OPENFGA_DATASTORE_ENGINE: 'postgres',
        // Use placeholder credentials in URI - these will be overridden by secrets
        OPENFGA_DATASTORE_URI: `postgres://placeholder:placeholder@${dbInstance.dbInstanceEndpointAddress}/openfga`,
        OPENFGA_LOG_FORMAT: 'json',
        // Playground is disabled for production security (as recommended by OpenFGA)
        OPENFGA_PLAYGROUND_ENABLED: 'false',
        OPENFGA_HTTP_ADDR: '0.0.0.0:8080',
        OPENFGA_GRPC_ADDR: '0.0.0.0:8081',
        // Production Best Practices:
        // Consider adding OPENFGA_DATASTORE_MAX_OPEN_CONNS to control database connection pool
        // Example: OPENFGA_DATASTORE_MAX_OPEN_CONNS: '25'
        // This should be tuned based on:
        // - RDS max_connections setting
        // - Number of ECS tasks (desiredCount)
        // - Expected concurrent load
        // Formula: max_connections / (number_of_tasks * 1.2) for safety margin
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
        // Use grpc_health_probe bundled in OpenFGA distroless image
        // wget/curl are not available in distroless images
        command: [
          'CMD',
          '/usr/local/bin/grpc_health_probe',
          '-addr=localhost:8081',
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
    const targetGroup = new elbv2.NetworkTargetGroup(
      this,
      'OpenFgaTargetGroup',
      {
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
      }
    );

    // Create listener
    nlb.addListener('OpenFgaListener', {
      port: 80,
      protocol: elbv2.Protocol.TCP,
      defaultTargetGroups: [targetGroup],
    });

    // Create Fargate service
    const ecsConfig = props.openFgaConfig.ecs;
    const service = new ecs.FargateService(this, 'OpenFgaService', {
      cluster,
      taskDefinition,
      desiredCount: ecsConfig.minCapacity,
      assignPublicIp: false,
      vpcSubnets: {
        subnets: props.subnets,
      },
      securityGroups: [ecsSecurityGroup],
      healthCheckGracePeriod: cdk.Duration.seconds(300),
      enableExecuteCommand: true,
      circuitBreaker: {
        enable: true,
        rollback: true,
      },
    });

    // ====================================================
    // Auto Scaling Configuration
    // ====================================================
    // Auto scaling is enabled when maxCapacity > minCapacity
    if (ecsConfig.maxCapacity > ecsConfig.minCapacity) {
      const hasCpuScaling = !!ecsConfig.cpuTargetUtilizationPercent;
      const hasMemoryScaling = !!ecsConfig.memoryTargetUtilizationPercent;
      const hasScheduledScaling =
        ecsConfig.scheduledScaling && ecsConfig.scheduledScaling.length > 0;

      if (!hasCpuScaling && !hasMemoryScaling && !hasScheduledScaling) {
        console.warn(
          `[${props.tenantId}] Auto Scaling is enabled (maxCapacity: ${ecsConfig.maxCapacity} > minCapacity: ${ecsConfig.minCapacity}) ` +
            'but no scaling policy is configured. Consider setting cpuTargetUtilizationPercent, ' +
            'memoryTargetUtilizationPercent, or scheduledScaling.'
        );
      }

      const scalableTarget = service.autoScaleTaskCount({
        minCapacity: ecsConfig.minCapacity,
        maxCapacity: ecsConfig.maxCapacity,
      });

      // Shared cooldown configuration for scaling policies
      const cooldownConfig = {
        scaleOutCooldown: ecsConfig.scaleOutCooldownSeconds
          ? cdk.Duration.seconds(ecsConfig.scaleOutCooldownSeconds)
          : undefined,
        scaleInCooldown: ecsConfig.scaleInCooldownSeconds
          ? cdk.Duration.seconds(ecsConfig.scaleInCooldownSeconds)
          : undefined,
      };

      // CPU utilization based scaling (enabled when cpuTargetUtilizationPercent is specified)
      if (ecsConfig.cpuTargetUtilizationPercent) {
        scalableTarget.scaleOnCpuUtilization('CpuScaling', {
          targetUtilizationPercent: ecsConfig.cpuTargetUtilizationPercent,
          ...cooldownConfig,
        });
      }

      // Memory utilization based scaling (enabled when memoryTargetUtilizationPercent is specified)
      if (ecsConfig.memoryTargetUtilizationPercent) {
        scalableTarget.scaleOnMemoryUtilization('MemoryScaling', {
          targetUtilizationPercent: ecsConfig.memoryTargetUtilizationPercent,
          ...cooldownConfig,
        });
      }

      // Schedule based scaling
      if (ecsConfig.scheduledScaling && ecsConfig.scheduledScaling.length > 0) {
        for (const scheduleConfig of ecsConfig.scheduledScaling) {
          scalableTarget.scaleOnSchedule(scheduleConfig.scheduleName, {
            schedule: appscaling.Schedule.expression(scheduleConfig.schedule),
            minCapacity: scheduleConfig.minCapacity,
            maxCapacity: scheduleConfig.maxCapacity,
          });
        }
      }
    }

    // Attach the service to the target group
    service.attachToNetworkTargetGroup(targetGroup);

    // ====================================================
    // Migration Runner (Custom Resource)
    // ====================================================
    // Run 'openfga migrate' once before starting the ECS service
    // This ensures database schema is initialized before the application starts
    //
    // IMPORTANT: Migration task requires network access to:
    // 1. RDS (via ecsSecurityGroup → dbSecurityGroup on port 5432) ✓
    // 2. Secrets Manager (for database credentials)
    // 3. CloudWatch Logs (for logging)
    //
    // Since assignPublicIp is DISABLED, ensure either:
    // - NAT Gateway is configured in the VPC (current assumption), OR
    // - VPC Endpoints are configured for:
    //   - com.amazonaws.<region>.secretsmanager
    //   - com.amazonaws.<region>.logs
    //
    // VPC Endpoints are recommended for production to reduce NAT Gateway costs
    // and improve security by keeping traffic within AWS network.

    const migrateRunnerLambda = new NodejsFunction(
      this,
      'MigrateRunnerLambda',
      {
        functionName: `${props.environment}-${props.tenantId}-openfga-migrate`,
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'handler',
        entry: path.join(
          __dirname,
          './custom-resources/openFgaMigrateRunner.ts'
        ),
        timeout: cdk.Duration.minutes(10),
        memorySize: 256,
        environment: {
          NODE_OPTIONS: '--enable-source-maps',
        },
        bundling: {
          externalModules: ['@aws-sdk/*'], // Use AWS SDK v3 from Lambda runtime
        },
      }
    );

    // Grant permissions to run ECS tasks
    migrateRunnerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ecs:RunTask'],
        resources: [
          migrateTaskDefinition.taskDefinitionArn,
          // Task instances have additional version suffix
          `${migrateTaskDefinition.taskDefinitionArn}:*`,
        ],
      })
    );

    // Grant permissions to describe tasks
    // DescribeTasks requires task instance ARN pattern (arn:aws:ecs:region:account:task/cluster-name/task-id)
    migrateRunnerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ecs:DescribeTasks'],
        resources: [
          `arn:aws:ecs:${this.region}:${this.account}:task/${cluster.clusterName}/*`,
        ],
      })
    );

    // Grant PassRole permission for task execution and task roles
    migrateRunnerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [
          migrateTaskDefinition.executionRole!.roleArn,
          migrateTaskDefinition.taskRole.roleArn,
        ],
      })
    );

    // Create Custom Resource to run migration
    const migrateRunner = new cdk.CustomResource(this, 'OpenFgaMigrateRunner', {
      serviceToken: migrateRunnerLambda.functionArn,
      resourceType: 'Custom::OpenFgaMigrateRunner',
      properties: {
        ClusterArn: cluster.clusterArn,
        TaskDefinitionArn: migrateTaskDefinition.taskDefinitionArn,
        Subnets: props.subnets.map((s) => s.subnetId).join(','),
        SecurityGroups: ecsSecurityGroup.securityGroupId,
        // Add timestamp to force migration on every stack update if needed
        // Comment out if you want migration to run only on first deploy
        // Timestamp: new Date().toISOString(),
      },
    });

    // Migration runner depends on database being ready
    migrateRunner.node.addDependency(dbInstance);

    // ECS service must start AFTER migration completes
    service.node.addDependency(migrateRunner);

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

    // Create CloudWatch Logs role for API Gateway (account-level setting)
    // This is idempotent - safe for both single-account and cross-account deployments
    const apiGatewayLogsRole = new iam.Role(this, 'ApiGatewayCloudWatchRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonAPIGatewayPushToCloudWatchLogs'
        ),
      ],
    });

    const apiGatewayAccount = new apigateway.CfnAccount(
      this,
      'ApiGatewayAccount',
      {
        cloudWatchRoleArn: apiGatewayLogsRole.roleArn,
      }
    );

    // Create HTTP API Gateway
    const api = new apigateway.RestApi(this, 'OpenFgaApi', {
      restApiName: `${props.environment}-${props.tenantId}-openfga-api`,
      description: `OpenFGA API Gateway for tenant ${props.tenantId}`,
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      deploy: false, // Disable automatic deployment to avoid circular dependencies
      // defaultCorsPreflightOptions: {
      //   allowOrigins: apigateway.Cors.ALL_ORIGINS,
      //   allowMethods: apigateway.Cors.ALL_METHODS,
      // },
    });

    // Ensure API Gateway account setting is configured before API creation
    api.node.addDependency(apiGatewayAccount);

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
    const proxyMethod = proxyResource.addMethod('ANY', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
      requestParameters: {
        'method.request.path.proxy': true,
      },
    });

    // Create resource policy to allow access from tenant role and control plane Lambda
    const allowedPrincipals: iam.IPrincipal[] = [
      new iam.ArnPrincipal(props.tenantRoleArn),
    ];

    // Add control plane Lambda role if provided (for cross-account scenarios)
    if (props.controlPlaneLambdaRoleArn) {
      allowedPrincipals.push(
        new iam.ArnPrincipal(props.controlPlaneLambdaRoleArn)
      );
    }

    api.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: allowedPrincipals,
        actions: ['execute-api:Invoke'],
        resources: ['execute-api:/*'],
      })
    );

    // Create manual deployment after all resources and methods are defined
    // This avoids circular dependencies that occur when using deployOptions
    const deployment = new apigateway.Deployment(this, 'OpenFgaApiDeployment', {
      api: api,
    });

    // Ensure deployment depends on all resources and methods
    deployment.node.addDependency(proxyMethod);

    // Create stage with logging configuration
    const stage = new apigateway.Stage(this, 'OpenFgaApiStage', {
      deployment: deployment,
      stageName: 'prod',
      loggingLevel:
        loggingLevelMap[props.openFgaConfig.apiGateway.loggingLevel] ||
        apigateway.MethodLoggingLevel.INFO,
      dataTraceEnabled: props.openFgaConfig.apiGateway.dataTraceEnabled,
      metricsEnabled: true,
    });

    this.apiEndpoint = stage.urlForPath('/');
    this.apiGatewayId = api.restApiId;

    // Create Lambda for schema initialization
    const schemaInitializerLambda = new NodejsFunction(
      this,
      'SchemaInitializer',
      {
        functionName: `${props.environment}-${props.tenantId}-openfga-schema-init`,
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'handler',
        entry: path.join(
          __dirname,
          './custom-resources/openFgaSchemaInitializer.ts'
        ),
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

    // Generate schema hash to trigger update when schema changes
    const schemaHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(AUTHORIZATION_MODEL_TYPE_DEFINITIONS))
      .digest('hex')
      .substring(0, 16);

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
          // SchemaHash triggers CloudFormation Update event when schema changes
          SchemaHash: schemaHash,
        },
      }
    );

    // Ensure schema initialization happens after migration, API Gateway, and ECS service are ready
    // Dependency order: Database → Migration → ECS Service → Schema Initialization
    schemaInitializer.node.addDependency(migrateRunner);
    schemaInitializer.node.addDependency(service);

    // Get the StoreId from the Custom Resource
    this.storeId = schemaInitializer.getAttString('StoreId');

    // ====================================================
    // SSM Parameter Store for Tenant-specific Configuration
    // ====================================================
    // Store OpenFGA API endpoint in SSM Parameter Store
    // This allows tenant-isolated configuration management
    const openFgaApiEndpointParameter = new ssm.StringParameter(
      this,
      'OpenFgaApiEndpointParameter',
      {
        parameterName: `/genu-gaixer/tenants/${props.tenantId}/openFgaApiEndpoint`,
        description: `OpenFGA API Gateway endpoint for tenant ${props.tenantId}`,
        stringValue: this.apiEndpoint,
        tier: ssm.ParameterTier.STANDARD,
      }
    );

    // Store OpenFGA API region in SSM Parameter Store
    const openFgaApiRegionParameter = new ssm.StringParameter(
      this,
      'OpenFgaApiRegionParameter',
      {
        parameterName: `/genu-gaixer/tenants/${props.tenantId}/openFgaApiRegion`,
        description: `OpenFGA API Gateway region for tenant ${props.tenantId}`,
        stringValue: this.region,
        tier: ssm.ParameterTier.STANDARD,
      }
    );

    // Store OpenFGA Store ID in SSM Parameter Store
    const openFgaStoreIdParameter = new ssm.StringParameter(
      this,
      'OpenFgaStoreIdParameter',
      {
        parameterName: `/genu-gaixer/tenants/${props.tenantId}/openFgaStoreId`,
        description: `OpenFGA Store ID for tenant ${props.tenantId}`,
        stringValue: this.storeId,
        tier: ssm.ParameterTier.STANDARD,
      }
    );

    // Ensure parameters are created after required resources are available
    openFgaApiEndpointParameter.node.addDependency(stage);
    openFgaStoreIdParameter.node.addDependency(schemaInitializer);

    // Outputs
    // new cdk.CfnOutput(this, 'OpenFgaApiEndpoint', {
    //   value: this.apiEndpoint,
    //   description: `OpenFGA API Gateway endpoint for tenant ${props.tenantId}`,
    //   exportName: `${this.stackName}-ApiEndpoint`,
    // });

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
