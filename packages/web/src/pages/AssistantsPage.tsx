import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PiMagnifyingGlass, PiPlus, PiRobot } from 'react-icons/pi';
import { useTranslation } from 'react-i18next';

interface Assistant {
  id: string;
  name: string;
  description: string;
  icon?: string;
  isFeatured?: boolean;
}

// TODO: Replace with actual API call to fetch assistants
const MOCK_ASSISTANTS: Assistant[] = [
  {
    id: '1',
    name: '社内規則QA',
    description: '社内規則に関するさまざまな疑問にお答えします',
    isFeatured: true,
  },
  {
    id: '2',
    name: '現代文翻訳サポート',
    description: '現代文翻訳サポート',
    isFeatured: true,
  },
  {
    id: '3',
    name: '記述・作文添削',
    description: '記述・作文添削',
    isFeatured: true,
  },
];

const AssistantsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  // Filter assistants based on search query
  const filteredAssistants = MOCK_ASSISTANTS.filter((assistant) =>
    assistant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    assistant.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const featuredAssistants = filteredAssistants.filter((a) => a.isFeatured);
  const allAssistants = filteredAssistants;

  const handleStartChat = (assistantId: string) => {
    // TODO: Implement navigation to chat with specific assistant
    navigate(`/chat?assistant=${assistantId}`);
  };

  const handleCreateAssistant = () => {
    // TODO: Implement assistant creation flow
    console.log('Create new assistant');
  };

  return (
    <div className="min-h-screen bg-white p-8">
      {/* Header */}
      <div className="mx-auto max-w-7xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">
          アシスタントを探す
        </h1>

        {/* Search Bar and Create Button */}
        <div className="flex gap-4 mb-8">
          <div className="relative flex-1">
            <PiMagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400" />
            <input
              type="text"
              placeholder="アシスタントを検索"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-300 py-3 pl-12 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={handleCreateAssistant}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700">
            <PiPlus className="text-lg" />
            アシスタントを作成
          </button>
        </div>

        {/* Featured Assistants Section */}
        {featuredAssistants.length > 0 && (
          <section className="mb-12">
            <h2 className="mb-4 text-sm font-semibold text-gray-600">
              おすすめのアシスタント
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {featuredAssistants.map((assistant) => (
                <AssistantCard
                  key={assistant.id}
                  assistant={assistant}
                  onStartChat={handleStartChat}
                />
              ))}
            </div>
          </section>
        )}

        {/* All Assistants Section */}
        <section>
          <h2 className="mb-4 text-sm font-semibold text-gray-600">
            全てのアシスタント
          </h2>
          {allAssistants.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {allAssistants.map((assistant) => (
                <AssistantCard
                  key={assistant.id}
                  assistant={assistant}
                  onStartChat={handleStartChat}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <PiMagnifyingGlass className="mb-4 text-6xl" />
              <p>検索条件に一致するアシスタントが見つかりませんでした</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

// Assistant Card Component
interface AssistantCardProps {
  assistant: Assistant;
  onStartChat: (assistantId: string) => void;
}

const AssistantCard: React.FC<AssistantCardProps> = ({
  assistant,
  onStartChat,
}) => {
  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      {/* Icon */}
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
        <PiRobot className="text-2xl text-blue-600" />
      </div>

      {/* Name */}
      <h3 className="mb-2 text-lg font-semibold text-gray-900">
        {assistant.name}
      </h3>

      {/* Description */}
      <p className="mb-4 flex-1 text-sm text-gray-600 line-clamp-2">
        {assistant.description}
      </p>

      {/* Start Chat Button */}
      <button
        onClick={() => onStartChat(assistant.id)}
        className="w-full rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
        チャットを始める
      </button>
    </div>
  );
};

export default AssistantsPage;
