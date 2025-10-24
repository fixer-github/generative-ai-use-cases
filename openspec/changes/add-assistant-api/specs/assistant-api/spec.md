# Assistant API Specification

## ADDED Requirements

### Requirement: Assistant Creation
The system SHALL allow users to create assistants through a RESTful API endpoint.

#### Scenario: Create assistant with valid data
- **WHEN** a user sends a POST request to `/api/assistant` with valid assistant data (name, description, configuration)
- **THEN** the system creates a new assistant in DynamoDB
- **AND** returns HTTP 201 with the assistant ID and full assistant object
- **AND** the assistant appears in list operations within 100ms

#### Scenario: Create assistant with invalid data
- **WHEN** a user sends a POST request to `/api/assistant` with missing required fields
- **THEN** the system returns HTTP 400 with validation error details
- **AND** no assistant is created

#### Scenario: Create assistant with authentication
- **WHEN** an unauthenticated user attempts to create an assistant
- **THEN** the system returns HTTP 401 Unauthorized
- **AND** no assistant is created

### Requirement: Assistant Listing from DynamoDB
The system SHALL provide paginated listing of assistants for authenticated users using DynamoDB queries for immediate consistency and cost efficiency.

#### Scenario: List user's assistants from DynamoDB
- **WHEN** a user sends a GET request to `/api/assistant`
- **THEN** the system queries DynamoDB (NOT OpenSearch) for assistants owned by the user
- **AND** returns HTTP 200 with an array of assistants
- **AND** results are ordered by creation date descending
- **AND** includes pagination metadata (lastEvaluatedKey if more results exist)
- **AND** response time is under 100ms

#### Scenario: List with pagination
- **WHEN** a user sends a GET request to `/api/assistant?limit=10&lastEvaluatedKey=xyz`
- **THEN** the system uses DynamoDB Query with ExclusiveStartKey
- **AND** returns up to 10 assistants
- **AND** includes next pagination token if more results exist

#### Scenario: Empty list
- **WHEN** a user with no assistants requests the list
- **THEN** the system queries DynamoDB and returns HTTP 200 with an empty array

#### Scenario: Immediate reflection after creation
- **WHEN** a user creates a new assistant
- **AND** immediately requests the list
- **THEN** the newly created assistant appears in the list within 100ms
- **AND** no waiting for OpenSearch indexing is required

### Requirement: Assistant Retrieval
The system SHALL allow users to retrieve specific assistant details by ID.

#### Scenario: Get existing assistant
- **WHEN** a user sends a GET request to `/api/assistant/{assistantId}` for their own assistant
- **THEN** the system returns HTTP 200 with full assistant details
- **AND** includes all configuration and metadata

#### Scenario: Get non-existent assistant
- **WHEN** a user requests an assistant ID that doesn't exist
- **THEN** the system returns HTTP 404 Not Found

#### Scenario: Get another user's assistant
- **WHEN** a user requests an assistant they don't own
- **THEN** the system returns HTTP 403 Forbidden

### Requirement: Assistant Update
The system SHALL allow users to update their assistant configurations.

#### Scenario: Update assistant name and description
- **WHEN** a user sends a PUT request to `/api/assistant/{assistantId}` with updated fields
- **THEN** the system updates the assistant in DynamoDB
- **AND** returns HTTP 200 with the updated assistant object
- **AND** preserves fields not included in the update request

#### Scenario: Update non-existent assistant
- **WHEN** a user attempts to update an assistant that doesn't exist
- **THEN** the system returns HTTP 404 Not Found

#### Scenario: Update with invalid data
- **WHEN** a user sends invalid data in the update request
- **THEN** the system returns HTTP 400 with validation errors
- **AND** no changes are applied

### Requirement: Assistant Deletion
The system SHALL allow users to delete their assistants and associated data.

#### Scenario: Delete assistant
- **WHEN** a user sends a DELETE request to `/api/assistant/{assistantId}`
- **THEN** the system deletes the assistant from DynamoDB
- **AND** deletes all associated messages and conversation history
- **AND** removes entries from OpenSearch index
- **AND** returns HTTP 204 No Content

#### Scenario: Delete non-existent assistant
- **WHEN** a user attempts to delete an assistant that doesn't exist
- **THEN** the system returns HTTP 404 Not Found

