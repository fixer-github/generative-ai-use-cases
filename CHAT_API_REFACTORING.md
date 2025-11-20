# チャットAPI改修ドキュメント

## 改修の目的

ストリーミング中のリロードでメッセージが失われる問題を解決するため、Claude.ai方式の実装に変更。

## 改修の概要

### 従来の実装フロー

```
1. ユーザーがメッセージを送信
2. ローカル状態にユーザーメッセージとアシスタントメッセージを追加
3. LLMにストリーミングリクエスト
4. ストリーミング完了後にチャット作成
5. 両方のメッセージをDBに保存
```

**問題点**: ストリーミング中（手順3-4の間）にリロードするとメッセージが失われる

### 新しい実装フロー（Claude.ai方式）

```
1. ユーザーがメッセージを送信（新規チャットの場合）
2. ★即座にチャットをDBに作成
3. ★作成したチャットIDの画面に遷移（/chat → /chat/{chatId}）
4. ★ユーザーメッセージをDBに保存
5. LLMにストリーミングリクエスト
6. アシスタントメッセージをDBに保存
```

**メリット**:
- 手順3以降はいつリロードしても会話が復元できる
- URLにチャットIDが含まれるのでブックマーク・共有が可能
- 常にchatIdが確定した状態で会話が進む

## 変更ファイル一覧

### 1. packages/web/src/hooks/useChat.ts

#### 変更内容

**a) `createChatIfNotExist` を外部から呼び出し可能に**
- フックの戻り値に `createChatIfNotExist` を追加
- ChatPageから呼び出してチャット作成とナビゲーションを制御

**b) `post` 関数の変更**
- チャット作成処理を削除（既に外部で作成済みの前提）
- ユーザーメッセージを先にDBに保存
- その後、アシスタントメッセージの生成を開始

**c) `generateMessage` 関数の変更**
- チャット作成処理を削除（既に作成済みの前提）
- アシスタントメッセージのみをDBに保存
- 保存するメッセージの判定ロジックを追加

**d) `edit` 関数の変更**
- ユーザーメッセージの更新をDBに保存
- その後、アシスタントメッセージの再生成

### 2. packages/web/src/pages/ChatPage.tsx

#### 変更内容

**a) `useNavigate` フックの追加**
- React Routerの `useNavigate` をインポート
- ナビゲーション用のインスタンスを取得

**b) `onSend` 関数の変更**
- 新規チャット（`!chatId`）の場合：
  1. チャットを作成
  2. 作成したチャットIDの画面に遷移
  3. 遷移後、入力内容を保持してメッセージ送信
- 既存チャットの場合：従来通りの動作

**c) ナビゲーション後のメッセージ送信**
- クエリパラメータまたは状態を使用して入力内容を保持
- 遷移後に自動的にメッセージ送信を実行

## 詳細な変更履歴

### 2025-11-19: ChatPage.tsxの修正

**ファイル**: `packages/web/src/pages/ChatPage.tsx`

**変更内容**:

1. **useNavigateフックの追加**
   - `react-router-dom` から `useNavigate` をインポート
   - ナビゲーション用のインスタンスを取得

2. **useChatフックから `createChatIfNotExist` を取得**
   - チャット作成処理を外部から呼び出せるようにするため

3. **onSend関数の修正**
   - 新規チャット（`!chatId`）の場合：
     1. `createChatIfNotExist()` でチャットを作成
     2. `/chat/{newChatId}` に遷移（stateで入力内容を渡す）
     3. 入力フィールドをクリア
   - 既存チャットの場合：従来通りの動作

4. **ナビゲート後の自動メッセージ送信処理を追加**
   - useEffectで `window.history.state` から `pendingMessage` を取得
   - `pendingMessage` があれば自動的に `postChat` を呼び出し
   - 送信後、stateをクリアして重複送信を防止

**効果**:
- 新規チャットでも画面遷移後は常にchatIdが確定
- リロード耐性が向上（遷移後はいつでも復元可能）

