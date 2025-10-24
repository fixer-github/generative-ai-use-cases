# Implementation Tasks

## 1. Infrastructure Setup

- [ ] 1.1 Create DynamoDB table schema for assistants
  - Primary key: userId (partition key), createdDate (sort key)
  - GSI for assistantId lookups
  - Attributes: assistantId, name, description, configuration, metadata
  - Enable DynamoDB Streams for OpenSearch sync

- [ ] 1.2 Create DynamoDB table schema for assistant messages
  - Primary key: assistantId (partition key), messageId (sort key)
  - Attributes: userId, role, content, timestamp, metadata, sources
  - Enable point-in-time recovery

- [ ] 1.3 Create CDK construct for Assistant API
  - Location: `packages/cdk/lib/construct/api/assistant.ts`
  - Follow pattern from `chats.ts`
  - Define all Lambda functions
  - Configure API Gateway routes

- [ ] 1.4 Configure OpenSearch access for Lambda functions
  - Reuse existing botstore collection
  - Grant IAM permissions for OpenSearch operations
  - Configure distinct index names (e.g., `assistant-docs`, `assistant-messages`)

- [ ] 1.5 Set up DynamoDB Stream to OpenSearch pipeline
  - Create Lambda function for stream processing
  - Use LangChain to index documents to OpenSearch
  - Implement retry logic and error handling

## 2. Lambda Function Implementation

- [ ] 2.1 Implement createAssistant Lambda
  - Location: `packages/cdk/lambda/assistant/createAssistant.ts`
  - Validate input (name, description, configuration)
  - Generate assistantId (UUID)
  - Write to DynamoDB
  - Return 201 with assistant object

- [ ] 2.2 Implement listAssistants Lambda
  - Location: `packages/cdk/lambda/assistant/listAssistants.ts`
  - Query DynamoDB by userId
  - Support pagination (limit, lastEvaluatedKey)
  - Order by createdDate descending
  - Return 200 with assistant array

- [ ] 2.3 Implement getAssistant Lambda
  - Location: `packages/cdk/lambda/assistant/getAssistant.ts`
  - Query DynamoDB by assistantId
  - Verify user ownership
  - Return 200 with assistant details or 404/403

- [ ] 2.4 Implement updateAssistant Lambda
  - Location: `packages/cdk/lambda/assistant/updateAssistant.ts`
  - Validate input
  - Verify user ownership
  - Update DynamoDB with partial update
  - Return 200 with updated assistant

- [ ] 2.5 Implement deleteAssistant Lambda
  - Location: `packages/cdk/lambda/assistant/deleteAssistant.ts`
  - Verify user ownership
  - Delete assistant from DynamoDB
  - Delete associated messages
  - Trigger OpenSearch cleanup
  - Return 204 No Content

- [ ] 2.6 Implement createMessage Lambda (RAG)
  - Location: `packages/cdk/lambda/assistant/createMessage.ts`
  - Retrieve assistant configuration
  - Use LangChain to query OpenSearch vector store
  - Generate LLM response with RAG context
  - Store user message and assistant response
  - Return 200 with response and sources

- [ ] 2.7 Implement listMessages Lambda
  - Location: `packages/cdk/lambda/assistant/listMessages.ts`
  - Query messages by assistantId
  - Support pagination
  - Return 200 with message history

## 3. Repository Layer

- [ ] 3.1 Create assistant repository
  - Location: `packages/cdk/lambda/repository/assistant.ts`
  - Follow pattern from `chat.ts`
  - Implement CRUD operations
  - Abstract DynamoDB operations

- [ ] 3.2 Create message repository
  - Location: `packages/cdk/lambda/repository/assistantMessage.ts`
  - Implement message CRUD operations
  - Support conversation threading

- [ ] 3.3 Create OpenSearch repository
  - Location: `packages/cdk/lambda/repository/assistantSearch.ts`
  - Use LangChain OpenSearch integration
  - Implement vector store operations
  - Implement document indexing
  - Implement similarity search

## 4. Shared Utilities

