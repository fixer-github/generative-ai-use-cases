/**
 * Task Execution Log Handlers
 */

import { APIGatewayProxyResult } from 'aws-lambda';
import {
  getTaskIncludingDeleted,
  listExecutions,
  getExecution,
  listExecutionsByUser,
} from '../repository';
import { successResponse, errorResponse } from '../utils/response-utils';

export async function handleListExecutions(
  userId: string,
  taskId: string,
  limit?: number
): Promise<APIGatewayProxyResult> {
  // Verify task ownership (including deleted tasks for history access)
  const task = await getTaskIncludingDeleted(userId, taskId);
  if (!task) {
    return errorResponse('Task not found', 404);
  }

  const executions = await listExecutions(taskId, limit || 20);
  return successResponse({ executions });
}

export async function handleGetExecution(
  userId: string,
  taskId: string,
  executionId: string
): Promise<APIGatewayProxyResult> {
  // Verify task ownership (including deleted tasks for history access)
  const task = await getTaskIncludingDeleted(userId, taskId);
  if (!task) {
    return errorResponse('Task not found', 404);
  }

  const execution = await getExecution(taskId, executionId);
  if (!execution) {
    return errorResponse('Execution not found', 404);
  }

  return successResponse({ execution });
}

export async function handleListExecutionsByUser(
  userId: string,
  startDate: string,
  endDate: string
): Promise<APIGatewayProxyResult> {
  if (!startDate || !endDate) {
    return errorResponse('startDate and endDate query parameters are required');
  }

  const executions = await listExecutionsByUser(userId, startDate, endDate);
  return successResponse({ executions });
}
