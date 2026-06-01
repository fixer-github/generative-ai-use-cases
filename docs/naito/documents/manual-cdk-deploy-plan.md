# 汎用マニュアルエージェント デプロイ用 CDK 実装計画書（GenU 本体側）

**作成日**: 2026-05-29
**対象**: GenU 本体リポジトリ（`generative-ai-use-cases`）の CDK 層に、汎用マニュアルエージェント機能のインフラを新規追加するための実装計画
**位置づけ**: 本書は実装の「正」ではない。設計の正は FIXER.Medical.AgentCore リポジトリの `docs/dev-diary/naito/documents/manual-implementation-plan.md`（以下「本体計画書」）である。本書はその本体計画書のうち **GenU 側 CDK で実装すべきインフラ部分のみ** を、GenU の既存 CDK 構造に合わせて手順化したものである。両者が矛盾した場合は本体計画書を優先する。
**重要な制約**: 本書は計画のみであり、CDK コード（`.ts`）の生成・既存ファイルの改修は含まない。実装は本体計画書のフェーズ（B1〜B10）順に、各フェーズ着手直前の残課題確定とユーザー確認（y/n）を経て行う。

---

## 0. 本書を書くにあたって確認した GenU 既存構造（事実）

実装方針を GenU の既存パターンに揃えるため、以下を実コードで確認した（2026-05-29 時点）。

| 確認対象 | パス | 要点 |
|---|---|---|
| エントリポイント | `packages/cdk/bin/generative-ai-use-cases.ts` | `getParams(app)` で全パラメータを得て `createStacks(app, params)` を呼ぶだけの薄い層 |
| パラメータ定義 | `packages/cdk/lib/stack-input.ts` | zod スキーマ `baseStackInputSchema`。機能フラグは `xxxEnabled: z.boolean().default(false)` の形で定義（例：`ragKnowledgeBaseEnabled`・`agentBuilderEnabled`・`createGenericAgentCoreRuntime`） |
| パラメータ解決 | `packages/cdk/parameter.ts` | CDK Context / `envs` から取得し `ProcessedStackInput` へ整形。`agentCoreRegion: params.agentCoreRegion || params.modelRegion` のような既定値補完を行う |
| スタック配線 | `packages/cdk/lib/create-stacks.ts` | フラグが立つときだけ各スタックを `new` する分岐がある（例：`ragKnowledgeBaseEnabled && !ragKnowledgeBaseId ? new RagKnowledgeBaseStack(...) : null`、`createGenericAgentCoreRuntime || agentBuilderEnabled ? new AgentCoreStack(...) : null`）。本体スタックへ依存を `addDependency` で明示している |
| AgentCore スタック | `packages/cdk/lib/agent-core-stack.ts` | `params` を受け、`GenericAgentCore` Construct を生成。Runtime ARN・ファイルバケット名を `CfnOutput`（`REMOTE_OUTPUT_KEYS`）で出力し、クロスリージョン参照（`cdk-remote-stack` の `RemoteOutputs`）で本体スタックへ渡す |
| AgentCore Construct | `packages/cdk/lib/construct/generic-agent-core.ts` | `@aws-cdk/aws-bedrock-agentcore-alpha` の `Runtime` を使用。`AgentRuntimeArtifact.fromAsset(dockerPath)` で Docker イメージをアセット化。実行ロールへ `bedrock:InvokeModel` 等を付与し、`fileBucket.grantWrite(role)` でS3書き込みを許可。`environmentVariables` で `FILE_BUCKET` 等をコンテナへ注入 |
| DynamoDB Construct | `packages/cdk/lib/construct/database.ts` | `ddb.Table`（`billingMode: PAY_PER_REQUEST`）。パーティションキー＋必要に応じソートキー・GSI。最小限の素直な定義 |
| 削除ポリシー | `create-stacks.ts` の `DeletionPolicySetter` アスペクト | 本体スタックに `RemovalPolicy.DESTROY` を一括適用するアスペクトがある |

