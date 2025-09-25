import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Database, TenantManager } from '../../construct';
import { ProcessedStackInput } from '../../stack-input';

export interface DataStackProps extends StackProps {
  readonly params: ProcessedStackInput;
}

export class DataStack extends Stack {
  public readonly table: Table;
  public readonly statsTable: Table;
  public readonly database: Database;
  public readonly tenantManager: TenantManager;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const params = props.params;

    const database = new Database(this, 'Database');

    const tenantManager = new TenantManager(this, 'TenantManager', {
      environment: params.env,
      enableAutoDelete: params.enableAutoDelete,
    });

    this.table = database.table;
    this.statsTable = database.statsTable;
    this.database = database;
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