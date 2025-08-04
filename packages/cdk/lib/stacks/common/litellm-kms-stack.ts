import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';

export interface LiteLLMKmsStackProps extends StackProps {
  readonly allowedPrincipals?: iam.IPrincipal[];
  readonly enableKeyRotation?: boolean;
  readonly pendingWindowInDays?: number;
  readonly envSuffix?: string;
}

export class LiteLLMKmsStack extends Stack {
  public readonly kmsKey: kms.Key;
  public readonly kmsKeyAlias: kms.Alias;

  constructor(scope: Construct, id: string, props?: LiteLLMKmsStackProps) {
    super(scope, id, props);

    // Create KMS key for LiteLLM secrets encryption
    this.kmsKey = new kms.Key(this, 'LiteLLMKey', {
      description: 'KMS key for encrypting LiteLLM API keys and secrets',
      enableKeyRotation: props?.enableKeyRotation ?? true,
      pendingWindow: Duration.days(props?.pendingWindowInDays ?? 7),
      removalPolicy: RemovalPolicy.RETAIN,
      keyUsage: kms.KeyUsage.ENCRYPT_DECRYPT,
      keySpec: kms.KeySpec.SYMMETRIC_DEFAULT,
    });

    // Create an alias for easier reference
    const aliasName = props?.envSuffix 
      ? `alias/litellm-master-${props.envSuffix}`
      : 'alias/litellm-master';
    
    this.kmsKeyAlias = new kms.Alias(this, 'LiteLLMKeyAlias', {
      aliasName,
      targetKey: this.kmsKey,
    });

    // Add resource tags for cost allocation
    this.kmsKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'Enable IAM User Permissions',
        principals: [new iam.AccountRootPrincipal()],
        actions: ['kms:*'],
        resources: ['*'],
      })
    );

    // Grant decrypt permissions to allowed principals
    if (props?.allowedPrincipals) {
      props.allowedPrincipals.forEach((principal) => {
        this.kmsKey.grantDecrypt(principal);
        this.kmsKey.grant(principal, 'kms:DescribeKey');
      });
    }

    // Add CloudWatch alarm for failed decryption attempts
    new cw.Alarm(this, 'DecryptionFailureAlarm', {
      metric: new cw.Metric({
        namespace: 'AWS/KMS',
        metricName: 'NumberOfOperations',
        dimensionsMap: {
          KeyId: this.kmsKey.keyId,
          Operation: 'Decrypt',
        },
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 1,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Alert on excessive failed KMS decryption attempts',
    });

    // Output the KMS key details
    new CfnOutput(this, 'KmsKeyId', {
      value: this.kmsKey.keyId,
      description: 'KMS Key ID for LiteLLM secrets',
      exportName: `${this.stackName}-KmsKeyId`,
    });

    new CfnOutput(this, 'KmsKeyArn', {
      value: this.kmsKey.keyArn,
      description: 'KMS Key ARN for LiteLLM secrets',
      exportName: `${this.stackName}-KmsKeyArn`,
    });

    new CfnOutput(this, 'KmsKeyAlias', {
      value: this.kmsKeyAlias.aliasName,
      description: 'KMS Key Alias for LiteLLM secrets',
      exportName: `${this.stackName}-KmsKeyAlias`,
    });
  }
}