> 注：本体計画書 第10章は改修対象3ファイルを `bin/generative-ai-use-cases.ts` / `lib/stack-input.ts` / `parameter.ts` と短縮表記しているが、GenU 実体での正確なパスはいずれも `packages/cdk/` 配下である。

---

## 1. 本書の対象範囲（GenU CDK 側で作るもの／作らないもの）

### 1.1 GenU CDK 側で作るもの（本書の対象）

本体計画書 第2.1章「構成要素7つ」のうち、**インフラ実体**は GenU 側 CDK で定義する。

| # | 構成要素（本体計画書） | GenU CDK での実装 |
|---|---|---|
| 1 | API（API Gateway） | 新スタック内に REST API + Cognito オーサライザ |
| 2 | マニュアル管理 Lambda | 新スタック内の関数（Node.js or Python） |
| 3 | チャット中継 Lambda | 新スタック内の関数。AgentCore Runtime を呼ぶ |
| 4 | 前処理 Lambda（Docker Image） | 新スタック内の Docker イメージ関数（poppler-utils 同梱） |
| 6 | S3（ファイル保管庫） | 新スタック内のバケット |
| 7 | DynamoDB（設定保管庫） | 新スタック内の1テーブル |

加えて：
- IAM ロール／ポリシー（最小権限。各 Lambda・AgentCore 実行ロール）
- S3 → 前処理 Lambda の起動イベント配線
- 機能フラグ `manualRagEnabled` の追加（zod スキーマ・既定値・分岐）
- AgentCore Runtime（構成要素5）の **CDK 上の宣言と配線**（後述 1.3）

### 1.2 GenU CDK 側で作らないもの（本書の対象外）

- **AI 実行環境の実体**（`agent.py`・マニュアル参照ツール7種・システムプロンプト・Dockerfile・`deploy.py`）は、FIXER.Medical.AgentCore リポジトリの `agents/manual-agent`（仮称）側で実装する。本体計画書 第5章・第6章・フェーズ B7・B8 が該当。
- **フロントエンド**（マニュアル参照モードのUI、管理者向け管理画面）は GenU の `packages/web` 側。本体計画書 第10章後段・フェーズ B3 が該当。本書はインフラに限定するため対象外（ただしフラグ連携の整合のみ 第6章で触れる）。
- 前処理 Lambda・各 Lambda の**業務ロジック実装**は本書の対象外（本書は CDK によるリソース定義方針のみ）。

### 1.3 AgentCore Runtime の扱い（要・設計判断＝残課題G に連動）

本体計画書 第5.3章により「マニュアル参照ツールを AI 実行環境へどう供給するか（実装言語へ直接組み込むか、外部プロトコル経由か）」は残課題G として未確定。これにより **AgentCore Runtime を GenU CDK 側で `Runtime` Construct として宣言するか、それとも AgentCore 側リポジトリの `deploy.py`（既存 infection-chatbot-toc と同方式）でデプロイし、GenU CDK は ARN を参照するだけにするか** が決まる。

- 既存 GenU の `GenericAgentCore` は前者（CDK の `Runtime` で宣言）。
- 既存 FIXER.Medical.AgentCore の各エージェントは後者（`bedrock_agentcore` の `deploy.py` / CodeBuild）。

**本書ではこの判断を確定しない。** B7 着手時に残課題G とあわせてユーザー確認する。本書の以降の記述は「どちらに転んでも成立する」よう、Runtime 本体の生成手段は両論併記とし、GenU CDK 側は最低限「Runtime ARN を環境変数としてチャット中継 Lambda へ渡す配線」を持つ前提で書く。

---

## 2. 新規スタック構成

### 2.1 スタックの新設

既存パターン（`RagKnowledgeBaseStack`・`AgentCoreStack` 等が `lib/*.ts` に1ファイル1スタック）に倣い、次を新設する。

| 種別 | ファイル（案） | 内容 |
|---|---|---|
| スタック | `packages/cdk/lib/manual-rag-stack.ts` | `ManualRagStack`（仮称）。本機能のインフラを束ねる |
| Construct 群 | `packages/cdk/lib/construct/manual-rag/` 配下 | リソースを責務単位の Construct に分割（下記 2.2） |

