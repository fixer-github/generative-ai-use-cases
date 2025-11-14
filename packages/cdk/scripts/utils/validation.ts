import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { Assistant, Chat } from 'generative-ai-use-cases';
import { OldBot, OldConversation } from '../types/old-schema';
import * as fs from 'fs';
import * as path from 'path';

export type ValidationOptions = {
  region: string;
  oldBotTableName: string;
  oldConversationTableName: string;
  newAssistantTableName: string;
  newChatHistoryTableName: string;
  sampleSize?: number;
  outputPath?: string;
};

export type ValidationReport = {
  timestamp: string;
  oldRecordCounts: {
    bots: number;
    conversations: number;
  };
  newRecordCounts: {
    assistants: number;
    chats: number;
    messages: number;
  };
  sampleComparisons: SampleComparison[];
  summary: {
    totalValidations: number;
    passed: number;
    failed: number;
    warnings: number;
  };
};

export type SampleComparison = {
  oldId: string;
  newId: string;
  type: 'assistant' | 'chat';
  matches: boolean;
  differences: string[];
  warnings: string[];
};

export class MigrationValidator {
  private client: DynamoDBClient;

  constructor(private options: ValidationOptions) {
    this.client = new DynamoDBClient({ region: options.region });
  }

  /**
   * Count records in a table
   */
  private async countTableRecords(tableName: string): Promise<number> {
    let count = 0;
    let lastEvaluatedKey: any = undefined;

    do {
      const command = new ScanCommand({
        TableName: tableName,
        Select: 'COUNT',
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const response = await this.client.send(command);
      count += response.Count || 0;
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return count;
  }

  /**
   * Sample records from a table
   */
  private async sampleTableRecords(
    tableName: string,
    sampleSize: number
  ): Promise<any[]> {
    const records: any[] = [];
    let lastEvaluatedKey: any = undefined;

    do {
      const command = new ScanCommand({
        TableName: tableName,
        Limit: Math.min(sampleSize - records.length, 100),
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const response = await this.client.send(command);

      if (response.Items) {
        for (const item of response.Items) {
          records.push(unmarshall(item));
          if (records.length >= sampleSize) {
            break;
          }
        }
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey && records.length < sampleSize);

    return records;
  }

  /**
   * Compare old bot with new assistant
   */
  private compareBot(oldBot: OldBot, newAssistant: Assistant): SampleComparison {
    const differences: string[] = [];
    const warnings: string[] = [];

    // Check name/title
    if (oldBot.Title !== newAssistant.name) {
      differences.push(
        `Title mismatch: "${oldBot.Title}" vs "${newAssistant.name}"`
      );
    }

    // Check description
    if (oldBot.Description !== newAssistant.description) {
      warnings.push('Description may have been normalized');
    }

    // Check knowledge sources count
    const oldKnowledgeCount =
      (oldBot.Knowledge?.s3_urls?.length || 0) +
      (oldBot.Knowledge?.source_urls?.length || 0) +
      (oldBot.Knowledge?.sitemap_urls?.length || 0) +
      (oldBot.Knowledge?.filenames?.length || 0);

    if (oldKnowledgeCount !== newAssistant.knowledgeSources.length) {
      warnings.push(
        `Knowledge source count: ${oldKnowledgeCount} vs ${newAssistant.knowledgeSources.length}`
      );
    }

    // Check sync status
    const oldStatus = oldBot.SyncStatus.toUpperCase();
    if (oldStatus !== newAssistant.syncStatus) {
      differences.push(
        `Sync status: ${oldStatus} vs ${newAssistant.syncStatus}`
      );
    }

    // Check timestamps
    const oldCreateTime = new Date(oldBot.CreateTime * 1000).toISOString();
    if (!newAssistant.createdDate.startsWith(oldCreateTime.split('T')[0])) {
      warnings.push('Creation date may have been adjusted');
    }

    return {
      oldId: oldBot.BotId,
      newId: newAssistant.assistantId,
      type: 'assistant',
      matches: differences.length === 0,
      differences,
      warnings,
    };
  }

  /**
   * Compare old conversation with new chat
   */
  private compareConversation(
    oldConversation: OldConversation,
    newChat: Chat
  ): SampleComparison {
    const differences: string[] = [];
    const warnings: string[] = [];

    // Check title
    if (oldConversation.Title !== newChat.title) {
      differences.push(
        `Title mismatch: "${oldConversation.Title}" vs "${newChat.title}"`
      );
    }

    // Check timestamps
    const oldCreateTime = new Date(
      oldConversation.CreateTime * 1000
    ).toISOString();
    if (!newChat.createdDate.startsWith(oldCreateTime.split('T')[0])) {
      warnings.push('Creation date may have been adjusted');
    }

    // Extract conversation ID
    const skMatch = oldConversation.SK.match(/#CONV#(.+)$/);
    const oldConvId = skMatch ? skMatch[1] : oldConversation.SK;

    return {
      oldId: oldConvId,
      newId: newChat.chatId,
      type: 'chat',
      matches: differences.length === 0,
      differences,
      warnings,
    };
  }

  /**
   * Validate bot migration
   */
  async validateBots(): Promise<SampleComparison[]> {
    const sampleSize = this.options.sampleSize || 10;
    console.log(`Sampling ${sampleSize} bots for validation...`);

    const oldBots = (await this.sampleTableRecords(
      this.options.oldBotTableName,
      sampleSize
    )) as OldBot[];
    const newAssistants = (await this.sampleTableRecords(
      this.options.newAssistantTableName,
      sampleSize
    )) as Assistant[];

    const comparisons: SampleComparison[] = [];

    for (let i = 0; i < Math.min(oldBots.length, newAssistants.length); i++) {
      comparisons.push(this.compareBot(oldBots[i], newAssistants[i]));
    }

    return comparisons;
  }

  /**
   * Validate conversation migration
   */
  async validateConversations(): Promise<SampleComparison[]> {
    const sampleSize = this.options.sampleSize || 10;
    console.log(`Sampling ${sampleSize} conversations for validation...`);

    const oldConversations = (await this.sampleTableRecords(
      this.options.oldConversationTableName,
      sampleSize
    )) as OldConversation[];
    const newChats = (await this.sampleTableRecords(
      this.options.newChatHistoryTableName,
      sampleSize
    )) as Chat[];

    const comparisons: SampleComparison[] = [];

    for (
      let i = 0;
      i < Math.min(oldConversations.length, newChats.length);
      i++
    ) {
      comparisons.push(
        this.compareConversation(oldConversations[i], newChats[i])
      );
    }

    return comparisons;
  }

  /**
   * Generate full validation report
   */
  async generateReport(): Promise<ValidationReport> {
    console.log('Generating validation report...');

    // Count records
    console.log('Counting old records...');
    const oldBotCount = await this.countTableRecords(
      this.options.oldBotTableName
    );
    const oldConversationCount = await this.countTableRecords(
      this.options.oldConversationTableName
    );

    console.log('Counting new records...');
    const newAssistantCount = await this.countTableRecords(
      this.options.newAssistantTableName
    );
    const newChatCount = await this.countTableRecords(
      this.options.newChatHistoryTableName
    );

    // Sample comparisons
    const botComparisons = await this.validateBots();
    const chatComparisons = await this.validateConversations();
    const allComparisons = [...botComparisons, ...chatComparisons];

    // Calculate summary
    const passed = allComparisons.filter((c) => c.matches).length;
    const failed = allComparisons.filter((c) => !c.matches).length;
    const warnings = allComparisons.reduce(
      (sum, c) => sum + c.warnings.length,
      0
    );

    const report: ValidationReport = {
      timestamp: new Date().toISOString(),
      oldRecordCounts: {
        bots: oldBotCount,
        conversations: oldConversationCount,
      },
      newRecordCounts: {
        assistants: newAssistantCount,
        chats: newChatCount,
        messages: 0, // Would need separate counting logic
      },
      sampleComparisons: allComparisons,
      summary: {
        totalValidations: allComparisons.length,
        passed,
        failed,
        warnings,
      },
    };

    return report;
  }

  /**
   * Save report to file
   */
  async saveReport(report: ValidationReport): Promise<string> {
    const outputPath =
      this.options.outputPath ||
      path.join(process.cwd(), 'migration-validation-report.json');

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`Validation report saved to: ${outputPath}`);

    return outputPath;
  }

  /**
   * Print report summary
   */
  printReport(report: ValidationReport): void {
    console.log('\n=== Migration Validation Report ===\n');
    console.log(`Timestamp: ${report.timestamp}\n`);

    console.log('Record Counts:');
    console.log(`  Old Bots: ${report.oldRecordCounts.bots}`);
    console.log(`  New Assistants: ${report.newRecordCounts.assistants}`);
    console.log(`  Old Conversations: ${report.oldRecordCounts.conversations}`);
    console.log(`  New Chats: ${report.newRecordCounts.chats}\n`);

    console.log('Sample Validation:');
    console.log(`  Total Samples: ${report.summary.totalValidations}`);
    console.log(`  Passed: ${report.summary.passed}`);
    console.log(`  Failed: ${report.summary.failed}`);
    console.log(`  Warnings: ${report.summary.warnings}\n`);

    if (report.summary.failed > 0) {
      console.log('Failed Validations:');
      for (const comparison of report.sampleComparisons) {
        if (!comparison.matches) {
          console.log(`  ${comparison.type}: ${comparison.oldId}`);
          comparison.differences.forEach((diff) => {
            console.log(`    - ${diff}`);
          });
        }
      }
      console.log('');
    }

    if (report.summary.warnings > 0) {
      console.log('Sample Warnings:');
      for (const comparison of report.sampleComparisons.slice(0, 5)) {
        if (comparison.warnings.length > 0) {
          console.log(`  ${comparison.type}: ${comparison.oldId}`);
          comparison.warnings.forEach((warning) => {
            console.log(`    - ${warning}`);
          });
        }
      }
      console.log('');
    }

    console.log('===================================\n');
  }
}
