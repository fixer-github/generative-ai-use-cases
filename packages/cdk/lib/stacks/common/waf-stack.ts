import { Stack, StackProps } from 'aws-cdk-lib';
import { ProcessedStackInput } from '../../stack-input';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { CommonWebAcl } from '../../construct';
import { CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';

interface WafStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly restApi: RestApi;
  readonly userPool: UserPool;
}

class WafStack extends Stack {
  readonly regionalWaf: CommonWebAcl;

  constructor(scope: Construct, id: string, props: WafStackProps) {
    super(scope, id, props);

    const { params, restApi, userPool } = props;

    const regionalWaf = new CommonWebAcl(this, 'RegionalWaf', {
      scope: 'REGIONAL',
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
      allowedCountryCodes: params.allowedCountryCodes,
    });
    new CfnWebACLAssociation(this, 'ApiWafAssociation', {
      resourceArn: restApi.deploymentStage.stageArn,
      webAclArn: regionalWaf.webAclArn,
    });
    new CfnWebACLAssociation(this, 'UserPoolWafAssociation', {
      resourceArn: userPool.userPoolArn,
      webAclArn: regionalWaf.webAclArn,
    });

    this.regionalWaf = regionalWaf;
  }
}

export default WafStack;