> 命名は実装時に最終決定する（残課題ではなく実装細目）。本書では `ManualRag*` を仮の接頭辞として用いる。

### 2.2 Construct 分割（案）

責務ごとに Construct を分けて見通しを保つ（既存 `construct/` の粒度に合わせる）。

| Construct（案） | 責務 | 主なリソース |
|---|---|---|
| `ManualStorage` | 保管庫 | S3 バケット1、DynamoDB テーブル1 |
| `ManualPreprocess` | 前処理 | 前処理 Lambda（Docker Image）、S3→Lambda イベント、Textract 権限 |
| `ManualAdminApi` | 管理API | マニュアル管理 Lambda、API Gateway リソース（管理者スコープ） |
| `ManualChatRelay` | チャット中継 | チャット中継 Lambda、API Gateway リソース（利用者スコープ）、AgentCore 呼び出し権限 |
| （`ManualRuntime`） | AI実行環境 | 残課題G の判断次第で AgentCore `Runtime` を宣言（1.3 参照） |

### 2.3 スタックの配置リージョン

本体計画書 残課題A の確定値（リージョン＝既存 infection-chatbot-toc と同一の `us-east-1`、モデル＝Sonnet 4.5 のクロスリージョン推論プロファイル `us.anthropic.claude-sonnet-4-5-20250929-v1:0`、Textract・Bedrock とも当該リージョンで利用可）に従う。

- `create-stacks.ts` で `ManualRagStack` を `new` する際の `env.region` は `params.region`（GenU 本体と同一リージョン）を基本とする。
- AgentCore Runtime を CDK で宣言する場合（残課題G）は、既存 `AgentCoreStack` と同様 `params.agentCoreRegion`（既定は `modelRegion`）を用いる。

---

## 3. 各リソースの CDK 定義方針

### 3.1 S3（ファイル保管庫）

本体計画書 第3.1章のキー構成（`{manual_id}/original.*`・`pages/page_0001.png|.md`・`toc.md|.json`・`page_map.json`）を保存するバケット。

- セキュリティ：既存 `GenericAgentCore.createFileBucket()` に倣い `BlockPublicAccess.BLOCK_ALL` / `BucketEncryption.S3_MANAGED`。
- ライフサイクル：`removalPolicy` は本機能のデータ性質（マニュアル原本＝再取得可だが運用上は保持したい）に応じて B1 着手時に確定（残課題候補：DESTROY か RETAIN か）。本体計画書には明記がないため**実装仕様として確定が必要**。
- アップロード方式：本体計画書 第7章の「presigned URL でブラウザから直接 S3 へ」を実現するため、CORS 設定（許可オリジン＝GenU の CloudFront ドメイン）を付与する。許可オリジンの具体値は B2（管理API）着手時に確定。
- イベント通知：原本保存（`{manual_id}/original.*` の PUT）を契機に前処理 Lambda を起動（3.3 と 3.5）。

### 3.2 DynamoDB（設定保管庫・1テーブル）

本体計画書 第3.2章の通り **1テーブル・属性9個**。既存 `Database` Construct（`PAY_PER_REQUEST`）に倣う。

- パーティションキー：`manual_id`（文字列）。ソートキー：**なし**（1マニュアル＝1アイテム、キー検索のみ）。
- GSI：本体計画書では一覧取得（`get_all_manuals`／管理一覧）が必要だが、件数は環境内マニュアル数（小規模想定）であり `Scan` で足りる可能性が高い。GSI を設けるか否かは B1 着手時に確定（残課題候補）。本体計画書はGSIに言及していないため、**既定はGSIなし**とし、必要性が出たフェーズで追加を判断する。
- 属性9個（`title`・`description`・`status`・`error_detail`・`page_count`・`original_filename`・`created_at`・`updated_at`）はスキーマレスのため CDK では宣言不要（キーのみ宣言）。
- 課金：`PAY_PER_REQUEST`。
- `removalPolicy`：S3 と同様 B1 着手時に確定。

