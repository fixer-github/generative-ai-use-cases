import { Duration } from 'aws-cdk-lib';
import { IVpc, SecurityGroup, SubnetType } from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  LogDriver,
  Protocol,
  Secret as EcsSecret,
} from 'aws-cdk-lib/aws-ecs';
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationProtocolVersion,
  ApplicationTargetGroup,
  TargetType,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { OpenFGADatabase } from './openfga-database';

/**
 * Properties for OpenFGA Service
 */
export interface OpenFGAServiceProps {
  /**
   * VPC to deploy the service in
   */
  readonly vpc: IVpc;

  /**
   * OpenFGA database
   */
  readonly database: OpenFGADatabase;

  /**
   * Environment name for resource naming
   */
  readonly environment: string;

  /**
   * OpenFGA container image tag
   * @default 'latest'
   */
  readonly imageTag?: string;

  /**
   * Desired number of Fargate tasks
   * @default 2
   */
  readonly desiredCount?: number;

  /**
   * Minimum number of tasks for autoscaling
   * @default 2
   */
  readonly minCapacity?: number;

  /**
   * Maximum number of tasks for autoscaling
   * @default 10
   */
  readonly maxCapacity?: number;

  /**
   * CPU units for Fargate task (256 = 0.25 vCPU)
   * @default 256
   */
  readonly cpu?: number;

  /**
   * Memory in MB for Fargate task
   * @default 512
   */
  readonly memoryLimitMiB?: number;

  /**
   * Enable public load balancer
   * @default false (internal ALB)
   */
  readonly publicLoadBalancer?: boolean;

  /**
   * Enable playground (ONLY for development)
   * @default false
   */
  readonly enablePlayground?: boolean;

  /**
   * Pre-shared keys for authentication
   * Creates a new secret if not provided
   */
  readonly presharedKeysSecret?: Secret;
}

/**
 * OpenFGA Service on ECS Fargate
 *
 * Creates a complete OpenFGA deployment with:
 * - ECS Fargate service
 * - Application Load Balancer
 * - Auto-scaling configuration
 * - CloudWatch logging and metrics
 * - Security groups and IAM roles
 */
export class OpenFGAService extends Construct {
  /**
   * The ECS Fargate service
   */
  public readonly service: FargateService;

  /**
   * Application Load Balancer
   */
  public readonly loadBalancer: ApplicationLoadBalancer;

  /**
   * Security group for the service
   */
  public readonly securityGroup: SecurityGroup;

  /**
   * OpenFGA HTTP endpoint (via ALB)
   */
  public readonly endpoint: string;

  /**
   * OpenFGA gRPC endpoint (via ALB)
   */
  public readonly grpcEndpoint: string;

  /**
   * Secret containing pre-shared authentication keys
   */
  public readonly presharedKeysSecret: Secret;

