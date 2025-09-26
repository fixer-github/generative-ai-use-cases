import { Stack, StackProps } from 'aws-cdk-lib';
import { ProcessedStackInput } from '../../stack-input';
import { Construct } from 'constructs';
import { Database } from '../../construct';

interface DatabaseStackProps extends StackProps {
  params: ProcessedStackInput;
}

class DatabaseStack extends Stack {
  readonly database: Database;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // Database
    const database = new Database(this, 'Database');

    this.database = database;
  }
}

export default DatabaseStack;