### 3.3 前処理 Lambda（Docker Image 形式）

本体計画書 第4章・第9章の通り、`poppler-utils`（`pdftoppm`）を同梱する Docker Image 関数。

- 形式：`DockerImageFunction`（`lambda.DockerImageCode.fromImageAsset(...)`）。Dockerfile に `poppler-utils` を `apt-get install` で同梱。テキスト抽出は pypdf(BSD-3)・pdfplumber(MIT)、OCR は Amazon Textract（PyMuPDF は不使用）。
- メモリ／タイムアウト：PDF のページ画像生成・OCR を伴うため大きめ。具体値は B4/B5 着手時に確定（残課題候補。本体計画書に数値指定なし）。
- 権限（最小権限）：
  - S3：当該バケットへの読み取り（原本）と書き込み（成果物）。
  - DynamoDB：当該テーブルへの更新（`status`・`error_detail`・`page_count`）。
  - Textract：`textract:DetectDocumentText` 等（閾値未満ページの OCR のみ。第4章ステップ3）。
- 起動：S3 イベント（3.5）。

### 3.4 マニュアル管理 Lambda／チャット中継 Lambda／API Gateway

- **マニュアル管理 Lambda**（本体計画書 第7章）：アップロード（presigned URL 発行）・一覧・削除・再処理・説明文編集。S3 書き込み（原本／削除時のディレクトリ削除）と DynamoDB 読み書き権限。
- **チャット中継 Lambda**（本体計画書 第6章）：DynamoDB から全マニュアルの `title`・`description` を読み、システムプロンプトへ併合のうえ AgentCore Runtime を呼び、ストリーミングで返す。DynamoDB 読み取り＋ `bedrock-agentcore:InvokeAgentRuntime`（呼び出し先 Runtime ARN へ限定）権限。
- **API Gateway**：本体計画書 第8章の認可。Cognito オーサライザ。管理系操作（登録・削除・再処理・説明文編集）は管理者ロール、チャットは全利用者。管理者ロールの判定方法は**残課題B として 2026-06-01 に確定**：既存 `admin` グループを流用し、Cognito オーソライザで認証したうえで管理 Lambda 内で `cognito:groups` に `admin` を含むか検査する（本体計画書 第2.5章）。
  - 既存 GenU の認可・Cognito 構成（`construct/auth.ts`・`construct/api.ts`）の流儀を踏襲する。`construct/admin-api.ts` は参考候補としていたが、B2 着手時の精査で**当該ファイルは GenU に存在しない**ことを確認した。`admin` グループも GenU の CDK では定義されておらず、User Pool 上に別経路で作成済みのものを参照する（`CfnUserPoolGroup` の新設は不要）。`cognito:groups` の利用は既存 `construct/rag.ts:215`（Kendra ACL）に前例がある。
  - オーソライザに渡す UserPool の参照方法は第4章の生成順序（案A）を参照。

### 3.5 S3 → 前処理 Lambda のイベント配線

- 方式：S3 バケットのイベント通知（`s3.EventType.OBJECT_CREATED`、プレフィックス／サフィックスで `{manual_id}/original.*` を対象）で前処理 Lambda を起動。
- 再処理（本体計画書 第7章・残課題C）：**2026-06-01 確定**。再処理は原本を再 PUT しないため S3 イベントは発火しない。よって管理 Lambda から前処理 Lambda を**非同期 invoke（Event）**する経路をとる。起動前のクリア順序は ①DynamoDB を `status=processing` に更新 → ②S3 の `{manual_id}/pages/` 配下・`toc.*`・`page_map.json` を削除 → ③前処理 Lambda を invoke（本体計画書 第2.5章・第7章）。前処理 Lambda の実体は B4 のため、B2 では invoke 先 ARN を環境変数の器として用意し、未配線でも synth が通る形にする。

### 3.6 IAM（最小権限の原則）

本体計画書 第2.2章の依存関係に厳密に従い、各ロールに必要最小限のみ付与する。

