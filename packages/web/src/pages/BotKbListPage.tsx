import React from 'react';
import {
  Badge,
  Button,
  Card,
  Collection,
  Flex,
  Heading,
  Loader,
  Menu,
  MenuButton,
  MenuItem,
  Rating,
  SearchField,
  SelectField,
  Text,
  View,
} from '@aws-amplify/ui-react';
import {
  PiDotsThreeOutlineFill,
  PiPlusBold,
  PiShare,
  PiSparkleBold,
  PiTrash,
  PiUpload,
} from 'react-icons/pi';

// -------------------------
// ダミーデータ
// -------------------------
type BotStatus =
  | { status: 'Ready' | 'Draft' }
  | { status: 'Indexing'; progress: number }
  | { status: 'Error'; message: string };

type Visibility = 'Private' | 'Tenant' | 'Public';

type RagBot = {
  id: string;
  name: string;
  description: string;
  owners: { name: string }[];
  status: BotStatus;
  visibility: Visibility;
  kbCount: number; // ナレッジベース数
  fileCount: number; // 紐づくファイル数
  lastUpdated: string; // ISO
  usage7d: number; // 直近7日の利用回数
  rating: number; // 1-5
  tags: string[];
  model: string;
  progress?: number; // Indexing進捗
};

const DUMMY_BOTS: RagBot[] = [
  {
    id: 'bot-001',
    name: '社内規程アシスタント',
    description: '就業規則や稟議フローに関する質問に回答します。',
    owners: [{ name: 'Sato' }, { name: 'Kato' }],
    status: {
      status: 'Ready',
    },
    visibility: 'Tenant',
    kbCount: 3,
    fileCount: 142,
    lastUpdated: '2025-08-25T10:00:00Z',
    usage7d: 523,
    rating: 4.6,
    tags: ['人事', '総務'],
    model: 'GPT-4o-mini',
  },
  {
    id: 'bot-002',
    name: '導入手順サポート',
    description: '製品導入〜設定手順のナレッジを横断検索して回答。',
    owners: [{ name: 'Aoki' }],
    status: {
      status: 'Indexing',
      progress: 62,
    },
    visibility: 'Private',
    kbCount: 5,
    fileCount: 319,
    lastUpdated: '2025-08-28T02:00:00Z',
    usage7d: 87,
    rating: 4.2,
    tags: ['セットアップ', '運用'],
    model: 'GPT-4.1',
    progress: 62,
  },
  {
    id: 'bot-003',
    name: 'カスタマーFAQ',
    description: '公開FAQ・マニュアルを根拠とした回答を返します。',
    owners: [{ name: 'Nakamura' }],
    status: {
      status: 'Ready',
    },
    visibility: 'Public',
    kbCount: 2,
    fileCount: 88,
    lastUpdated: '2025-08-26T15:00:00Z',
    usage7d: 1321,
    rating: 4.8,
    tags: ['サポート', '外部公開'],
    model: 'GPT-4o',
  },
  {
    id: 'bot-004',
    name: 'セキュリティガイド',
    description: '社内セキュリティ標準・ISMS文書のRAG回答。',
    owners: [{ name: 'Yamada' }, { name: 'Suzuki' }],
    status: {
      status: 'Draft',
    },
    visibility: 'Private',
    kbCount: 1,
    fileCount: 14,
    lastUpdated: '2025-08-20T08:00:00Z',
    usage7d: 9,
    rating: 3.9,
    tags: ['ISMS', 'ポリシー'],
    model: 'GPT-4o-mini',
  },
  {
    id: 'bot-005',
    name: '契約書レビュー補助',
    description: '社内雛形/過去レビュー履歴を根拠に条項案を提示。',
    owners: [{ name: 'Ito' }],
    status: {
      status: 'Error',
      message: '最終ジョブでエラー',
    },
    visibility: 'Tenant',
    kbCount: 4,
    fileCount: 57,
    lastUpdated: '2025-08-27T12:30:00Z',
    usage7d: 0,
    rating: 0,
    tags: ['法務'],
    model: 'GPT-4.1',
  },
];

type InformationProgressProps = {
  progress: number;
};

const InformationProgress: React.FC<InformationProgressProps> = ({
  progress,
}) => {
  return (
    <>
      <Flex direction="row" justifyContent="space-between">
        <Text fontSize="0.8em" variation="tertiary">
          インデックス作成中
        </Text>
        <Text fontSize="0.8em" variation="tertiary">
          {progress}%
        </Text>
      </Flex>
      <Loader
        size="large"
        variation="linear"
        isDeterminate
        isPercentageTextHidden
        percentage={progress}
      />
    </>
  );
};

type TagsProps = {
  tags: string[];
};

