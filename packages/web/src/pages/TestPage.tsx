import { useEffect, useState } from 'react';
import useHttp from '../hooks/useHttp';
import { ModelData } from 'generative-ai-use-cases/src/model';

type GetModelResponse = {
  models: ModelData[];
};

const TestPage: React.FC = () => {
  const http = useHttp();

  const [data, setData] = useState<GetModelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        const response = await http.api.get<GetModelResponse>('models');

        console.log(response.status);

        const json = response.data!;

        setData(json);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []); // 空の依存配列 = コンポーネントマウント時のみ実行

  const modelParam = (flag?: boolean) => {
    if (flag === true) return '○';
    else if (flag === false) return '✗';
    else return '‐';
  };

  if (loading) return <div>読み込み中...</div>;
  if (error) return <div>エラー: {error}</div>;

  return (
    <table>
      <caption>利用可能なモデルの一覧</caption>
      <thead>
        <tr>
          <th scope="col">モデルID</th>
          <th scope="col">プロバイダ</th>
          <th scope="col">表示名</th>
          <th scope="col">テキスト入力</th>
          <th scope="col">ファイル入力</th>
          <th scope="col">画像入力</th>
          <th scope="col">動画入力</th>
          <th scope="col">推論</th>
          <th scope="col">画像生成</th>
          <th scope="col">動画生成</th>
          <th scope="col">埋め込み</th>
          <th scope="col">再評価</th>
          <th scope="col">対話</th>
          <th scope="col">軽量モデル</th>
          <th scope="col">古いモデル</th>
        </tr>
      </thead>
      <tbody>
        {data?.models.map((model) => (
          <tr>
            <th scope="row">{model.modelId}</th>
            <td>{model.type}</td>
            <td>{model.displayName}</td>
            <td>{modelParam(model.features.text)}</td>
            <td>{modelParam(model.features.doc)}</td>
            <td>{modelParam(model.features.image)}</td>
            <td>{modelParam(model.features.video)}</td>
            <td>{modelParam(model.features.reasoning)}</td>
            <td>{modelParam(model.features.image_gen)}</td>
            <td>{modelParam(model.features.video_gen)}</td>
            <td>{modelParam(model.features.embedding)}</td>
            <td>{modelParam(model.features.reranking)}</td>
            <td>{modelParam(model.features.speechToSpeech)}</td>
            <td>{modelParam(model.features.light)}</td>
            <td>{modelParam(model.features.legacy)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default TestPage;