| 主体 | 許可する操作（要点） |
|---|---|
| 前処理 Lambda | S3 当該バケット R/W、DynamoDB 当該テーブル更新、Textract OCR |
| マニュアル管理 Lambda | S3 当該バケット R/W・削除、DynamoDB 当該テーブル R/W |
| チャット中継 Lambda | DynamoDB 当該テーブル読み取り、AgentCore Runtime の Invoke |
| AI 実行環境（AgentCore 実行ロール） | S3 当該バケット **読み取りのみ**、DynamoDB 当該テーブル **読み取りのみ**（本体計画書 第2.2章「書き込みは行わない」を厳守。既存 `generic-agent-core.ts` は `grantWrite` だが本機能は `grantRead` に絞る） |

---

## 4. 機能フラグ `manualRagEnabled` の連携

本体計画書 第10章の通り、改修は既存3ファイルのみ。**フラグ false で従来挙動を完全維持**する。

| ファイル（GenU 実体パス） | 変更内容 | 既存パターンの参考 |
|---|---|---|
| `packages/cdk/lib/stack-input.ts` | `baseStackInputSchema` に `manualRagEnabled: z.boolean().default(false)` を追加 | 既存 `ragKnowledgeBaseEnabled` 等と同形 |
| `packages/cdk/parameter.ts` | 既定値 `false`（zod の default で吸収されるため、明示追記は任意。`envs` で環境別に上書き可能にする方針のみ確認） | 既存フラグと同様、CDK Context / `envs` 経由 |
| `packages/cdk/bin/generative-ai-use-cases.ts` | 直接の分岐は不要（薄い層のため）。実際の分岐は `create-stacks.ts` に置く | 既存も `createStacks` 側で分岐 |
| `packages/cdk/lib/create-stacks.ts`（※本体計画書の3ファイルには明記されないが実務上ここに分岐が必要） | `params.manualRagEnabled ? new ManualRagStack(...) : null` を追加し、本体スタックへ必要な値（API エンドポイント等）を受け渡し、`addDependency` を張る | 既存 `AgentCoreStack`・`RagKnowledgeBaseStack` の分岐と同形 |

> 注意：本体計画書 第10章は改修対象を3ファイルとするが、GenU の実構造ではスタックを実際に `new` する箇所は `create-stacks.ts` である。3ファイル（zod スキーマ／既定値／エントリ）に加え `create-stacks.ts` への分岐追加が技術的に必須になる。この差異は B1 着手時にユーザーへ報告し、本体計画書 第10章へ追記する（本体計画書 14.2 の手順）。

### 4.1 ManualRagStack の生成順序（案A・2026-06-01 確定）

B1 では `ManualRagStack` を `GenerativeAiUseCasesStack`（UserPool を所有）より**前**で生成していた。B2 の管理 API には Cognito オーソライザ（`CognitoUserPoolsAuthorizer`）のため UserPool 参照が必要だが、生成順序が前のままでは `generativeAiUseCasesStack.userPool` を渡せない。

そこで **案A** を採用する（2026-06-01 ユーザー確認）：

- `create-stacks.ts` の `ManualRagStack` 生成を `generativeAiUseCasesStack` 生成より**後ろへ移動**し、`userPool` / `userPoolClient` を props で受け渡す。これは既存 `DashboardStack` が `generativeAiUseCasesStack.userPool` を受け取る確立パターンと同形。
- `generativeAiUseCasesStack.addDependency(manualRagStack)` ではなく、参照方向に合わせ `ManualRagStack` 側が UserPool に依存するため、生成順序の後置で依存が成立する（必要に応じて明示 `addDependency` を付与）。
- 移動は追加した if ブロックの位置変更のみで、フラグ false なら従来どおり非生成＝既存無影響を維持する。

---

## 5. AgentCore Runtime との接続点