### 2025-11-19: useChat.tsのpost関数とgenerateMessage関数の修正

**ファイル**: `packages/web/src/hooks/useChat.ts`

**変更内容**:

#### post関数の修正

1. **ユーザーメッセージを先に保存する処理を追加**
   - ユーザーメッセージをローカル状態に追加
   - チャットIDを取得（ChatPage.tsxで既に作成済みの前提）
   - ユーザーメッセージにID（messageId, createdDate, usecase）を付与
   - ユーザーメッセージをDBに保存（`createMessages`）
   - 保存されたメッセージで状態を更新

2. **タイトル予測のタイミングを変更**
   - `generateMessage` の前に移動
   - ユーザーメッセージ保存後、アシスタントメッセージ生成前に実行

3. **アシスタントメッセージの処理**
   - ユーザーメッセージ保存後にアシスタントメッセージをローカル状態に追加
   - `generateMessage` でアシスタントメッセージのみを生成・保存

#### generateMessage関数の修正

1. **チャット作成処理の削除**
   - `createChatIfNotExist` の呼び出しを削除
   - チャットは既に存在する前提に変更

2. **タイトル予測処理の削除**
   - `setPredictedTitle` の呼び出しを削除
   - post関数で既に実施済み

3. **メッセージ保存ロジックの変更**
   - 'normal'モード：アシスタントメッセージのみを保存
   - 'edit'モード：ユーザーメッセージとアシスタントメッセージの両方を更新
   - 'retry', 'continue'モード：アシスタントメッセージのみを更新

**効果**:
- ユーザーメッセージはストリーミング開始前にDBに保存される
- ストリーミング中のリロードでもユーザーメッセージは保護される
- アシスタントメッセージはストリーミング完了後に保存される

### 2025-11-19: useChat.tsのedit関数の修正

**ファイル**: `packages/web/src/hooks/useChat.ts`

**変更内容**:

1. **編集されたユーザーメッセージをDBに保存**
   - ユーザーメッセージを編集してローカル状態に反映
   - 編集されたユーザーメッセージをDBに保存（`createMessages`）
   - アシスタントメッセージをクリア
   - `generateMessage('edit')` でアシスタントメッセージを再生成・保存

2. **処理の流れを明確化**
   - メッセージの取得、編集、保存、再生成の各ステップを分離
   - エラーハンドリングを追加（チャットが存在しない場合）

**効果**:
- ユーザーメッセージの編集はアシスタントメッセージの再生成前にDBに保存される
- 再生成中のリロードでも編集内容は保護される

## 改修完了サマリー

### 実装された機能

1. **新規チャット作成フロー**
   - メッセージ送信時にチャットを作成
   - 作成したチャットIDの画面に自動遷移
   - 遷移後に自動的にメッセージを送信

2. **ユーザーメッセージの即座保存**
   - ストリーミング開始前にユーザーメッセージをDBに保存
   - リロード耐性の向上

3. **アシスタントメッセージの遅延保存**
   - ストリーミング完了後にアシスタントメッセージを保存
   - 不完全なレスポンスの保存を防止

4. **編集機能の改善**
   - ユーザーメッセージの編集内容を即座にDBに保存
   - 再生成前の編集内容の保護

### テスト項目

#### 基本機能テスト

- [ ] 新規チャット作成
  - [ ] `/chat` でメッセージを送信すると `/chat/{chatId}` に遷移する
  - [ ] 遷移後、自動的にメッセージが送信される
  - [ ] ストリーミングが正常に動作する

- [ ] メッセージ送信
  - [ ] ユーザーメッセージが送信直後にDBに保存される
  - [ ] アシスタントメッセージがストリーミング完了後にDBに保存される
  - [ ] タイトルが自動生成される

- [ ] メッセージ編集
  - [ ] ユーザーメッセージの編集がDBに保存される
  - [ ] アシスタントメッセージが再生成される
  - [ ] 編集後のメッセージがDBに保存される

