import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IFunction } from 'aws-cdk-lib/aws-lambda';

/**
 * Interface for TenantManager to allow using imported resources
 * from different stacks
 */
export interface ITenantManager {
  readonly tenantsTable: ITable;
  readonly registrationLambda: IFunction;
}