import React, { useState } from 'react';
import { BaseProps } from '../@types/common';
import useBedrockChatApi from '../hooks/useBedrockChatApi';
import Card from '../components/Card';
import Button from '../components/Button';
import { PiCheckCircle, PiWarningCircle, PiX } from 'react-icons/pi';
import { ulid } from 'ulid';

type TestResult = {
  endpoint: string;
  status: 'success' | 'error' | 'pending';
  message: string;
  data?: any;
  error?: any;
};

const BedrockChatTest: React.FC<BaseProps> = () => {
  const bedrockChatApi = useBedrockChatApi();
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [createdConversationId, setCreatedConversationId] = useState<string | null>(null);

  const addResult = (result: TestResult) => {
    setTestResults((prev) => [...prev, result]);
  };

  const clearResults = () => {
    setTestResults([]);
    setCreatedConversationId(null);
  };

  const runTests = async () => {
    setIsRunning(true);
    clearResults();

    // Test 1: Health Check
    try {
      addResult({
        endpoint: '/bedrock-chat/health',
        status: 'pending',
        message: 'Testing health endpoint...',
      });
      const healthData = await bedrockChatApi.testConnection();
      addResult({
        endpoint: '/bedrock-chat/health',
        status: 'success',
        message: 'Health check successful',
        data: healthData,
      });
    } catch (error: any) {
      addResult({
        endpoint: '/bedrock-chat/health',
        status: 'error',
        message: 'Health check failed',
        error: error.response?.data || error.message,
      });
    }

    // Test 2: Get Config
    try {
      addResult({
        endpoint: '/bedrock-chat/config/global',
        status: 'pending',
        message: 'Fetching global configuration...',
      });
      const configData = await bedrockChatApi.getConfig();
      addResult({
        endpoint: '/bedrock-chat/config/global',
        status: 'success',
        message: 'Config fetched successfully',
        data: configData,
      });
    } catch (error: any) {
      addResult({
        endpoint: '/bedrock-chat/config/global',
        status: 'error',
        message: 'Config fetch failed',
        error: error.response?.data || error.message,
      });
    }

    // Test 3: Get Conversations
    try {
      addResult({
        endpoint: '/bedrock-chat/conversations',
        status: 'pending',
        message: 'Fetching conversations...',
      });
      const conversations = await bedrockChatApi.getConversations();
      addResult({
        endpoint: '/bedrock-chat/conversations',
        status: 'success',
        message: `Fetched ${conversations?.length || 0} conversations`,
        data: conversations,
      });
    } catch (error: any) {
      addResult({
        endpoint: '/bedrock-chat/conversations',
        status: 'error',
        message: 'Conversations fetch failed',
        error: error.response?.data || error.message,
      });
    }

    // Test 4: Simulate Conversation Creation (conversation will be created on first message)
    try {
      addResult({
        endpoint: '/bedrock-chat/conversation',
        status: 'pending',
        message: 'Generating conversation ID...',
      });
      const newConversationId = ulid();
      setCreatedConversationId(newConversationId);
      addResult({
        endpoint: '/bedrock-chat/conversation',
        status: 'success',
        message: 'Conversation ID generated (will be created on first message)',
        data: { conversationId: newConversationId },
      });
    } catch (error: any) {
      addResult({
        endpoint: '/bedrock-chat/conversation',
        status: 'error',
        message: 'Failed to generate conversation ID',
        error: error.message,
      });
    }

    // Test 5: Search Store
    try {
      addResult({
        endpoint: '/bedrock-chat/store/search',
        status: 'pending',
        message: 'Searching bot store...',
      });
      const storeResults = await bedrockChatApi.searchStore();
      addResult({
        endpoint: '/bedrock-chat/store/search',
        status: 'success',
        message: `Found ${storeResults?.length || 0} bots in store`,
        data: storeResults,
      });
    } catch (error: any) {
      addResult({
        endpoint: '/bedrock-chat/store/search',
        status: 'error',
        message: 'Store search failed',
        error: error.response?.data || error.message,
      });
    }

    // Test 6: Get Popular Bots
    try {
      addResult({
        endpoint: '/bedrock-chat/store/popular',
        status: 'pending',
        message: 'Fetching popular bots...',
      });
      const popularBots = await bedrockChatApi.getPopularBots();
      addResult({
        endpoint: '/bedrock-chat/store/popular',
        status: 'success',
        message: `Found ${popularBots?.length || 0} popular bots`,
        data: popularBots,
      });
    } catch (error: any) {
      addResult({
        endpoint: '/bedrock-chat/store/popular',
        status: 'error',
        message: 'Popular bots fetch failed',
        error: error.response?.data || error.message,
      });
    }

    // Test 7: Delete Created Conversation (cleanup)
    if (createdConversationId) {
      try {
        addResult({
          endpoint: `/bedrock-chat/conversation/${createdConversationId}`,
          status: 'pending',
          message: 'Deleting test conversation...',
        });
        await bedrockChatApi.deleteConversation(createdConversationId);
        addResult({
          endpoint: `/bedrock-chat/conversation/${createdConversationId}`,
          status: 'success',
          message: 'Test conversation deleted successfully',
        });
        setCreatedConversationId(null);
      } catch (error: any) {
        addResult({
          endpoint: `/bedrock-chat/conversation/${createdConversationId}`,
          status: 'error',
          message: 'Conversation deletion failed',
          error: error.response?.data || error.message,
        });
      }
    }

    setIsRunning(false);
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return <PiCheckCircle className="text-green-600 text-xl" />;
      case 'error':
        return <PiX className="text-red-600 text-xl" />;
      case 'pending':
        return <PiWarningCircle className="text-yellow-600 text-xl animate-pulse" />;
    }
  };

  const getStatusColor = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      case 'pending':
        return 'bg-yellow-50 border-yellow-200';
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <Card>
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Bedrock Chat API Test</h1>
          <p className="text-gray-600">
            This page tests the integration with Bedrock Chat endpoints through the proxy.
          </p>
        </div>

        <div className="mb-6 flex gap-2">
          <Button
            onClick={runTests}
            disabled={isRunning}
            className="bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400"
          >
            {isRunning ? 'Running Tests...' : 'Run All Tests'}
          </Button>
          {testResults.length > 0 && !isRunning && (
            <Button
              onClick={clearResults}
              className="bg-gray-600 text-white hover:bg-gray-700"
            >
              Clear Results
            </Button>
          )}
        </div>

        {testResults.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold mb-3">Test Results:</h2>
            {testResults.map((result, index) => (
              <div
                key={index}
                className={`p-4 border rounded-lg ${getStatusColor(result.status)}`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-1">{getStatusIcon(result.status)}</div>
                  <div className="flex-1">
                    <div className="font-mono text-sm font-semibold text-gray-700 mb-1">
                      {result.endpoint}
                    </div>
                    <div className="text-sm text-gray-600">{result.message}</div>
                    {result.data && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-800">
                          View Response Data
                        </summary>
                        <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto">
                          {JSON.stringify(result.data, null, 2)}
                        </pre>
                      </details>
                    )}
                    {result.error && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm text-red-600 hover:text-red-800">
                          View Error Details
                        </summary>
                        <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto text-red-600">
                          {typeof result.error === 'string' ? result.error : JSON.stringify(result.error, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {testResults.length === 0 && !isRunning && (
          <div className="text-center py-8 text-gray-500">
            Click "Run All Tests" to start testing the Bedrock Chat integration
          </div>
        )}
      </Card>
    </div>
  );
};

export default BedrockChatTest;