#### リロード耐性テスト

- [ ] 新規チャット作成直後のリロード
  - [ ] チャット作成後、遷移前のリロード → チャットのみ作成済み
  - [ ] 遷移後、メッセージ送信前のリロード → チャットのみ作成済み
  - [ ] ユーザーメッセージ保存後、ストリーミング前のリロード → ユーザーメッセージが保存されている
  - [ ] ストリーミング中のリロード → ユーザーメッセージが保存されている
  - [ ] ストリーミング完了後のリロード → 全メッセージが保存されている

- [ ] メッセージ編集中のリロード
  - [ ] ユーザーメッセージ編集後、再生成前のリロード → 編集内容が保存されている
  - [ ] 再生成中のリロード → 編集内容が保存されている

#### 既存機能との互換性テスト

- [ ] 既存チャットへのメッセージ追加
- [ ] リトライ機能
- [ ] 続きから生成機能
- [ ] ファイルアップロード機能
- [ ] システムコンテキストのカスタマイズ

### 2025-11-19: フロントエンドでチャットID生成（UX改善）

**ファイル**:
- `packages/cdk/lambda/repository/chat.ts`
- `packages/cdk/lambda/createChat.ts`
- `packages/web/src/hooks/useChatApi.ts`
- `packages/web/src/hooks/useChat.ts`
- `packages/web/src/pages/ChatPage.tsx`

**変更内容**:

#### バックエンドの変更

1. **createChat関数の修正**
   - オプショナルで `chatId` パラメータを受け取る
   - 指定されたchatIdを使用してチャットを作成
   - 指定がない場合は従来通りUUIDを生成

2. **Lambda ハンドラーの修正**
   - リクエストボディから `chatId` を取得
   - `createChat` に渡す

#### フロントエンドの変更

1. **ChatPage.tsx の修正**
   - `uuidv4` をインポート
   - `onSend` 関数でフロントエンドでUUIDを生成
   - **チャット作成を待たずに即座にナビゲート**
   - ナビゲート後の `useEffect` で：
     - 生成したchatIdでチャットを作成
     - メッセージを送信

2. **useChatApi.ts の修正**
   - `createChat` 関数でオプショナルで `chatId` を受け取る
   - リクエストボディに含めて送信

3. **useChat.ts の修正**
   - `createChatIfNotExist` 関数でオプショナルで `chatId` を受け取る

**効果**:
- **画面遷移が即座に行われる**（チャット作成を待たない）
- **ユーザー体験が大幅に向上**
- チャット作成とメッセージ送信を並行して処理
- チャットの続行が可能

### 2025-11-20: 新規チャットのルート変更とUI調整

**ファイル**:
- `packages/web/src/components/DynamicRouter.tsx`
- `packages/web/src/components/ChatSidebar.tsx`
- `packages/web/src/components/ButtonSendToUseCase.tsx`
- `packages/web/src/pages/ChatPage.tsx`

**変更内容**:

#### ルーティング構造の変更

1. **DynamicRouter.tsx**
   - 新規チャットのルートを `/chat` から `/chat/new` に変更
   - `/chat` へのアクセスは `/chat/new` へリダイレクト
   - ルーティング構造：
     ```typescript
     {
       path: '/chat',
       element: <ChatLayout />,
       children: [
         { index: true, element: <Navigate to="/chat/new" replace /> },
         { path: 'new', element: <ChatPage /> },
         { path: ':chatId', element: <ChatPage /> },
       ]
     }
     ```

2. **ChatSidebar.tsx**
   - 新規チャットボタンのナビゲート先を `/chat/new` に変更
   - `/chat/new` で既にある場合は `onNewChat` を呼び出してリセット

3. **ButtonSendToUseCase.tsx**
   - チャットへの送信先を `/chat/new` に変更

#### UI調整

4. **ChatPage.tsx**
   - 空のチャットで入力ボックスを画面中央に配置する実装を削除
   - `isEmpty` の使用を削除
   - 一貫したUIレイアウトを維持