#### Scenario: Delete another user's assistant
- **WHEN** a user attempts to delete an assistant they don't own
- **THEN** the system returns HTTP 403 Forbidden

### Requirement: Message Creation (RAG Chat)
The system SHALL support RAG-based chat interactions with assistants.

#### Scenario: Send message to assistant
- **WHEN** a user sends a POST request to `/api/assistant/{assistantId}/messages` with message content
- **THEN** the system retrieves relevant context from OpenSearch vector store
- **AND** generates a response using the configured LLM with RAG context
- **AND** stores both user message and assistant response in DynamoDB
- **AND** returns HTTP 200 with the assistant's response
- **AND** includes sources/references used in the response

#### Scenario: Send message to non-existent assistant
- **WHEN** a user sends a message to an assistant ID that doesn't exist
- **THEN** the system returns HTTP 404 Not Found

#### Scenario: Send message with empty content
- **WHEN** a user sends a message with empty or whitespace-only content
- **THEN** the system returns HTTP 400 Bad Request

### Requirement: Message Listing
The system SHALL provide conversation history for assistants.

#### Scenario: List conversation messages
- **WHEN** a user sends a GET request to `/api/assistant/{assistantId}/messages`
- **THEN** the system returns HTTP 200 with paginated message history
- **AND** messages are ordered chronologically
- **AND** includes both user and assistant messages
- **AND** supports pagination with limit and offset parameters

#### Scenario: List messages for non-existent assistant
- **WHEN** a user requests messages for an assistant that doesn't exist
- **THEN** the system returns HTTP 404 Not Found

### Requirement: Data Isolation
The system SHALL ensure users can only access their own assistants and conversations.

#### Scenario: User isolation
- **WHEN** any API request includes authentication credentials
- **THEN** the system verifies the user identity via Cognito
- **AND** filters all queries to only return data owned by that user
- **AND** rejects any attempts to access other users' data with HTTP 403

### Requirement: OpenSearch Integration for Vector Search Only
The system SHALL use OpenSearch Serverless EXCLUSIVELY for vector search and RAG operations, NOT for listing or CRUD operations.

#### Scenario: OpenSearch used only for vector search
- **WHEN** any CRUD or list operation is performed (create, read, update, delete, list)
- **THEN** the system uses DynamoDB exclusively
- **AND** does NOT query OpenSearch for these operations
- **AND** avoids unnecessary OpenSearch costs

#### Scenario: Asynchronous document indexing
- **WHEN** an assistant is created or updated with RAG documents
- **THEN** the system asynchronously indexes document content to OpenSearch
- **AND** uses DynamoDB Streams to trigger indexing
- **AND** handles indexing failures with retry logic
- **AND** indexing does not block the API response

#### Scenario: Vector search for RAG only
- **WHEN** a user sends a message to an assistant requesting RAG-based response
- **THEN** the system performs vector similarity search in OpenSearch
- **AND** retrieves top K relevant documents for context
- **AND** uses LangChain's OpenSearch vector store integration
- **AND** falls back to direct LLM if search fails
- **AND** this is the ONLY use case for OpenSearch queries

### Requirement: TypeScript Implementation
The system SHALL implement all Lambda functions in TypeScript.

#### Scenario: Consistent codebase
- **WHEN** developing or maintaining the Assistant API
- **THEN** all Lambda function code is written in TypeScript
- **AND** follows existing patterns from `/api/chat` implementation
- **AND** uses Node.js runtime compatible with other API endpoints
- **AND** shares common utilities and types with other APIs

### Requirement: Infrastructure as Code
The system SHALL define all infrastructure using AWS CDK with TypeScript.

#### Scenario: Single stack deployment
- **WHEN** deploying the Assistant API infrastructure
- **THEN** all assistants share a single CloudFormation stack
- **AND** DynamoDB tables are created once in the stack
- **AND** Lambda functions are defined as CDK constructs
- **AND** API Gateway routes are configured in the stack
- **AND** no per-assistant stacks are created

#### Scenario: Botstore reuse
- **WHEN** deploying OpenSearch integration
- **THEN** the system reuses existing botstore (OpenSearch Serverless collection)
- **AND** uses distinct index names to avoid conflicts
- **AND** grants appropriate IAM permissions to Lambda functions

### Requirement: Error Handling
The system SHALL provide consistent error responses across all endpoints.