- チャット中継 Lambda は AgentCore Runtime を呼ぶため、その **Runtime ARN** を環境変数で受け取る。
- ARN の供給元は残課題G の判断で分岐：
  - **(a) GenU CDK で Runtime を宣言する場合**：既存 `AgentCoreStack` と同様、`Runtime` の `agentRuntimeArn` を取得して同一スタック内でチャット中継 Lambda の環境変数へ渡す（クロスリージョンなら `CfnOutput` + `RemoteOutputs`）。
  - **(b) AgentCore 側リポジトリの `deploy.py` でデプロイする場合**：デプロイ済み Runtime の ARN を CDK パラメータ（`stack-input.ts` に `manualAgentRuntimeArn: z.string().nullish()` 等）として受け取り、環境変数へ渡す。既存 `agentCoreExternalRuntimes` パラメータの考え方が参考になる。
- 本書はどちらかに確定しない（1.3）。B7 着手時に確定し、本体計画書 第5.3章・本書 第2.2/5章へ追記する。

---

## 6. フェーズ対応（本体計画書 B1〜B10 のうち GenU CDK 側の作業）

| フェーズ | GenU CDK 側で行う作業 | 残課題（本体計画書 14.1） |
|---|---|---|
| B1 | `ManualRagStack` 骨組み、S3、DynamoDB（1テーブル）、IAM の土台、`manualRagEnabled` フラグ追加、`create-stacks.ts` 分岐 | 残課題A（確定済）＋ S3/DDB の removalPolicy・GSI 要否（本書 3.1/3.2） |
| B2 | 管理 API（API Gateway + マニュアル管理 Lambda）、presigned URL、CORS、再処理時のクリア順序 | 残課題B（管理者ロール判定）・C（URL発行方式・クリア順序） |
| B3 | （フロント。CDK 対象外。フラグ連携の整合のみ確認） | なし |
| B4 | 前処理 Lambda（Docker Image・poppler 同梱）の関数定義、S3 イベント配線、メモリ/タイムアウト確定 | 残課題D（TXT/MD のページ分割値） |
| B5 | （前処理 PDF 対応は Lambda 内ロジック。CDK 側は B4 で定義済の関数を使用） | 残課題E（page_map 生成方法） |
| B6 | Textract 権限の付与（B4 の IAM に含めるか、B6 で追加か） | 残課題F（OCR 閾値） |
| B7 | AgentCore Runtime の宣言／ARN 受け渡し配線（残課題G 次第。本書 1.3/5） | 残課題G（ツール供給方式） |
| B8 | （ツール実装は AgentCore 側リポジトリ。CDK 対象外） | 残課題G（B7 と共通） |
| B9 | チャット中継 Lambda の定義、AgentCore Invoke 権限、ストリーミング配線 | なし |
| B10 | 全体動作確認・権限境界試験・削除整合試験（CDK のデプロイ確認を含む） | なし |

---

## 7. 既存への非影響の担保

- `manualRagEnabled` が `false`（既定）のとき、`create-stacks.ts` は `ManualRagStack` を生成せず、本体スタックにも一切の参照を加えない。→ **従来挙動を完全維持**。
- 既存 `agentBuilder` 関連（`construct/agent-builder.ts`・`construct/generic-agent-core.ts`）、既存 `AgentCoreStack`、既存 RAG 系（`rag-knowledge-base-stack.ts`・`construct/rag*.ts`）には変更を加えない。新規ファイル追加と、既存4ファイル（zod スキーマ／既定値／エントリ／`create-stacks.ts` 分岐）への**追加のみ**。
- FIXER.Medical.AgentCore リポジトリ側の既存エージェント（`infection-chatbot-toc` 等）には一切変更を加えない。

---

## 8. 実装仕様の確定状況

設計方針は確定済み。以下は「方式の範囲内で値・手段を1つ選ぶ」レベルの実装仕様。B1 着手時（2026-05-29）にユーザー確認のうえ確定した。