  constructor(scope: Construct, id: string, props: OpenFGAServiceProps) {
    super(scope, id);

    const environment = props.environment;

    // Create or use existing pre-shared keys secret
    this.presharedKeysSecret = props.presharedKeysSecret ?? new Secret(this, 'PresharedKeys', {
      secretName: `/openfga/${environment}/preshared-keys`,
      description: `Pre-shared authentication keys for OpenFGA (${environment})`,
      generateSecretString: {
        generateStringKey: 'key',
        secretStringTemplate: '{}',
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 64,
      },
    });

    // Create ECS cluster
    const cluster = new Cluster(this, 'Cluster', {
      vpc: props.vpc,
      clusterName: `openfga-${environment}`,
      containerInsights: true,
    });

    // Create security group for OpenFGA tasks
    this.securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: `Security group for OpenFGA service (${environment})`,
      allowAllOutbound: true,
    });

    // Allow database connections
    props.database.allowConnectionFrom(
      this.securityGroup,
      'Allow OpenFGA to access database',
    );

    // Create CloudWatch log group
    const logGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/openfga-${environment}`,
      retention: RetentionDays.ONE_WEEK,
    });

    // Create Fargate task definition
    const taskDefinition = new FargateTaskDefinition(this, 'TaskDef', {
      cpu: props.cpu ?? 256,
      memoryLimitMiB: props.memoryLimitMiB ?? 512,
    });

    // Add OpenFGA container
    const dbConfig = props.database.getConnectionConfig();

    const container = taskDefinition.addContainer('openfga', {
      image: ContainerImage.fromRegistry(
        `openfga/openfga:${props.imageTag ?? 'latest'}`,
      ),
      logging: LogDriver.awsLogs({
        streamPrefix: 'openfga',
        logGroup,
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'wget --spider -q http://localhost:8080/healthz || exit 1'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      environment: {
        // Database configuration
        OPENFGA_DATASTORE_ENGINE: 'postgres',
        OPENFGA_DATASTORE_URI: `postgres://openfga:PASSWORD@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}?sslmode=require`,
        OPENFGA_DATASTORE_MAX_OPEN_CONNS: '100',

        // HTTP server
        OPENFGA_HTTP_ADDR: '0.0.0.0:8080',

        // gRPC server
        OPENFGA_GRPC_ADDR: '0.0.0.0:8081',

        // Metrics
        OPENFGA_METRICS_ENABLED: 'true',
        OPENFGA_METRICS_ADDR: '0.0.0.0:2112',

        // Caching
        OPENFGA_CHECK_QUERY_CACHE_ENABLED: 'true',
        OPENFGA_CHECK_QUERY_CACHE_TTL: '5m',

        // Playground (disabled in production)
        OPENFGA_PLAYGROUND_ENABLED: (props.enablePlayground ?? false).toString(),

        // Authentication
        OPENFGA_AUTHN_METHOD: 'preshared',

        // Logging
        OPENFGA_LOG_LEVEL: 'info',
        OPENFGA_LOG_FORMAT: 'json',
      },
      secrets: {
        // Database password from Secrets Manager
        OPENFGA_DATASTORE_PASSWORD: EcsSecret.fromSecretsManager(props.database.credentialsSecret, 'password'),

        // Pre-shared authentication key
        OPENFGA_AUTHN_PRESHARED_KEYS: EcsSecret.fromSecretsManager(this.presharedKeysSecret, 'key'),
      },
    });

    // Add port mappings
    container.addPortMappings(
      { containerPort: 8080, protocol: Protocol.TCP, name: 'http' },
      { containerPort: 8081, protocol: Protocol.TCP, name: 'grpc' },
      { containerPort: 2112, protocol: Protocol.TCP, name: 'metrics' },
    );

    // Grant permissions to read secrets
    props.database.credentialsSecret.grantRead(taskDefinition.taskRole);
    this.presharedKeysSecret.grantRead(taskDefinition.taskRole);

    // Grant CloudWatch metrics permissions
    taskDefinition.taskRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      }),
    );

    // Create Fargate service
    this.service = new FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: props.desiredCount ?? 2,
      securityGroups: [this.securityGroup],
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      healthCheckGracePeriod: Duration.seconds(60),
      enableExecuteCommand: true, // For debugging
    });

    // Create Application Load Balancer
    this.loadBalancer = new ApplicationLoadBalancer(this, 'ALB', {
      vpc: props.vpc,
      internetFacing: props.publicLoadBalancer ?? false,
      vpcSubnets: {
        subnetType: props.publicLoadBalancer
          ? SubnetType.PUBLIC
          : SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // Allow ALB to reach Fargate tasks
    this.securityGroup.addIngressRule(
      this.loadBalancer.connections.securityGroups[0],
      this.service.connections.defaultPort!,
      'Allow ALB to reach OpenFGA',
    );

    // HTTP listener and target group
    const httpTargetGroup = new ApplicationTargetGroup(this, 'HttpTargetGroup', {
      vpc: props.vpc,
      port: 8080,
      protocol: ApplicationProtocol.HTTP,
      targetType: TargetType.IP,
      targets: [this.service],
      healthCheck: {
        path: '/healthz',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    const httpListener = this.loadBalancer.addListener('HttpListener', {
      port: 8080,
      protocol: ApplicationProtocol.HTTP,
      defaultTargetGroups: [httpTargetGroup],
    });

    // gRPC listener and target group
    const grpcTargetGroup = new ApplicationTargetGroup(this, 'GrpcTargetGroup', {
      vpc: props.vpc,
      port: 8081,
      protocol: ApplicationProtocol.HTTP,
      protocolVersion: ApplicationProtocolVersion.HTTP2, // HTTP/2 for gRPC
      targetType: TargetType.IP,
      targets: [this.service],
      healthCheck: {
        path: '/healthz',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    const grpcListener = this.loadBalancer.addListener('GrpcListener', {
      port: 8081,
      protocol: ApplicationProtocol.HTTP,
      defaultTargetGroups: [grpcTargetGroup],
    });

    // Set endpoints
    this.endpoint = `http://${this.loadBalancer.loadBalancerDnsName}:8080`;
    this.grpcEndpoint = `${this.loadBalancer.loadBalancerDnsName}:8081`;

    // Configure auto-scaling
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: props.minCapacity ?? 2,
      maxCapacity: props.maxCapacity ?? 10,
    });

    // Scale on CPU utilization
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });

    // Scale on memory utilization
    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });
  }

  /**
   * Get the OpenFGA configuration for Lambda functions
   */
  getOpenFGAConfig() {
    return {
      httpEndpoint: this.endpoint,
      grpcEndpoint: this.grpcEndpoint,
      presharedKeySecretArn: this.presharedKeysSecret.secretArn,
    };
  }
}
