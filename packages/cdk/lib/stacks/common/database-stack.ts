import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Database, TenantManager } from '../../construct';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { ProcessedStackInput } from '../../stack-input';

export interface DatabaseStackProps extends StackProps {
  readonly params: ProcessedStackInput;
}

export class DatabaseStack extends Stack {
  public readonly table: dynamodb.Table;
  public readonly statsTable: dynamodb.Table;
  public readonly tenantManager: TenantManager;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const params = props.params;

    const database = new Database(this, 'Database');

    const tenantManager = new TenantManager(this, 'TenantManager', {
      environment: params.env,
      enableAutoDelete: params.enableAutoDelete,
    });

    this.table = database.table;
    this.statsTable = database.statsTable;
    this.tenantManager = tenantManager;

    new CfnOutput(this, 'TableName', {
      value: database.table.tableName,
      exportName: `${this.stackName}-TableName`,
    });

    new CfnOutput(this, 'StatsTableName', {
      value: database.statsTable.tableName,
      exportName: `${this.stackName}-StatsTableName`,
    });

    new CfnOutput(this, 'TenantsTableName', {
      value: tenantManager.tenantsTable.tableName,
      exportName: `${this.stackName}-TenantsTableName`,
    });

    new CfnOutput(this, 'TenantRegistrationLambdaArn', {
      value: tenantManager.registrationLambda.functionArn,
      exportName: `${this.stackName}-TenantRegistrationLambdaArn`,
    });
  }
}