| # | 項目 | 確定値（2026-05-29） |
|---|---|---|
| 1 | 新スタック名・Construct 名 | 仮称のまま確定：スタック `ManualRagStack`、Construct は `construct/manual-rag/` 配下（`ManualStorage` 等） |
| 2 | S3・DynamoDB の `removalPolicy` | **`RETAIN`**（マニュアル原本・メタ情報はユーザー資産。誤削除回避を優先。`autoDeleteObjects` は付けない） |
| 3 | DynamoDB の GSI 要否 | **なし**（一覧取得は `Scan`。環境内マニュアルは小規模想定） |
| 4 | 本体計画書 第10章へ `create-stacks.ts` を加える追記 | **追記する**（本体計画書 第10章を更新済み） |
| 5 | AgentCore Runtime：CDK 宣言（a）か外部 ARN 参照（b）か | **B7 着手時に残課題G とあわせて確定**（B1 では確定不要。ARN を環境変数で受け取る配線のみ前提とする） |

B2 着手時（2026-06-01）に次を確定した。

| # | 項目 | 確定値（2026-06-01） |
|---|---|---|
| 6 | 管理者ロール判定（残課題B） | 既存 `admin` グループを流用。Cognito オーソライザで認証 + 管理 Lambda 内で `cognito:groups` に `admin` を含むか検査。`CfnUserPoolGroup` の新設なし、`auth.ts` 非改変 |
| 7 | アップロード URL（残課題C） | presigned PUT URL、有効期限 **15 分**、許可形式 PDF/TXT/MD のみ、キー `{manual_id}/original.{ext}` |
| 8 | 再処理の起動経路・クリア順序（残課題C） | 管理 Lambda から前処理 Lambda を非同期 invoke。①status=processing → ②`pages/`・`toc.*`・`page_map.json` 削除 → ③invoke。B2 では invoke 先 ARN は環境変数の器のみ（実体は B4） |
| 9 | 管理 Lambda 実装言語・配置 | Node.js/TypeScript、ハンドラは `packages/cdk/lambda/manual/` 配下に新規。`NodejsFunction` で定義（既存 GenU 慣習） |
| 10 | API Gateway | 新スタック内に新規 `RestApi` を作成（既存 `construct/api.ts` は非改変）。Cognito オーソライザは既存 UserPool を参照 |
| 11 | Construct 分割 | `construct/manual-rag/admin-api.ts` に `ManualAdminApi`（管理 Lambda 5種 + REST API）を新設 |
| 12 | ManualRagStack 生成順序 | 案A：`generativeAiUseCasesStack` の後ろへ移動し `userPool`/`userPoolClient` を props 受け渡し（第4.1章） |

B4 着手時（2026-06-01）に次を確定した（前処理 Lambda 骨組み・TXT/MD のページ分割）。

| # | 項目 | 確定値（2026-06-01） |
|---|---|---|
| 13 | 残課題D（TXT 上限文字数・Markdown 例外） | D-1=**2,000 文字**／D-2=見出し無し・最初の見出し前は固定文字数分割、見出し分割後の上限超過は固定文字数で再分割／D-3=TXT・MD の `page_map.json` は印刷番号「なし(null)」で生成・`toc.*` 非生成（本体計画書 第4章ステップ3） |
| 14 | 前処理 Lambda 実装言語・配置 | **Python 3.13 / Docker Image**。ベースは **AWS 公式 Lambda イメージ `public.ecr.aws/lambda/python:3.13`**（Lambda Runtime Interface 同梱）。前処理はイベント駆動（S3 イベント／直接 invoke）であり HTTP 常駐ではないため、`mcp-api` の Lambda Web Adapter＋`uv run` 方式は採らず、`CMD ["app.handler"]` のイベントハンドラ構成とする。依存は **pip**（B4 は標準ライブラリ＋同梱 boto3。pypdf 等は B5 で追記）、`poppler-utils` は **dnf** で同梱（別プロセス呼び出し＝GPL 非伝播は維持）。配置 `packages/cdk/lambda-python/manual-preprocess/`、Construct は `construct/manual-rag/preprocess.ts` |
| 15 | コンテナ実行条件 | **x86_64 / memorySize 2048MB / timeout 15分**（イベント駆動 Lambda。B5 の画像化を見越した余裕値）。ephemeral storage は PDF 画像化を行う B5 で見直す |
| 16 | 起動経路 | 1ハンドラで2系統を受ける：(あ) S3 イベント（通常アップロード）／(い) 直接 invoke `{manual_id}`（再処理。既存 `reprocessManual.ts` が送る形式） |
| 17 | S3 通知フィルタ（自己ループ防止） | suffix フィルタで **`original.txt` / `original.md` のみ**発火（B4 範囲）。`pages/page_0001.md` 等の派生物は後方一致せず再発火しない。ハンドラ側でも `original.` 以外を無視（多重防御）。`original.pdf` の配線は B5 で追加 |
| 18 | `PREPROCESS_FUNCTION_ARN` 配線 | `ManualAdminApi` から再処理 Lambda を公開し、スタックで前処理 Lambda の ARN を env 注入＋`grantInvoke`（B2 のプレースホルダを実体化） |
| 19 | CfnOutput（フロント繋ぎ込み用） | `ManualRagStack` に **管理 API URL／バケット名／テーブル名** を出力 |

