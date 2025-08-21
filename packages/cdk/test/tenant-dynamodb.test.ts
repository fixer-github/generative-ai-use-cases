import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { TenantDynamoDB } from '../lib/construct/tenant-dynamodb';
import { TenantDynamoDBStack } from '../lib/stacks/tenant/tenant-dynamodb-stack';

describe('TenantDynamoDB Tests', () => {
  let app: App;
  let stack: Stack;

  beforeEach(() => {
    app = new App();
    stack = new Stack(app, 'TestStack');
  });

  describe('TenantDynamoDB Construct', () => {
    test('Should create tenant-specific DynamoDB tables', () => {
      // Arrange
      const tenantId = 'test-tenant-123';

      // Act
      new TenantDynamoDB(stack, 'TestTenantDynamoDB', {
        tenantId,
      });

      // Assert
      const template = Template.fromStack(stack);
      
      // Check ChatHistory table
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ChatHistory-tenant-test-tenant-123',
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });

      // Check TokenUsageStats table
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'TokenUsageStats-tenant-test-tenant-123',
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });

      // Check UseCaseBuilder table
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'UseCaseBuilder-tenant-test-tenant-123',
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });

      // Check that all three tables are created
      const resources = template.toJSON().Resources;
      const tables = Object.values(resources).filter((r: any) => r.Type === 'AWS::DynamoDB::Table');
      expect(tables.length).toBe(3);
    });

    test('Should sanitize tenant ID for resource names', () => {
      // Arrange
      const tenantId = 'test@tenant#123';

      // Act
      new TenantDynamoDB(stack, 'TestTenantDynamoDB', {
        tenantId,
      });

      // Assert
      const template = Template.fromStack(stack);
      
      // Check that special characters are replaced with hyphens
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ChatHistory-tenant-test-tenant-123',
      });
    });

    test('Should throw error if tenant ID is empty', () => {
      // Arrange & Act & Assert
      expect(() => {
        new TenantDynamoDB(stack, 'TestTenantDynamoDB', {
          tenantId: '',
        });
      }).toThrow('Tenant ID is required');
    });

    test('Should create Use Case Builder table with correct schema', () => {
      // Arrange
      const tenantId = 'test-tenant-usecase';

      // Act
      new TenantDynamoDB(stack, 'TestTenantDynamoDB', {
        tenantId,
      });

      // Assert
      const template = Template.fromStack(stack);
      
      // Check Use Case Builder table structure
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'UseCaseBuilder-tenant-test-tenant-usecase',
        KeySchema: [
          { AttributeName: 'id', KeyType: 'HASH' },
          { AttributeName: 'dataType', KeyType: 'RANGE' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' },
          { AttributeName: 'dataType', AttributeType: 'S' },
          { AttributeName: 'useCaseId', AttributeType: 'S' }
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'UseCaseIdIndexName',
            KeySchema: [
              { AttributeName: 'useCaseId', KeyType: 'HASH' },
              { AttributeName: 'dataType', KeyType: 'RANGE' }
            ],
            Projection: { ProjectionType: 'ALL' }
          }
        ]
      });
    });

    test('Should support custom table base names', () => {
      // Arrange
      const tenantId = 'test-tenant-custom';

      // Act
      new TenantDynamoDB(stack, 'TestTenantDynamoDB', {
        tenantId,
        chatHistoryTableBaseName: 'CustomChat',
        tokenUsageStatsTableBaseName: 'CustomStats',
        useCaseBuilderTableBaseName: 'CustomUseCase',
      });

      // Assert
      const template = Template.fromStack(stack);
      
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'CustomChat-tenant-test-tenant-custom',
      });
      
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'CustomStats-tenant-test-tenant-custom',
      });
      
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'CustomUseCase-tenant-test-tenant-custom',
      });
    });
  });

  describe('TenantDynamoDBStack', () => {
    test('Should create stack with direct tenant ID', () => {
      // Arrange & Act
      const tenantStack = new TenantDynamoDBStack(app, 'TenantStack', {
        tenantId: 'test-tenant-456',
      });

      // Assert
      const template = Template.fromStack(tenantStack);
      
      // Check tables are created
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ChatHistory-tenant-test-tenant-456',
      });
      
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'TokenUsageStats-tenant-test-tenant-456',
      });
      
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'UseCaseBuilder-tenant-test-tenant-456',
      });

      // Check outputs
      template.hasOutput('StackChatHistoryTableName', {});
      template.hasOutput('StackTokenUsageStatsTableName', {});
      template.hasOutput('StackUseCaseBuilderTableName', {});
    });

    test('Should create stack with parameter when tenant ID not provided', () => {
      // Arrange & Act
      const tenantStack = new TenantDynamoDBStack(app, 'TenantStack');

      // Assert
      const template = Template.fromStack(tenantStack);
      
      // Check parameter is created
      template.hasParameter('TenantId', {
        Type: 'String',
        Description: 'The tenant identifier for the DynamoDB tables',
        AllowedPattern: '^[a-zA-Z0-9-]+$',
      });
    });
  });

  describe('TenantDynamoDB Helper Methods', () => {
    test('Should generate correct table name', () => {
      // Arrange & Act
      const tableName = TenantDynamoDB.generateTableName('MyTable', 'tenant-123');

      // Assert
      expect(tableName).toBe('MyTable-tenant-tenant-123');
    });

    test('Should create additional tenant table', () => {
      // Arrange
      const tenantId = 'test-tenant-789';
      const tenantDynamoDB = new TenantDynamoDB(stack, 'TestTenantDynamoDB', {
        tenantId,
      });

      // Act
      tenantDynamoDB.createTenantTable(
        'CustomTable',
        'CustomData',
        { name: 'pk', type: 'S' as any },
        { name: 'sk', type: 'S' as any }
      );

      // Assert
      const template = Template.fromStack(stack);
      
      // Check custom table is created
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'CustomData-tenant-test-tenant-789',
      });
    });
  });
});