const Tags: React.FC<TagsProps> = ({ tags }) => {
  return (
    <Flex direction="row" gap="xxs">
      {tags.map((tag) => (
        <Text variation="primary" as="p">
          #{tag}
        </Text>
      ))}
    </Flex>
  );
};

type RagBotCardProps = {
  bot: RagBot;
};

const RagBotCard: React.FC<RagBotCardProps> = ({ bot }) => {
  const convertStatus = () => {
    switch (bot.status.status) {
      case 'Ready':
        return 'success';
      case 'Indexing':
        return 'warning';
      case 'Error':
        return 'error';
    }
  };

  const convertVisibility = () => {
    switch (bot.visibility) {
      case 'Tenant':
        return 'success';
      case 'Public':
        return 'info';
    }
  };

  const status = convertStatus();
  const visibility = convertVisibility();

  return (
    <Card variation="elevated" width="400px">
      <Flex direction="column" gap="xs">
        <Flex
          direction="row"
          justifyContent="space-between"
          alignItems="center">
          <Heading level={6}>{bot.name}</Heading>
          <Menu
            size="small"
            trigger={
              <MenuButton size="small" padding="xxs" variation="link">
                <PiDotsThreeOutlineFill />
              </MenuButton>
            }>
            <MenuItem variation="warning">
              <PiTrash className="mr-4" />
              削除
            </MenuItem>
          </Menu>
        </Flex>
        <Flex direction="row" gap="xxxs">
          <Badge variation={status}>{bot.status.status}</Badge>
          <Badge variation={visibility}>{bot.visibility}</Badge>
          <Badge>KB {bot.kbCount}</Badge>
          <Badge>Files {bot.fileCount}</Badge>
        </Flex>
        <Text isTruncated fontSize="0.8rem">
          {bot.description}
        </Text>
        {bot.status.status === 'Indexing' && (
          <InformationProgress progress={bot.status.progress} />
        )}
        {bot.status.status === 'Error' && (
          <Badge variation="error" alignSelf="flex-start">
            {bot.status.message}
          </Badge>
        )}
        <Flex
          direction="row"
          justifyContent="space-between"
          alignItems="center">
          <Rating gap="xxxs" maxValue={5} value={bot.rating} />
          <Text fontSize="0.8em">
            更新: {new Date(bot.lastUpdated).toLocaleString('ja-JP')}
          </Text>
        </Flex>
        <Tags tags={bot.tags} />
        <Flex direction="row" alignItems="center">
          <Text fontSize="0.8rem" grow={1}>
            7日間の利用: {bot.usage7d}
          </Text>
          <Button size="small">
            <PiSparkleBold className="mr-4" />
            開く
          </Button>
          <Button variation="primary" size="small">
            <PiShare className="mr-4" />
            共有
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
};

const TopSection: React.FC = () => {
  return (
    <Flex direction="row" alignItems="center" margin="medium">
      <Flex direction="column" grow={1}>
        <Heading level={2}>RAGチャットボット</Heading>
        <Text variation="secondary" fontSize="1.2em">
          テナント内で作成・共有されたRAGエージェントの一覧
        </Text>
      </Flex>
      <Button>
        <PiUpload className="mr-4" />
        ファイルをアップロード
      </Button>
      <Button variation="primary">
        <PiPlusBold className="mr-4" />
        新規ボット作成
      </Button>
    </Flex>
  );
};

const SearchSection: React.FC = () => {
  // TODO: これハードコーディングでいいんかな
  const status = ['All', 'Ready', 'Draft', 'Indexing', 'Error'];
  const visibility = ['All', 'Private', 'Tenant', 'Public'];

  return (
    <Flex direction="row" margin="medium">
      <SearchField
        label="Search"
        placeholder="検索: 名前・説明・タグ"
        hasSearchButton={false}
        hasSearchIcon
        grow={1}
      />
      <SelectField label="Status" labelHidden>
        {status.map((value) => (
          <option value={value}>{value}</option>
        ))}
      </SelectField>
      <SelectField label="Visibility" labelHidden>
        {visibility.map((value) => (
          <option value={value}>{value}</option>
        ))}
      </SelectField>
      <SelectField label="Sort" labelHidden>
        <option value="newer">更新が新しい順</option>
        <option value="older">更新が古い順</option>
      </SelectField>
    </Flex>
  );
};

/*
 * TODO:
 * - Gridをいい感じにする
 */

const BotKbListPage: React.FC = () => {
  const bots = DUMMY_BOTS;

  return (
    <View>
      <TopSection />
      <SearchSection />

      <Collection
        direction="row"
        gap="small"
        wrap="wrap"
        items={bots}
        type="list"
        margin="small">
        {(bot) => <RagBotCard bot={bot} />}
      </Collection>
    </View>
  );
};

export default BotKbListPage;
