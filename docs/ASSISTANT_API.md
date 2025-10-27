# Assistant API Documentation

The Assistant API provides a comprehensive REST API for creating and managing AI assistants with RAG (Retrieval-Augmented Generation) capabilities. This API enables users to create custom assistants, upload documents for knowledge base integration, and interact with assistants through a conversational interface.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Endpoints](#endpoints)
  - [Create Assistant](#create-assistant)
  - [List Assistants](#list-assistants)
  - [Get Assistant](#get-assistant)
  - [Update Assistant](#update-assistant)
  - [Delete Assistant](#delete-assistant)
  - [Create Message](#create-message)
  - [List Messages](#list-messages)
- [Data Models](#data-models)
- [Error Handling](#error-handling)

## Overview

The Assistant API allows you to:

- Create custom AI assistants with specific instructions and model configurations
- Enable RAG capabilities by uploading documents from S3
- Manage assistant lifecycle (create, read, update, delete)
- Interact with assistants through a message-based interface
- Track conversation history with pagination support

### Key Features

- **Immediate List Updates**: Assistant lists update instantly using DynamoDB queries
- **Cost-Effective**: DynamoDB-based storage is more cost-effective than OpenSearch for metadata
- **RAG Support**: Optional document ingestion from S3 with vector search via OpenSearch Serverless
- **Multi-Model Support**: Compatible with various Bedrock models
- **TypeScript Implementation**: Type-safe implementation with full TypeScript support

## Authentication

All API requests require authentication using AWS Cognito. The API Gateway validates JWT tokens from the Cognito user pool and extracts the user identity from the `cognito:username` claim.

### Headers

```
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

## Endpoints

### Create Assistant

Create a new AI assistant with custom configuration.

**Endpoint:** `POST /assistants`

**Request Body:**

```json
{
  "name": "My Assistant",
  "description": "An assistant that helps with documentation",
  "instruction": "You are a helpful assistant that answers questions about documentation. Be concise and accurate.",
  "modelId": "anthropic.claude-v2",
  "ragEnabled": true,
  "s3Urls": [
    "s3://my-bucket/docs/guide.pdf",
    "s3://my-bucket/docs/reference.md"
  ]
}
```

**Request Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Display name for the assistant |
| description | string | Yes | Brief description of the assistant's purpose |
| instruction | string | Yes | System prompt/instructions for the assistant |
| modelId | string | Yes | Bedrock model ID (e.g., "anthropic.claude-v2") |
| ragEnabled | boolean | Yes | Enable RAG capabilities |
| s3Urls | string[] | No | S3 URLs for documents to ingest (required if ragEnabled is true) |

**Response (201 Created):**

```json
{
  "id": "user#john.doe",
  "createdDate": "1698765432000",
  "assistantId": "assistant#550e8400-e29b-41d4-a716-446655440000",
  "userId": "user#john.doe",
  "name": "My Assistant",
  "description": "An assistant that helps with documentation",
  "instruction": "You are a helpful assistant that answers questions about documentation. Be concise and accurate.",
  "modelId": "anthropic.claude-v2",
  "ragEnabled": true,
  "syncStatus": "QUEUED",
  "syncStatusReason": "",
  "s3Urls": [
    "s3://my-bucket/docs/guide.pdf",
    "s3://my-bucket/docs/reference.md"
  ],
  "updatedDate": "1698765432000"
}
```

**Example cURL:**

```bash
curl -X POST https://api.example.com/assistants \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Documentation Assistant",
    "description": "Helps with product documentation",
    "instruction": "You are a helpful assistant.",
    "modelId": "anthropic.claude-v2",
    "ragEnabled": true,
    "s3Urls": ["s3://my-bucket/docs/guide.pdf"]
  }'
```

**Error Responses:**

- `400 Bad Request`: Missing required fields (name, instruction, modelId)
- `500 Internal Server Error`: Server error during creation

---

### List Assistants

Retrieve a paginated list of assistants owned by the authenticated user.

**Endpoint:** `GET /assistants`

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| exclusiveStartKey | string | No | Pagination token from previous response |

**Response (200 OK):**

```json
{
  "assistants": [
    {
      "id": "user#john.doe",
      "createdDate": "1698765432000",
      "assistantId": "assistant#550e8400-e29b-41d4-a716-446655440000",
      "userId": "user#john.doe",
      "name": "Documentation Assistant",
      "description": "Helps with product documentation",
      "instruction": "You are a helpful assistant.",
      "modelId": "anthropic.claude-v2",
      "ragEnabled": true,
      "syncStatus": "SUCCEEDED",
      "syncStatusReason": "",
      "s3Urls": ["s3://my-bucket/docs/guide.pdf"],
      "updatedDate": "1698765432000"
    }
  ],
  "lastEvaluatedKey": "base64-encoded-key"
}
```

**Example cURL:**

```bash
curl -X GET "https://api.example.com/assistants" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**With pagination:**

```bash
curl -X GET "https://api.example.com/assistants?exclusiveStartKey=base64-encoded-key" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Error Responses:**

- `500 Internal Server Error`: Server error during retrieval

---

### Get Assistant

Retrieve details of a specific assistant.

**Endpoint:** `GET /assistants/{assistantId}`

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| assistantId | string | Yes | The assistant ID (without "assistant#" prefix) |

**Response (200 OK):**

```json
{
  "id": "user#john.doe",
  "createdDate": "1698765432000",
  "assistantId": "assistant#550e8400-e29b-41d4-a716-446655440000",
  "userId": "user#john.doe",
  "name": "Documentation Assistant",
  "description": "Helps with product documentation",
  "instruction": "You are a helpful assistant.",
  "modelId": "anthropic.claude-v2",
  "ragEnabled": true,
  "syncStatus": "SUCCEEDED",
  "syncStatusReason": "",
  "s3Urls": ["s3://my-bucket/docs/guide.pdf"],
  "updatedDate": "1698765432000"
}
```

**Example cURL:**

```bash
curl -X GET "https://api.example.com/assistants/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Error Responses:**

- `400 Bad Request`: Missing assistantId
- `403 Forbidden`: User does not own this assistant
- `404 Not Found`: Assistant not found
- `500 Internal Server Error`: Server error during retrieval

---

### Update Assistant

Update an existing assistant's configuration.

**Endpoint:** `PUT /assistants/{assistantId}`

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| assistantId | string | Yes | The assistant ID (without "assistant#" prefix) |

**Request Body:**

All fields are optional. Only provided fields will be updated.

```json
{
  "name": "Updated Assistant Name",
  "description": "Updated description",
  "instruction": "Updated instructions",
  "modelId": "anthropic.claude-3",
  "ragEnabled": true,
  "s3Urls": ["s3://my-bucket/docs/new-guide.pdf"]
}
```

**Response (200 OK):**

```json
{
  "id": "user#john.doe",
  "createdDate": "1698765432000",
  "assistantId": "assistant#550e8400-e29b-41d4-a716-446655440000",
  "userId": "user#john.doe",
  "name": "Updated Assistant Name",
  "description": "Updated description",
  "instruction": "Updated instructions",
  "modelId": "anthropic.claude-3",
  "ragEnabled": true,
  "syncStatus": "QUEUED",
  "syncStatusReason": "",
  "s3Urls": ["s3://my-bucket/docs/new-guide.pdf"],
  "updatedDate": "1698765500000"
}
```

**Example cURL:**

```bash
curl -X PUT "https://api.example.com/assistants/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Assistant",
    "description": "New description"
  }'
```

**Notes:**

- If `s3Urls` is updated and `ragEnabled` is true, documents will be re-indexed
- Old documents are deleted from OpenSearch before new ones are indexed
- The `syncStatus` will be set to "QUEUED" during re-indexing

**Error Responses:**

- `400 Bad Request`: Missing assistantId
- `403 Forbidden`: User does not own this assistant
- `404 Not Found`: Assistant not found
- `500 Internal Server Error`: Server error during update

---

### Delete Assistant

Delete an assistant and all associated data.

**Endpoint:** `DELETE /assistants/{assistantId}`

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| assistantId | string | Yes | The assistant ID (without "assistant#" prefix) |

**Response (204 No Content):**

Empty response body.

**Example cURL:**

```bash
curl -X DELETE "https://api.example.com/assistants/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Notes:**

- Deletes the assistant record from DynamoDB
- Deletes all associated messages
- Deletes all indexed documents from OpenSearch (best effort - failures do not block deletion)

**Error Responses:**

- `400 Bad Request`: Missing assistantId
- `403 Forbidden`: User does not own this assistant
- `404 Not Found`: Assistant not found
- `500 Internal Server Error`: Server error during deletion

---

### Create Message

Send a message to an assistant and receive a response.

**Endpoint:** `POST /assistants/{assistantId}/messages`

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| assistantId | string | Yes | The assistant ID (without "assistant#" prefix) |

**Request Body:**

```json
{
  "content": "What is the installation process?"
}
```

**Request Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| content | string | Yes | The user's message content |

**Response (200 OK):**

```json
{
  "id": "assistant#550e8400-e29b-41d4-a716-446655440000",
  "createdDate": "1698765450000",
  "messageId": "1698765450000#msg-123e4567-e89b-12d3-a456-426614174000",
  "assistantId": "assistant#550e8400-e29b-41d4-a716-446655440000",
  "userId": "john.doe",
  "role": "assistant",
  "content": "The installation process involves three steps...",
  "sources": [
    {
      "content": "Installation instructions from the documentation...",
      "contentType": "application/pdf",
      "excerpt": "Installation instructions from the...",
      "s3Url": "s3://my-bucket/docs/guide.pdf"
    }
  ],
  "metadata": {
    "usage": {
      "inputTokens": 150,
      "outputTokens": 75,
      "totalTokens": 225
    }
  }
}
```

**Example cURL:**

```bash
curl -X POST "https://api.example.com/assistants/550e8400-e29b-41d4-a716-446655440000/messages" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "How do I install the software?"
  }'
```

**Notes:**

- User message is automatically saved before generating response
- If RAG is enabled, relevant context is retrieved from OpenSearch
- Sources are included in the response when RAG is used
- Token usage statistics are included in metadata

**Error Responses:**

- `400 Bad Request`: Missing assistantId or content
- `403 Forbidden`: User does not own this assistant
- `404 Not Found`: Assistant not found
- `500 Internal Server Error`: Server error during message processing

---

### List Messages

Retrieve conversation history for an assistant.

**Endpoint:** `GET /assistants/{assistantId}/messages`

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| assistantId | string | Yes | The assistant ID (without "assistant#" prefix) |

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| exclusiveStartKey | string | No | Pagination token from previous response |
| limit | integer | No | Maximum number of messages to return (default: 100) |

**Response (200 OK):**

```json
{
  "messages": [
    {
      "id": "assistant#550e8400-e29b-41d4-a716-446655440000",
      "createdDate": "1698765450000",
      "messageId": "1698765450000#msg-456",
      "assistantId": "assistant#550e8400-e29b-41d4-a716-446655440000",
      "userId": "john.doe",
      "role": "assistant",
      "content": "The installation process involves three steps...",
      "sources": [...],
      "metadata": {...}
    },
    {
      "id": "assistant#550e8400-e29b-41d4-a716-446655440000",
      "createdDate": "1698765440000",
      "messageId": "1698765440000#msg-123",
      "assistantId": "assistant#550e8400-e29b-41d4-a716-446655440000",
      "userId": "john.doe",
      "role": "user",
      "content": "How do I install the software?"
    }
  ],
  "lastEvaluatedKey": "base64-encoded-key"
}
```

**Example cURL:**

```bash
curl -X GET "https://api.example.com/assistants/550e8400-e29b-41d4-a716-446655440000/messages" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**With pagination and limit:**

```bash
curl -X GET "https://api.example.com/assistants/550e8400-e29b-41d4-a716-446655440000/messages?limit=50&exclusiveStartKey=base64-encoded-key" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Notes:**

- Messages are returned in reverse chronological order (newest first)
- Both user and assistant messages are included
- Use `exclusiveStartKey` for pagination

**Error Responses:**

- `400 Bad Request`: Missing assistantId
- `403 Forbidden`: User does not own this assistant
- `404 Not Found`: Assistant not found
- `500 Internal Server Error`: Server error during retrieval

---

## Data Models

### Assistant

```typescript
interface Assistant {
  id: string;                    // Partition key: "user#{userId}"
  createdDate: string;           // Sort key: Unix timestamp
  assistantId: string;           // Unique identifier: "assistant#{uuid}"
  userId: string;                // Owner: "user#{userId}"
  name: string;                  // Display name
  description: string;           // Description
  instruction: string;           // System prompt
  modelId: string;               // Bedrock model ID
  ragEnabled: boolean;           // RAG feature flag
  syncStatus: 'QUEUED' | 'SYNCING' | 'SUCCEEDED' | 'FAILED';  // Document sync status
  syncStatusReason: string;      // Error details if sync failed
  s3Urls: string[];              // S3 document URLs
  updatedDate: string;           // Unix timestamp
}
```

### AssistantMessage

```typescript
interface AssistantMessage {
  id: string;                    // Partition key: "assistant#{assistantId}"
  createdDate: string;           // Sort key: Unix timestamp
  messageId: string;             // Unique identifier: "{timestamp}#{uuid}"
  assistantId: string;           // "assistant#{assistantId}"
  userId: string;                // Message author
  role: 'user' | 'assistant';    // Message type
  content: string;               // Message text
  sources?: AssistantMessageSource[];  // RAG sources (assistant messages only)
  metadata?: {                   // Additional data
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  };
}
```

### AssistantMessageSource

```typescript
interface AssistantMessageSource {
  content: string;               // Full content from document
  contentType: string;           // MIME type
  excerpt: string;               // Short excerpt (first 200 chars)
  s3Url: string;                 // Source document URL
}
```

## Error Handling

All error responses follow this format:

```json
{
  "message": "Error description"
}
```

### Common HTTP Status Codes

- `200 OK`: Request successful
- `201 Created`: Resource created successfully
- `204 No Content`: Resource deleted successfully
- `400 Bad Request`: Invalid request parameters
- `403 Forbidden`: Access denied (authorization failed)
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

### Best Practices

1. **Always check status codes**: Don't assume success
2. **Handle pagination**: Use `lastEvaluatedKey` for large result sets
3. **Implement retry logic**: For 500 errors with exponential backoff
4. **Validate input**: Client-side validation prevents unnecessary API calls
5. **Monitor token usage**: Track costs via message metadata
6. **Handle RAG failures gracefully**: Document ingestion errors don't fail assistant creation

## Rate Limiting

The API inherits AWS API Gateway and DynamoDB rate limits:

- API Gateway: 10,000 requests per second (burst)
- DynamoDB: Based on provisioned capacity or on-demand scaling

Consider implementing client-side rate limiting and request queuing for high-volume applications.

## Support

For issues or questions:

1. Check error messages and status codes
2. Review CloudWatch logs for detailed error information
3. Consult the migration guide for upgrade assistance
4. File issues in the project repository
