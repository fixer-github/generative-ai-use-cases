/**
 * Scheduler API Router
 *
 * Routes:
 *   POST   /schedules                                    → createTask
 *   GET    /schedules                                    → listTasks
 *   GET    /schedules/executions                         → listExecutionsByUser (calendar)
 *   GET    /schedules/{taskId}                           → getTask
 *   PUT    /schedules/{taskId}                           → updateTask
 *   DELETE /schedules/{taskId}                           → deleteTask
 *   GET    /schedules/{taskId}/executions                → listExecutions
 *   GET    /schedules/{taskId}/executions/{executionId}  → getExecution
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  handleCreateTask,
  handleListTasks,
  handleGetTask,
  handleUpdateTask,
  handleDeleteTask,
} from './handlers/task-handlers';
import {
  handleListExecutions,
  handleGetExecution,
  handleListExecutionsByUser,
} from './handlers/execution-handlers';
import { errorResponse } from './utils/response-utils';

export async function routeRequest(
  event: APIGatewayProxyEvent,
  userId: string
): Promise<APIGatewayProxyResult> {
  const { resource, httpMethod, pathParameters, body, queryStringParameters } =
    event;

  try {
    // POST /schedules
    if (resource === '/schedules' && httpMethod === 'POST') {
      if (!body) return errorResponse('Request body is required');
      return await handleCreateTask(userId, JSON.parse(body));
    }

    // GET /schedules
    if (resource === '/schedules' && httpMethod === 'GET') {
      return await handleListTasks(userId);
    }

    // GET /schedules/executions (calendar view - user-wide execution query)
    if (resource === '/schedules/executions' && httpMethod === 'GET') {
      const startDate = queryStringParameters?.startDate || '';
      const endDate = queryStringParameters?.endDate || '';
      return await handleListExecutionsByUser(userId, startDate, endDate);
    }

    // GET /schedules/{taskId}
    if (resource === '/schedules/{taskId}' && httpMethod === 'GET') {
      const taskId = pathParameters?.taskId;
      if (!taskId) return errorResponse('taskId is required');
      return await handleGetTask(userId, taskId);
    }

    // PUT /schedules/{taskId}
    if (resource === '/schedules/{taskId}' && httpMethod === 'PUT') {
      const taskId = pathParameters?.taskId;
      if (!taskId) return errorResponse('taskId is required');
      if (!body) return errorResponse('Request body is required');
      return await handleUpdateTask(userId, taskId, JSON.parse(body));
    }

    // DELETE /schedules/{taskId}
    if (resource === '/schedules/{taskId}' && httpMethod === 'DELETE') {
      const taskId = pathParameters?.taskId;
      if (!taskId) return errorResponse('taskId is required');
      return await handleDeleteTask(userId, taskId);
    }

    // GET /schedules/{taskId}/executions
    if (resource === '/schedules/{taskId}/executions' && httpMethod === 'GET') {
      const taskId = pathParameters?.taskId;
      if (!taskId) return errorResponse('taskId is required');
      const limit = queryStringParameters?.limit
        ? parseInt(queryStringParameters.limit, 10)
        : undefined;
      return await handleListExecutions(userId, taskId, limit);
    }

    // GET /schedules/{taskId}/executions/{executionId}
    if (
      resource === '/schedules/{taskId}/executions/{executionId}' &&
      httpMethod === 'GET'
    ) {
      const taskId = pathParameters?.taskId;
      const executionId = pathParameters?.executionId;
      if (!taskId || !executionId) {
        return errorResponse('taskId and executionId are required');
      }
      return await handleGetExecution(userId, taskId, executionId);
    }

    return errorResponse('Not found', 404);
  } catch (error) {
    console.error('Router error:', error);
    return errorResponse('Internal server error', 500);
  }
}
