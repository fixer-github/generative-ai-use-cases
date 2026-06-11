import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { IVpc, ISecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { AdminApi } from '../construct/admin-api';

/**
 * AdminNestedStack
 *
 * Child NestedStack carved out of the parent stack for the admin console API
 * (Cognito user / group / password-policy management). Holds the 9 admin Lambdas,
 * its own Authorizer and the `/admin/*` routes. Owns no stateful resources, which
 * makes it the safest domain to move first (the step 0 spike).
 *
 * Child -> parent references are one-directional: only RestApi (restApiId /
 * rootResourceId) and UserPool (arn / id). The parent must wire
 * `api.api.latestDeployment?.node.addDependency(thisStack)` (memo §4.4).
 */
export interface AdminNestedStackProps extends NestedStackProps {
  readonly userPool: UserPool;
  readonly api: RestApi;
  readonly vpc?: IVpc;
  readonly securityGroups?: ISecurityGroup[];
}

export class AdminNestedStack extends NestedStack {
  constructor(scope: Construct, id: string, props: AdminNestedStackProps) {
    super(scope, id, props);

    new AdminApi(this, 'AdminApi', {
      userPool: props.userPool,
      api: props.api,
      vpc: props.vpc,
      securityGroups: props.securityGroups,
    });
  }
}
