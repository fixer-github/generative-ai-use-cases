import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { IVpc, ISecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { Transcribe } from '../construct/transcribe';

/**
 * TranscribeNestedStack
 *
 * Child NestedStack carved out of the parent stack for the transcription feature.
 * Carries the whole Transcribe construct: AudioBucket / TranscriptBucket (+CORS), the
 * 3 Lambdas (signed-url / start / get) and the `/transcribe/*` routes.
 *
 * Buckets move into the child and are re-created empty (DESTROY + autoDelete; existing
 * objects are lost — accepted per the dev/PoC data-loss decision). The
 * DeletionPolicySetter(DESTROY) Aspect on the parent propagates into this child.
 *
 * Cross-stack note: the construct attaches an inline policy
 * (transcribe:StartStreamTranscriptionWebSocket) to the parent IdentityPool's
 * authenticatedRole. That Policy resource lives in this child and references the parent
 * role (child -> parent), so authenticated users keep the streaming-transcribe permission.
 * This must be confirmed at runtime (memo §8 step2): an authenticated user must be able to
 * actually run transcription after deploy B.
 *
 * Child -> parent references are one-directional: RestApi (restApiId/rootResourceId),
 * UserPool, and IdentityPool.authenticatedRole. The parent must wire
 * `api.api.latestDeployment?.node.addDependency(thisStack)`.
 */
export interface TranscribeNestedStackProps extends NestedStackProps {
  readonly userPool: UserPool;
  readonly idPool: IdentityPool;
  readonly api: RestApi;
  readonly allowedIpV4AddressRanges?: string[] | null;
  readonly allowedIpV6AddressRanges?: string[] | null;
  readonly vpc?: IVpc;
  readonly securityGroups?: ISecurityGroup[];
}

export class TranscribeNestedStack extends NestedStack {
  constructor(scope: Construct, id: string, props: TranscribeNestedStackProps) {
    super(scope, id, props);

    new Transcribe(this, 'Transcribe', {
      userPool: props.userPool,
      idPool: props.idPool,
      api: props.api,
      allowedIpV4AddressRanges: props.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: props.allowedIpV6AddressRanges,
      vpc: props.vpc,
      securityGroups: props.securityGroups,
    });
  }
}
