import { Duration } from 'aws-cdk-lib';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Trigger } from 'aws-cdk-lib/triggers';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { ISecurityGroup, IVpc } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';
import { ModelConfiguration } from 'generative-ai-use-cases';

export interface LicenseOpsProps {
  readonly licenseTable: ITable;
  readonly modelIds: ModelConfiguration[];
  readonly sendgridApiKey?: string | null;
  readonly mailFrom?: string | null;
  readonly licenseAdminAlertEmail?: string | null;
  readonly vpc?: IVpc;
  readonly securityGroups?: ISecurityGroup[];
}

/**
 * License operations:
 *  - daily USD/JPY rate refresh (requirement 17)
 *  - deploy-time seeding of plans / unit prices / settings / initial fx rate
 *
 * Note: the fx fetch calls an external API and therefore needs internet
 * egress. The closed-network mode is not used for the current deployment
 * (decision recorded in the requirements); in a closed network the previous
 * rate simply stays in place.
 */
export class LicenseOps extends Construct {
  constructor(scope: Construct, id: string, props: LicenseOpsProps) {
    super(scope, id);

    const updateFxRateFunction = new NodejsFunction(this, 'UpdateFxRate', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/updateFxRate.ts',
      timeout: Duration.minutes(1),
      environment: {
        LICENSE_TABLE_NAME: props.licenseTable.tableName,
        SENDGRID_API_KEY: props.sendgridApiKey ?? '',
        MAIL_FROM: props.mailFrom ?? '',
      },
      vpc: props.vpc,
      securityGroups: props.securityGroups,
    });
    props.licenseTable.grantReadWriteData(updateFxRateFunction);

    // Daily at 09:05 JST (00:05 UTC)
    new Rule(this, 'DailyFxRateSchedule', {
      schedule: Schedule.cron({ minute: '5', hour: '0' }),
      targets: [new LambdaFunction(updateFxRateFunction)],
    });

    const seedFunction = new NodejsFunction(this, 'SeedLicenseData', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/seedLicenseData.ts',
      timeout: Duration.minutes(2),
      environment: {
        LICENSE_TABLE_NAME: props.licenseTable.tableName,
        MODEL_IDS: JSON.stringify(props.modelIds),
        LICENSE_ADMIN_ALERT_EMAIL: props.licenseAdminAlertEmail ?? '',
      },
      vpc: props.vpc,
      securityGroups: props.securityGroups,
    });
    props.licenseTable.grantReadWriteData(seedFunction);

    // Runs once on deploy (and again whenever the seed handler changes).
    // Existing items are never overwritten (conditional writes in the seeder).
    new Trigger(this, 'SeedLicenseDataTrigger', {
      handler: seedFunction,
      executeOnHandlerChange: true,
    });
  }
}
