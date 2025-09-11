import React from 'react';
import {
  Button,
  Card,
  Collection,
  Flex,
  Heading,
  SearchField,
  SelectField,
  Text,
  View,
} from '@aws-amplify/ui-react';
import { PiPlusBold, PiUpload } from 'react-icons/pi';
import { useNavigate } from 'react-router-dom';
import useBot from '../hooks/useBotApi';
import { BotListResponseItem } from 'generative-ai-use-cases';

type BotCardProps = {
  bot: BotListResponseItem;
};

const BotCard: React.FC<BotCardProps> = ({ bot, ...props }) => {
  const navigate = useNavigate();

  return (
    <Card variation="elevated" width="400px" {...props}>
      <Flex direction="column">
        <Heading level={5}>{bot.title}</Heading>
        <Text variation="secondary" grow={1}>
          {bot.description}
        </Text>
        <Button
          variation="primary"
          alignSelf="flex-end"
          onClick={() => navigate(`/bot/chat/${bot.id}`)}>
          開く
        </Button>
      </Flex>
    </Card>
  );
};

const BotKbListPage: React.FC = () => {
  const navigate = useNavigate();

  const { listBots } = useBot();

  const { data: bots, isLoading } = listBots();

  // TODO: これハードコーディングでいいんかな
  const status = ['All', 'Ready', 'Draft', 'Indexing', 'Error'];
  const visibility = ['All', 'Private', 'Tenant', 'Public'];

  return (
    <View>
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
        <Button variation="primary" onClick={() => navigate('/bot/new')}>
          <PiPlusBold className="mr-4" />
          新規ボット作成
        </Button>
      </Flex>

      <Flex direction="row" margin="medium">
        <SearchField
          label="Search"
          placeholder="検索: 名前・説明・タグ"
          hasSearchButton={false}
          hasSearchIcon
          grow={1}
        />
        <SelectField label="Status" labelHidden>
          {status.map((value, index) => (
            <option key={index} value={value}>
              {value}
            </option>
          ))}
        </SelectField>
        <SelectField label="Visibility" labelHidden>
          {visibility.map((value, index) => (
            <option key={index} value={value}>
              {value}
            </option>
          ))}
        </SelectField>
        <SelectField label="Sort" labelHidden>
          <option value="newer">更新が新しい順</option>
          <option value="older">更新が古い順</option>
        </SelectField>
      </Flex>

      {isLoading ? (
        <div>Loading</div>
      ) : (
        <Collection
          direction="row"
          gap="small"
          wrap="wrap"
          items={bots?.items ?? []}
          type="list"
          margin="small">
          {(bot) => <BotCard key={bot.id} bot={bot} />}
        </Collection>
      )}
    </View>
  );
};

export default BotKbListPage;
