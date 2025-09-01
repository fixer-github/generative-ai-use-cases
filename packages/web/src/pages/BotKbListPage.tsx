import React from 'react';
import { PiStarFill, PiStarBold } from 'react-icons/pi';
import { Card, Grid, Heading, Link } from '@aws-amplify/ui-react';

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

type RatingProps = {
  rating: number;
};

const Rating: React.FC<RatingProps> = ({ rating }) => {
  const starCount = Math.floor(rating);

  const fillStars = [];

  for (let i = 0; i < starCount; i++) {
    fillStars.push(<PiStarFill />);
  }
  for (let i = starCount; i < 5; i++) {
    fillStars.push(<PiStarBold />);
  }

  return <div className="flex flex-row">{fillStars.map((star) => star)}</div>;
};

type TagProps = {
  tag: string;
};

const Tag: React.FC<TagProps> = ({ tag }) => {
  return (
    <a
      className="rounded-full border-2 border-slate-200 px-3 text-sm font-bold hover:bg-slate-200"
      href={`/bot/tags/${tag}`}>
      #{tag}
    </a>
  );
};

type TagsProps = {
  tags: string[];
};

const Tags: React.FC<TagsProps> = ({ tags }) => {
  return (
    <div className="flex flex-row gap-1">
      {tags.map((tag) => (
        <Tag tag={tag} />
      ))}
    </div>
  );
};

type RagBotCardProps = {
  bot: RagBot;
};

const RagBotCard: React.FC<RagBotCardProps> = ({ bot }) => {
  return (
    <Card variation="elevated">
      <Link className="underline-offset-2 hover:underline">
        <Heading level={6}>{bot.name}</Heading>
      </Link>
      <div>{bot.description}</div>
      <Rating rating={bot.rating} />
      <Tags tags={bot.tags} />
    </Card>
  );
};

const BotKbListPage: React.FC = () => {
  const bots = DUMMY_BOTS;

  return (
    <div className="p-4">
      <Heading level={2}>RAGチャットボット</Heading>

      <Grid gap="1rem" autoColumns={'auto'}>
        {bots.map((bot) => (
          <RagBotCard bot={bot} />
        ))}
      </Grid>
    </div>
  );
};

export default BotKbListPage;