- [ ] 4.1 Create TypeScript types
  - Location: `packages/types/src/assistant.ts`
  - Define Assistant interface
  - Define AssistantMessage interface
  - Define configuration schemas
  - Export for use across packages

- [ ] 4.2 Create validation utilities
  - Input validation helpers
  - Schema validation with Zod
  - Error formatting utilities

- [ ] 4.3 Create LangChain utilities
  - OpenSearch vector store factory
  - Document loader utilities
  - RAG chain configuration
  - Prompt templates

## 5. Integration

- [ ] 5.1 Wire up API Gateway routes
  - POST /api/assistant → createAssistant
  - GET /api/assistant → listAssistants
  - GET /api/assistant/{assistantId} → getAssistant
  - PUT /api/assistant/{assistantId} → updateAssistant
  - DELETE /api/assistant/{assistantId} → deleteAssistant
  - POST /api/assistant/{assistantId}/messages → createMessage
  - GET /api/assistant/{assistantId}/messages → listMessages

- [ ] 5.2 Configure Cognito authentication
  - Reuse existing Cognito user pool
  - Add authorizer to all endpoints
  - Extract userId from token

- [ ] 5.3 Update CDK stack to include Assistant API
  - Modify `packages/cdk/lib/stacks/` as needed
  - Add AssistantApi construct to stack
  - Configure environment variables
  - Set up IAM roles and policies

## 6. Testing

- [ ] 6.1 Write unit tests for repository layer
  - Mock DynamoDB client
  - Test CRUD operations
  - Test error cases

- [ ] 6.2 Write unit tests for Lambda functions
  - Mock repository layer
  - Test business logic
  - Test validation

- [ ] 6.3 Write integration tests
  - Test end-to-end API flows
  - Test DynamoDB operations
  - Test OpenSearch integration

- [ ] 6.4 Manual testing
  - Deploy to dev environment
  - Test all endpoints with Postman/curl
  - Verify list updates are immediate
  - Verify RAG responses are accurate

## 7. Documentation

- [ ] 7.1 Update API documentation
  - Document all endpoints
  - Include request/response examples
  - Document error codes

- [ ] 7.2 Write migration guide
  - Document differences from bedrock-chat
  - Provide migration steps for users
  - Include data migration script (if needed)

- [ ] 7.3 Update README
  - Add Assistant API to feature list
  - Update deployment instructions

## 8. Migration and Cleanup

- [ ] 8.1 Deploy Assistant API to production
  - Run deployment script
  - Verify all endpoints work
  - Monitor CloudWatch logs

- [ ] 8.2 Update frontend to use new endpoints
  - Replace bedrock-chat API calls
  - Test UI functionality
  - Deploy frontend changes

- [ ] 8.3 Deprecate old bedrock-chat endpoints
  - Add deprecation warnings
  - Set sunset date
  - Communicate to users

- [ ] 8.4 Remove old infrastructure
  - Delete temp-bedrock-chat constructs
  - Remove Python backend code
  - Clean up unused resources
  - Update CDK stack

## 9. Validation

- [ ] 9.1 Verify all requirements are met
  - Check against spec.md scenarios
  - Ensure all acceptance criteria pass
  - Document any deviations

- [ ] 9.2 Performance testing
  - Test response times
  - Test concurrent requests
  - Verify list operations < 100ms

- [ ] 9.3 Security review
  - Verify authentication/authorization
  - Check IAM policies follow least privilege
  - Test for common vulnerabilities

## Dependencies

- Task 2.x depends on 1.x (infrastructure must exist)
- Task 3.x can run parallel with 2.x
- Task 4.x can run parallel with other tasks
- Task 5.x depends on 1.x, 2.x, 3.x
- Task 6.x depends on 2.x, 3.x being complete
- Task 7.x can start after 2.x
- Task 8.x depends on 6.x passing
- Task 9.x depends on 8.x being complete

## Parallelizable Work

- Infrastructure (1.x) and Types (4.1) can start immediately
- Once infrastructure is deployed:
  - Lambda implementation (2.x)
  - Repository layer (3.x)
  - Utilities (4.2, 4.3)
  - Can all proceed in parallel
