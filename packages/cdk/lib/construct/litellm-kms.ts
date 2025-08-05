import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';

export interface LiteLLMProvider {
  readonly enabled: boolean;
  readonly secretKey: string;
  readonly modelPrefix?: string;
  readonly endpoint?: string;
  readonly useIAMRole?: boolean;
}

export interface LiteLLMKmsProps {
  readonly kmsKey: kms.IKey;
  readonly providers: Record<string, LiteLLMProvider>;
  readonly lambdaEnvironment?: Record<string, string>;
  readonly enableVirtualKeys?: boolean;
  readonly virtualKeyPrefix?: string;
  readonly defaultProvider?: string;
  readonly enableCaching?: boolean;
  readonly secretRotationDays?: number;
  readonly routingStrategy?: string;
  readonly enableFallbacks?: boolean;
  readonly envSuffix?: string;
}

export class LiteLLMKms extends Construct {
  public readonly secrets: Record<string, secretsmanager.Secret> = {};
  public readonly configSecret: secretsmanager.Secret;
  public readonly lambdaEnvironment: Record<string, string>;

  constructor(scope: Construct, id: string, props: LiteLLMKmsProps) {
    super(scope, id);

    // Create master key secret
    const masterKeySecret = new secretsmanager.Secret(this, 'MasterKeySecret', {
      description: 'LiteLLM master key for proxy authentication',
      encryptionKey: props.kmsKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'master_key',
        passwordLength: 32,
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Create secrets for each enabled provider
    Object.entries(props.providers).forEach(([providerName, provider]) => {
      if (provider.enabled && !provider.useIAMRole) {
        // Secret names are not affected by envSuffix to maintain consistency across environments
        const secretName = `litellm/${providerName}/api-key`;

        const secret = new secretsmanager.Secret(
          this,
          `${providerName}Secret`,
          {
            description: `API key for ${providerName} provider`,
            encryptionKey: props.kmsKey,
            secretName,
            removalPolicy: RemovalPolicy.RETAIN,
          }
        );

        // Enable automatic rotation if specified
        if (props.secretRotationDays) {
          secret.addRotationSchedule(`${providerName}Rotation`, {
            automaticallyAfter: Duration.days(props.secretRotationDays),
          });
        }

        this.secrets[providerName] = secret;
      }
    });

    // Create configuration secret containing all provider settings
    interface ConfigData {
      providers: Record<string, unknown>;
      defaultProvider: string;
      enableCaching: boolean;
      virtualKeys: {
        enabled: boolean;
        prefix: string;
        defaultExpiry: number;
        maxKeysPerUser: number;
      };
      routing: {
        strategy: string;
        enableFallbacks: boolean;
        defaultProvider: string;
      };
      monitoring: {
        enableCloudWatch: boolean;
        metricNamespace: string;
        enableAlerts: boolean;
      };
    }
    
    const configData: ConfigData = {
      providers: {},
      defaultProvider: props.defaultProvider || 'openai',
      enableCaching: props.enableCaching ?? true,
      virtualKeys: {
        enabled: props.enableVirtualKeys ?? false,
        prefix: props.virtualKeyPrefix || 'litellm_vk_',
        defaultExpiry: 2592000,
        maxKeysPerUser: 10,
      },
      routing: {
        strategy: props.routingStrategy || 'least-cost',
        enableFallbacks: props.enableFallbacks ?? true,
        defaultProvider: props.defaultProvider || 'openai',
      },
      monitoring: {
        enableCloudWatch: true,
        metricNamespace: 'LiteLLM/Proxy',
        enableAlerts: true,
      },
    };

    // Build provider configuration
    Object.entries(props.providers).forEach(([providerName, provider]) => {
      if (provider.enabled) {
        configData.providers[providerName] = {
          enabled: true,
          modelPrefix: provider.modelPrefix || providerName,
          ...(provider.endpoint && { endpoint: provider.endpoint }),
          ...(provider.useIAMRole && { useIAMRole: true }),
          ...(!provider.useIAMRole && {
            secretArn: this.secrets[providerName]?.secretArn,
          }),
        };
      }
    });

    // Config secret name is not affected by envSuffix to maintain consistency across environments
    const configSecretName = 'litellm/config';

    this.configSecret = new secretsmanager.Secret(this, 'ConfigSecret', {
      description: 'LiteLLM configuration',
      encryptionKey: props.kmsKey,
      secretName: configSecretName,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify(configData)
      ),
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Prepare Lambda environment variables
    this.lambdaEnvironment = {
      LITELLM_MASTER_KEY: masterKeySecret
        .secretValueFromJson('master_key')
        .unsafeUnwrap(),
      LITELLM_KEY_MANAGEMENT_SYSTEM: 'aws_kms',
      KMS_KEY_ID: props.kmsKey.keyArn,
      LITELLM_CONFIG_SECRET_ARN: this.configSecret.secretArn,
      AWS_REGION_NAME: process.env.AWS_REGION || 'us-east-1',
      ...props.lambdaEnvironment,
    };
  }

  /**
   * Grant read permissions to a Lambda function for LiteLLM secrets
   */
  public grantRead(lambdaFunction: lambda.Function): void {
    // Grant KMS decrypt permissions
    const kmsPolicy = new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:DescribeKey'],
      resources: ['*'], // Will be scoped by the KMS key resource policy
    });

    // Grant Secrets Manager read permissions
    const secretsPolicy = new iam.PolicyStatement({
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
      ],
      resources: [
        this.configSecret.secretArn,
        ...Object.values(this.secrets).map((secret) => secret.secretArn),
      ],
    });

    lambdaFunction.addToRolePolicy(kmsPolicy);
    lambdaFunction.addToRolePolicy(secretsPolicy);

    // Add environment variables
    Object.entries(this.lambdaEnvironment).forEach(([key, value]) => {
      lambdaFunction.addEnvironment(key, value);
    });
  }

  /**
   * Grant write permissions for managing virtual keys
   */
  public grantVirtualKeyManagement(lambdaFunction: lambda.Function): void {
    this.grantRead(lambdaFunction);

    const virtualKeyPolicy = new iam.PolicyStatement({
      actions: [
        'secretsmanager:CreateSecret',
        'secretsmanager:UpdateSecret',
        'secretsmanager:DeleteSecret',
        'secretsmanager:TagResource',
      ],
      resources: ['arn:aws:secretsmanager:*:*:secret:litellm/virtual-keys/*'],
    });

    lambdaFunction.addToRolePolicy(virtualKeyPolicy);
  }
}