#### Scenario: Validation errors
- **WHEN** a request fails validation
- **THEN** the system returns HTTP 400
- **AND** includes structured error details with field-level messages

#### Scenario: Authentication errors
- **WHEN** authentication fails or is missing
- **THEN** the system returns HTTP 401 Unauthorized
- **AND** includes WWW-Authenticate header

#### Scenario: Authorization errors
- **WHEN** a user attempts to access resources they don't own
- **THEN** the system returns HTTP 403 Forbidden

#### Scenario: Resource not found
- **WHEN** a requested resource doesn't exist
- **THEN** the system returns HTTP 404 Not Found

#### Scenario: Internal errors
- **WHEN** an unexpected error occurs
- **THEN** the system returns HTTP 500 Internal Server Error
- **AND** logs detailed error information for debugging
- **AND** does not expose internal implementation details to clients

### Requirement: Backward Compatibility
The system SHALL replace existing `/api/bedrock-chat` endpoints while maintaining functionality.

#### Scenario: Endpoint replacement
- **WHEN** the new Assistant API is deployed
- **THEN** `/api/bedrock-chat/*` endpoints are deprecated
- **AND** new `/api/assistant/*` endpoints provide equivalent functionality
- **AND** frontend is updated to use new endpoints
- **AND** old endpoints remain active during migration period

#### Scenario: Feature parity
- **WHEN** comparing old and new implementations
- **THEN** all RAG chat functionality is preserved
- **AND** user experience is equivalent or improved
- **AND** response quality and performance are comparable

### Requirement: Idempotent OpenSearch Indexing
The system SHALL ensure idempotent processing of DynamoDB Stream records to prevent duplicate OpenSearch operations.

#### Scenario: Duplicate stream record handling
- **WHEN** a DynamoDB Stream record is processed multiple times due to Lambda retries
- **THEN** the system detects the duplicate via sequence number or document version tracking
- **AND** skips redundant OpenSearch indexing operations
- **AND** logs the duplicate event for monitoring
- **AND** returns success without error

#### Scenario: OpenSearch index consistency
- **WHEN** processing a batch of DynamoDB Stream records
- **THEN** each record is indexed to OpenSearch exactly once
- **AND** failed records are retried with exponential backoff
- **AND** permanently failed records are sent to a dead letter queue

### Requirement: Secure OpenSearch Authentication
The system SHALL authenticate to OpenSearch Serverless using AWS Signature Version 4 for secure access.

#### Scenario: Lambda OpenSearch connection
- **WHEN** a Lambda function connects to OpenSearch Serverless
- **THEN** the system uses AWS IAM credentials from the Lambda execution role
- **AND** signs all requests with AWS Signature Version 4
- **AND** uses the "aoss" service identifier for OpenSearch Serverless
- **AND** connection succeeds with proper authorization

#### Scenario: Authentication failure handling
- **WHEN** OpenSearch authentication fails
- **THEN** the system logs the authentication error
- **AND** retries with exponential backoff for transient failures
- **AND** returns HTTP 500 to the client if authentication permanently fails

### Requirement: OpenSearch Refresh Delay Awareness
The system SHALL document and handle the 60-second refresh interval of OpenSearch Serverless indexes.

#### Scenario: Search after document creation
- **WHEN** a user creates an assistant and immediately searches
- **THEN** the system uses DynamoDB for list operations (immediate consistency)
- **AND** vector search results may be delayed up to 60 seconds
- **AND** API documentation clearly states the refresh delay
- **AND** clients are informed to use list operations for immediate results

### Requirement: Cost-Optimized Storage Strategy
The system SHALL optimize infrastructure costs by using DynamoDB for all operations except vector search.

#### Scenario: Cost comparison with current implementation
- **WHEN** comparing costs between current and new implementation
- **THEN** list operations cost $0.25 per million requests (DynamoDB) instead of continuous OCU charges
- **AND** create operations cost $1.25 per million writes instead of OpenSearch indexing costs
- **AND** OpenSearch is only used for actual RAG queries (usage-based)
- **AND** overall cost for listing operations is 10-100x cheaper

#### Scenario: No idle OpenSearch costs for listing
- **WHEN** no users are sending RAG messages
- **THEN** OpenSearch incurs minimal or zero query costs
- **AND** DynamoDB only charges for actual read/write operations
- **AND** no continuous charges for idle infrastructure
