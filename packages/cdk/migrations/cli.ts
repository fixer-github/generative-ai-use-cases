#!/usr/bin/env node

import { Command } from 'commander';
import { ResourceDiscovery } from './discovery';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { OldBot, OldConversation } from './types/old-schema';
import {
  transformBotToAssistant,
  validateAssistantTransformation,
  AssistantTransformOptions,
  Assistant,
} from './transformers/assistant';
import {
  transformConversationToChat,
  transformConversationMessages,
  validateChatTransformation,
  ChatTransformOptions,
  ChatMessage,
} from './transformers/chat';
import { DynamoDBWriter } from './writers/dynamo';
import { S3Writer } from './writers/s3';
import { OpenSearchWriter } from './writers/opensearch';
import { MigrationValidator } from './utils/validation';
import * as fs from 'fs';
import * as readline from 'readline';

const program = new Command();

program
  .name('migrate-rag-to-assistant')
  .description(
    'Migrate old Python-based bedrock-chat data to new TypeScript Assistant feature'
  )
  .version('1.0.0');

// Discovery command
program
  .command('discover')
  .description('Discover old DynamoDB tables, S3 buckets, and OpenSearch domains')
  .requiredOption('--region <region>', 'AWS region')
  .option('--table-prefix <prefix>', 'DynamoDB table name prefix')
  .option('--output <path>', 'Output path for report JSON')
  .action(async (options) => {
    try {
      const discovery = new ResourceDiscovery({
        region: options.region,
        tablePrefix: options.tablePrefix,
      });

      const report = await discovery.generateReport();
      discovery.printReport(report);

      if (options.output) {
        fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
        console.log(`Report saved to: ${options.output}`);
      }
    } catch (error) {
      console.error('Discovery failed:', error);
      process.exit(1);
    }
  });

// Migrate command
program
  .command('migrate')
  .description('Execute full migration from old to new schema')
  .requiredOption('--region <region>', 'AWS region')
  .requiredOption('--old-bot-table <name>', 'Old bot table name')
  .requiredOption('--old-conversation-table <name>', 'Old conversation table name')
  .requiredOption('--new-assistant-table <name>', 'New assistant table name')
  .requiredOption('--new-chat-table <name>', 'New chat history table name')
  .requiredOption('--tenant-id <id>', 'Default tenant ID for migrated data')
  .option('--dry-run', 'Perform dry run without writing data', false)
  .option('--batch-size <number>', 'Batch size for processing', '25')
  .option('--skip-assistants', 'Skip assistant migration', false)
  .option('--skip-chats', 'Skip chat migration', false)
  .option('--skip-s3', 'Skip S3 file migration', false)
  .action(async (options) => {
    try {
      console.log('\n=== Starting Migration ===\n');
      console.log(`Region: ${options.region}`);
      console.log(`Tenant ID: ${options.tenantId}`);
      console.log(`Dry Run: ${options.dryRun}`);
      console.log('');

      // Confirmation prompt
      if (!options.dryRun) {
        const confirmed = await confirmMigration();
        if (!confirmed) {
          console.log('Migration cancelled.');
          process.exit(0);
        }
      }

      const dynamoClient = new DynamoDBClient({ region: options.region });
      const docClient = DynamoDBDocumentClient.from(dynamoClient);
      const s3Client = new S3Client({ region: options.region });

      const writer = new DynamoDBWriter({
        region: options.region,
        assistantTableName: options.newAssistantTable,
        chatHistoryTableName: options.newChatTable,
        batchSize: parseInt(options.batchSize),
        dryRun: options.dryRun,
      });

      // Migrate Assistants
      if (!options.skipAssistants) {
        console.log('\n--- Migrating Assistants ---\n');

        const transformOptions: AssistantTransformOptions = {
          defaultTenantId: options.tenantId,
        };

        const assistants: Assistant[] = [];
        const errors: Array<{ botId: string; error: string }> = [];
        let scannedCount = 0;

        // Stream bots and transform incrementally
        for await (const oldBot of scanTableStream<OldBot>(
          docClient,
          options.oldBotTable
        )) {
          scannedCount++;
          try {
            const assistant = transformBotToAssistant(oldBot, transformOptions);
            const validation = validateAssistantTransformation(oldBot, assistant);

            if (validation.valid) {
              assistants.push(assistant);
            } else {
              errors.push({
                botId: oldBot.BotId,
                error: `Validation failed: ${validation.errors.join(', ')}`,
              });
            }
          } catch (error) {
            errors.push({
              botId: oldBot.BotId,
              error: `Transform error: ${error instanceof Error ? error.message : String(error)}`,
            });
          }

          // Progress reporting
          if (scannedCount % 100 === 0) {
            console.log(`Scanned ${scannedCount} bots...`);
          }
        }

        console.log(`Scanned ${scannedCount} old bots`);
        console.log(`Transformed ${assistants.length} assistants`);
        if (errors.length > 0) {
          console.warn(`Transform errors: ${errors.length}`);
          errors.slice(0, 5).forEach((err) => {
            console.warn(`  - ${err.botId}: ${err.error}`);
          });
        }

        await writer.writeAssistants(assistants);
        writer.printProgress();
      }

      // Migrate Chats
      if (!options.skipChats) {
        console.log('\n--- Migrating Chats ---\n');

        const transformOptions: ChatTransformOptions = {
          defaultTenantId: options.tenantId,
          s3Client,
          region: options.region,
        };

        const errors: Array<{ conversationId: string; error: string }> = [];
        let scannedCount = 0;
        let writtenCount = 0;

        // True streaming: transform and write one chat at a time to avoid O(n²) memory
        for await (const oldConversation of scanTableStream<OldConversation>(
          docClient,
          options.oldConversationTable
        )) {
          scannedCount++;
          try {
            const chat = transformConversationToChat(oldConversation, transformOptions);
            const validation = validateChatTransformation(oldConversation, chat);

            if (!validation.valid) {
              errors.push({
                conversationId: oldConversation.SK,
                error: `Validation failed: ${validation.errors.join(', ')}`,
              });
              continue;
            }

            const chatMessages = await transformConversationMessages(
              oldConversation,
              chat,
              transformOptions
            );

            // Write immediately to avoid memory buildup
            const written = await writer.writeChatWithMessages(chat, chatMessages);
            if (written) {
              writtenCount++;
            }
          } catch (error) {
            errors.push({
              conversationId: oldConversation.SK,
              error: `Transform error: ${error instanceof Error ? error.message : String(error)}`,
            });
          }

          // Progress reporting
          if (scannedCount % 100 === 0) {
            console.log(`Progress: ${scannedCount} scanned, ${writtenCount} written...`);
          }
        }

        console.log(`Scanned ${scannedCount} old conversations`);
        console.log(`Written ${writtenCount} new chats`);
        if (errors.length > 0) {
          console.warn(`Transform errors: ${errors.length}`);
          errors.slice(0, 5).forEach((err) => {
            console.warn(`  - ${err.conversationId}: ${err.error}`);
          });
        }

        writer.printProgress();
      }

      console.log('\n=== Migration Complete ===\n');
    } catch (error) {
      console.error('Migration failed:', error);
      process.exit(1);
    }
  });

