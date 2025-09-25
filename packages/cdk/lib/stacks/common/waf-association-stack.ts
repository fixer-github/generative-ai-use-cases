import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { CommonWebAcl } from '../../construct';
import { ProcessedStackInput } from '../../stack-input';

export interface WafAssociationStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly apiGatewayArn: string;
  readonly userPoolArn: string;
}

export class WafAssociationStack extends Stack {
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: WafAssociationStackProps) {
    super(scope, id, props);

    const params = props.params;

    if (
      params.allowedIpV4AddressRanges ||
      params.allowedIpV6AddressRanges ||
      params.allowedCountryCodes
    ) {
      const regionalWaf = new CommonWebAcl(this, 'RegionalWaf', {
        scope: 'REGIONAL',
        allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
        allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
        allowedCountryCodes: params.allowedCountryCodes,
      });

      new CfnWebACLAssociation(this, 'ApiWafAssociation', {
        resourceArn: props.apiGatewayArn,
        webAclArn: regionalWaf.webAclArn,
      });

      new CfnWebACLAssociation(this, 'UserPoolWafAssociation', {
        resourceArn: props.userPoolArn,
        webAclArn: regionalWaf.webAclArn,
      });

      this.webAclArn = regionalWaf.webAclArn;
    } else {
      this.webAclArn = '';
    }
  }
}