B5 着手時（2026-06-01）に次を確定した（前処理 Lambda の PDF 対応）。CDK 側はほぼ B4 で定義済みの関数を流用し、変更は依存追加・S3 トリガ追加に限られる。

| # | 項目 | 確定値（2026-06-01） |
|---|---|---|
| 20 | 残課題E（`page_map.json` 生成方法） | **案ア＝フッター読み取り方式**。pdfplumber で各物理ページ下部のテキストから印刷番号（アラビア数字・ローマ数字）を読み、読めなければ `null`。PDF のみ適用、TXT・MD は全ページ `null`（本体計画書 第4章ステップ4）。案イ（一定ずれ量検出）は途中リセット等に弱く不採用 |
| 21 | ページ画像生成 | `pdftoppm -png -r 150`（**150 DPI / PNG**）で `pages/page_0001.png` 連番。/tmp へ生成→S3 アップロード→/tmp から削除し ephemeral storage を逐次解放 |
| 22 | テキスト抽出ライブラリ | **pypdf**（各ページ本文抽出＋しおり/outline 取得）、**pdfplumber**（フッター数字の位置読み取り＝案ア）。PyMuPDF は不使用（本体計画書 第9章） |
| 23 | OCR 振り分け | **B5 では行わない**。全ページを画像化し、抽出テキストで `page_0001.md` を書く。テキストが取れない／極小ページは短い・空の `.md` のまま。閾値判定と Textract 呼び出しは **B6**（残課題F） |
| 24 | toc 生成 | pypdf でしおり（outline）があれば `toc.json`/`toc.md` 生成、無ければ生成しない（本体計画書 第4章ステップ5） |
| 25 | コンテナ実行条件（B5 据え置き） | **memory 2048MB / ephemeral 2048MB / timeout 15分** を維持。ページ単位で画像を逐次 S3 アップロード後に /tmp 削除するため据え置きで足りる |
| 26 | S3 通知フィルタ追加 | `original.pdf` の suffix 通知を**追加**配線（B4 で保留した分）。これで PDF アップロードが前処理を起動 |
| 27 | 依存追加 | `requirements.txt` に **pypdf・pdfplumber** を追加 |
| 28 | Textract IAM | **B5 では付与しない**。OCR 実装は B6 のため、`textract:*` 権限も B6 で追加（最小権限） |

---

## 9. 参照

- 設計の正：FIXER.Medical.AgentCore `docs/dev-diary/naito/documents/manual-implementation-plan.md`（全14章）
- レビュー用サマリ：同 `manual.md`
- 実装スタイル参考（変更しない）：FIXER.Medical.AgentCore `agents/infection-chatbot-toc`（Strands Agent + FastAPI + Docker、`deploy.py`、`.bedrock_agentcore.yaml`）
- GenU CDK 参考（変更しない）：`packages/cdk/lib/construct/{generic-agent-core,database,auth,api,rag}.ts`、`packages/cdk/lib/{agent-core-stack,create-stacks,stack-input}.ts`、`packages/cdk/lambda/getFileUploadSignedUrl.ts`、`packages/cdk/parameter.ts`（※当初参照していた `construct/admin-api.ts` は GenU に存在しないことを B2 で確認）