// Validate command
program
  .command('validate')
  .description('Validate migration by comparing old and new data')
  .requiredOption('--region <region>', 'AWS region')
  .requiredOption('--old-bot-table <name>', 'Old bot table name')
  .requiredOption('--old-conversation-table <name>', 'Old conversation table name')
  .requiredOption('--new-assistant-table <name>', 'New assistant table name')
  .requiredOption('--new-chat-table <name>', 'New chat history table name')
  .option('--sample-size <number>', 'Number of records to sample', '20')
  .option('--output <path>', 'Output path for validation report')
  .action(async (options) => {
    try {
      const validator = new MigrationValidator({
        region: options.region,
        oldBotTableName: options.oldBotTable,
        oldConversationTableName: options.oldConversationTable,
        newAssistantTableName: options.newAssistantTable,
        newChatHistoryTableName: options.newChatTable,
        sampleSize: parseInt(options.sampleSize),
        outputPath: options.output,
      });

      const report = await validator.generateReport();
      validator.printReport(report);

      if (options.output) {
        await validator.saveReport(report);
      }
    } catch (error) {
      console.error('Validation failed:', error);
      process.exit(1);
    }
  });

// OpenSearch stub command
program
  .command('opensearch-info')
  .description('Display OpenSearch migration instructions')
  .requiredOption('--region <region>', 'AWS region')
  .option('--source-domain <domain>', 'Source OpenSearch domain')
  .option('--export-path <path>', 'Export directory path')
  .action(async (options) => {
    const osWriter = new OpenSearchWriter({
      region: options.region,
      sourceDomain: options.sourceDomain,
      exportPath: options.exportPath,
    });

    await osWriter.prepareExportDirectory();
    osWriter.printInstructions();
  });

/**
 * Stream DynamoDB table records using async generator
 * Prevents memory exhaustion by yielding items one at a time
 */
async function* scanTableStream<T>(
  docClient: DynamoDBDocumentClient,
  tableName: string
): AsyncGenerator<T, void, undefined> {
  let lastEvaluatedKey: any = undefined;
  let totalScanned = 0;

  do {
    const command = new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastEvaluatedKey,
    });

    const response = await docClient.send(command);

    if (response.Items) {
      for (const item of response.Items) {
        totalScanned++;
        yield item as T;
      }
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);
}

/**
 * Prompt user for confirmation
 */
async function confirmMigration(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      '\nThis will write data to DynamoDB. Are you sure? (yes/no): ',
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
      }
    );
  });
}

program.parse();
