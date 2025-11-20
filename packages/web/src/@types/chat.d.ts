import {
  UploadedFileType,
  AdditionalModelRequestFields,
} from 'generative-ai-use-cases';

/**
 * 新規チャット作成時にlocation.stateで渡されるメッセージデータ
 */
export interface PendingMessage {
  /** メッセージの内容 */
  content: string;
  /** アップロードされたファイル */
  uploadedFiles?: UploadedFileType[];
  /** base64エンコードされたファイルのキャッシュ */
  base64Cache?: Record<string, string>;
  /** モデルパラメータのオーバーライド */
  overrideModelParameters?: AdditionalModelRequestFields;
  /** 使用するモデルID */
  modelId?: string;
}

/**
 * チャットページのlocation.stateの型定義
 */
export interface ChatLocationState {
  /** 新規チャット作成時の保留中のメッセージ */
  pendingMessage?: PendingMessage;
}