#### パラメータ処理の改善

5. **ChatPage.tsx**
   - `rawChatId === 'new'` の場合、`chatId` を `undefined` として扱う
   - 新規チャットと既存チャットの判定を明確化

**効果**:
- 新規チャットと既存チャットのURLが明確に区別される
- `/chat/new` で一貫した新規チャット体験を提供
- UIの一貫性が向上

### 2025-11-20: pendingMessage処理の修正

**ファイル**:
- `packages/web/src/pages/ChatPage.tsx`

**問題**:
新規チャット作成後、画面遷移は行われるが、メッセージが送信されず空のチャットが表示される。

**原因**:
- `pendingMessageProcessedRef` が一度 `true` に設定されると、同じコンポーネントインスタンスが再利用される場合にリセットされない
- React Routerが同じコンポーネントインスタンスを再利用するため、異なるchatIdに遷移してもrefがリセットされず、pendingMessageが処理されない
- useEffectの依存配列に必要な関数（`createChatIfNotExist`, `postChat`）が含まれていなかった

**変更内容**:

1. **prevChatIdRefの追加**
   - 前回のchatIdを追跡する新しいrefを追加
   - chatIdが変更されたかを検出するために使用

2. **refのリセットロジック**
   - useEffectの最初で、`prevChatIdRef.current !== chatId` をチェック
   - chatIdが変更された場合、`pendingMessageProcessedRef` を `false` にリセット
   - `prevChatIdRef.current` を現在のchatIdに更新

3. **依存配列の修正**
   - `createChatIfNotExist` と `postChat` を依存配列に追加
   - ESLintの警告を解消
   - 関数が変更された場合に正しく再実行される

4. **未使用変数の削除**
   - `isEmpty` を削除（前回のUI調整で使用されなくなったため）

**コード**:
```typescript
const pendingMessageProcessedRef = useRef(false);
const prevChatIdRef = useRef<string | undefined>();

useEffect(() => {
  // chatIdが変更されたらrefをリセット
  if (prevChatIdRef.current !== chatId) {
    pendingMessageProcessedRef.current = false;
    prevChatIdRef.current = chatId;
  }

  // 既に処理済みの場合はスキップ
  if (pendingMessageProcessedRef.current || !chatId) {
    return;
  }

  const state = (window.history.state as { state?: { pendingMessage?: any } })?.state;

  if (state?.pendingMessage) {
    // ... メッセージ処理
    pendingMessageProcessedRef.current = true;
    // ...
  }
}, [chatId, createChatIfNotExist, postChat]);
```

**効果**:
- 同じコンポーネントインスタンスが再利用される場合でも、chatIdが変更されるたびにpendingMessageが正しく処理される
- 新規チャット作成後のメッセージ送信が正常に動作する
- ESLintの警告が解消される

### コミット履歴

```
052b2f03 🐛 pendingMessage処理の修正
30efa5b5 :memo: フロントエンドでチャットID生成の変更をドキュメント化
d1446312 🐛 コンパイルエラーを修正
506a72ae 🐛 createChatIfNotExistの型定義を修正
49b7b5ad 🐛 useChatState型からcreateChatIfNotExistを削除
92e7eb06 🐛 useChatState型にcreateChatIfNotExistを再追加
e3bf1f3f ✨ フロントエンドでチャットIDを生成して即座にナビゲート
669f287a 🐛 チャットIDからchat#プレフィックスを削除
90afa569 🐛 edit関数からmutateListChatパラメータを削除
c0780552 🐛 未使用のmutateListChatパラメータを削除
22cbca5d :memo: 改修完了サマリーとテスト項目を追加
1f07124d ♻️ edit関数を修正してユーザーメッセージを先に保存
c036fc4d ♻️ post関数とgenerateMessage関数を修正
f0f3154c ✨ チャット作成とナビゲーション処理を実装
a94257eb :memo: チャットAPI改修のドキュメントを追加
```

