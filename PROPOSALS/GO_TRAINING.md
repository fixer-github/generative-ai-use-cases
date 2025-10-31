# Go言語 Week 1 トレーニング資料

GenU ECS移行プロジェクト - Phase 0 Week 1学習教材

最終更新: 2025-10-31

---

## 📚 学習目標

Week 1終了時点で、チーム全員が以下のスキルを習得していることを目指します:

- ✅ Go言語の基本文法を理解し、簡単なプログラムが書ける
- ✅ Goroutineとchannelを使った並行処理が実装できる
- ✅ AWS SDK for Go v2でDynamoDB/S3操作ができる
- ✅ 簡単なHTTPサーバーが実装できる

---

## 📅 5日間学習プラン

### Day 1: Go言語基礎（文法・型システム）

**学習時間**: 6時間

#### 📖 必須教材

1. **A Tour of Go** (2-3時間)
   - URL: https://go.dev/tour/
   - 内容:
     - Basics: Packages, Variables, Functions, Flow control
     - More types: Pointers, Structs, Slices, Maps
   - 実習: 全演習問題を解く

2. **Go by Example: 基礎編** (2-3時間)
   - URL: https://gobyexample.com/
   - 対象セクション:
     - Hello World 〜 Arrays
     - Slices
     - Maps
     - Range
     - Functions
     - Closures
     - Recursion

#### 🎯 実践課題

```go
// 課題1: 構造体とメソッド
// User構造体を定義し、名前の検証メソッドを実装せよ
type User struct {
    ID    string
    Name  string
    Email string
}

func (u *User) Validate() error {
    // TODO: 名前が空でないこと、メールが有効な形式であることを検証
}

// 課題2: スライス操作
// 整数スライスから重複を削除する関数を実装せよ
func RemoveDuplicates(nums []int) []int {
    // TODO: 実装
}

// 課題3: Mapを使ったグループ化
// Userスライスをドメイン（メールの@以降）でグループ化せよ
func GroupByDomain(users []User) map[string][]User {
    // TODO: 実装
}
```

**提出方法**: GitHubにプッシュ、コードレビュー依頼

---

### Day 2: エラーハンドリング・ポインタ

**学習時間**: 6時間

#### 📖 必須教材

1. **Effective Go: Errors** (1時間)
   - URL: https://go.dev/doc/effective_go#errors
   - 内容:
     - error型の使い方
     - カスタムエラー型
     - errors.Is / errors.As

2. **Go by Example: Errors編** (1時間)
   - URL: https://gobyexample.com/errors
   - 対象セクション:
     - Errors
     - Error Wrapping
     - Panic
     - Defer

3. **Understanding Pointers** (2時間)
   - URL: https://go.dev/tour/moretypes/1
   - ポインタの基礎
   - 値レシーバー vs ポインタレシーバー

4. **Go Error Handling Best Practices** (2時間)
   - ブログ記事: https://go.dev/blog/error-handling-and-go
   - 記事: https://earthly.dev/blog/golang-errors/

#### 🎯 実践課題

```go
// 課題1: カスタムエラー型
// バリデーションエラーを表す型を定義せよ
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    // TODO: 実装
}

// 課題2: エラーラッピング
// ファイル読み込みエラーを適切にラップせよ
func ReadConfig(filename string) (*Config, error) {
    // TODO: os.ReadFileを使い、エラーをラップ
}

// 課題3: エラー判定
// 特定のエラー型を判定する関数を実装せよ
func IsNotFoundError(err error) bool {
    // TODO: errors.Asを使用
}
```

---

### Day 3: 並行処理（Goroutine・Channel）

**学習時間**: 7時間（最重要）

#### 📖 必須教材

1. **A Tour of Go: Concurrency** (2時間)
   - URL: https://go.dev/tour/concurrency/1
   - 内容:
     - Goroutines
     - Channels
     - Buffered Channels
     - Range and Close
     - Select

2. **Go by Example: Concurrency編** (2時間)
   - URL: https://gobyexample.com/
   - 対象セクション:
     - Goroutines
     - Channels
     - Channel Buffering
     - Channel Synchronization
     - Channel Directions
     - Select
     - Timeouts
     - Non-Blocking Channel Operations
     - Worker Pools

3. **Concurrency in Go: Best Practices** (2時間)
   - 動画: [Go Concurrency Patterns](https://www.youtube.com/watch?v=f6kdp27TYZs)
   - ブログ: https://go.dev/blog/pipelines

4. **Goroutineリーク防止** (1時間)
   - 記事: https://www.ardanlabs.com/blog/2018/11/goroutine-leaks-the-forgotten-sender.html

#### 🎯 実践課題

```go
// 課題1: Worker Pool
// N個のworkerが並行してタスクを処理するパターンを実装せよ
func ProcessTasks(tasks []Task, numWorkers int) []Result {
    // TODO: workerプールパターン実装
}

// 課題2: Fan-Out, Fan-In
// 複数のgoroutineで処理し、結果を1つのchannelに集約せよ
func FanOutFanIn(input []int, numWorkers int) <-chan int {
    // TODO: 実装
}

// 課題3: コンテキストキャンセル
// context.Contextを使ったタイムアウト処理を実装せよ
func FetchWithTimeout(ctx context.Context, url string) (string, error) {
    // TODO: HTTPリクエストをタイムアウト付きで実行
}

// 課題4: selectステートメント
// 複数のchannelから値を受信し、最初に受信した値を返す
func SelectFirst(ch1, ch2, ch3 <-chan string) string {
    // TODO: selectで実装
}
```

**警告**: Goroutineリークに注意！課題3で`defer cancel()`を忘れないこと。

---

### Day 4: AWS SDK for Go v2

**学習時間**: 6時間

#### 📖 必須教材

1. **AWS SDK for Go v2 Developer Guide** (2時間)
   - URL: https://aws.github.io/aws-sdk-go-v2/docs/
   - 内容:
     - Getting Started
     - Configuring the SDK
     - Making API requests
     - Error Handling

2. **DynamoDB Examples** (2時間)
   - URL: https://github.com/awsdocs/aws-doc-sdk-examples/tree/main/go/dynamodb
   - サンプルコード:
     - PutItem
     - GetItem
     - Query
     - Scan
     - BatchWriteItem

3. **S3 Examples** (1時間)
   - URL: https://github.com/awsdocs/aws-doc-sdk-examples/tree/main/go/s3
   - サンプルコード:
     - PutObject
     - GetObject
     - PresignGetObject

4. **Bedrock Runtime Examples** (1時間)
   - URL: https://github.com/awsdocs/aws-doc-sdk-examples/tree/main/go/bedrock-runtime
   - サンプルコード:
     - Converse
     - ConverseStream

#### 🎯 実践課題

```go
// 課題1: DynamoDB CRUD操作
// Chat構造体をDynamoDBに保存・取得する関数を実装せよ
type Chat struct {
    ID        string
    UserID    string
    Title     string
    CreatedAt time.Time
}

func PutChat(ctx context.Context, client *dynamodb.Client, chat *Chat) error {
    // TODO: PutItemを使用
}

func GetChat(ctx context.Context, client *dynamodb.Client, chatID string) (*Chat, error) {
    // TODO: GetItemを使用
}

// 課題2: S3プレサインURL生成
// ファイルアップロード用のプレサインURLを生成せよ
func GenerateUploadURL(ctx context.Context, client *s3.Client, bucket, key string) (string, error) {
    // TODO: PresignClient.PresignPutObjectを使用
}

// 課題3: Bedrockストリーミング
// Bedrock ConverseStreamを使ってストリーミングレスポンスを処理せよ
func StreamBedrockResponse(ctx context.Context, client *bedrockruntime.Client, prompt string) error {
    // TODO: ConverseStreamを使用、チャンクをログ出力
}
```

**環境準備**:
```bash
# AWS認証情報設定
export AWS_REGION=us-east-1
export AWS_PROFILE=your-profile

# Go依存関係インストール
go get github.com/aws/aws-sdk-go-v2/config
go get github.com/aws/aws-sdk-go-v2/service/dynamodb
go get github.com/aws/aws-sdk-go-v2/service/s3
go get github.com/aws/aws-sdk-go-v2/service/bedrockruntime
```

---

### Day 5: HTTPサーバー・統合課題

**学習時間**: 7時間

#### 📖 必須教材

1. **net/http パッケージ** (2時間)
   - URL: https://pkg.go.dev/net/http
   - 内容:
     - http.HandleFunc
     - http.Server
     - http.Request / http.Response
     - Middleware pattern

2. **Gin Framework Quickstart** (2時間)
   - URL: https://gin-gonic.com/docs/quickstart/
   - 内容:
     - Basic routing
     - Parameters in path
     - Query parameters
     - JSON binding
     - Middleware

3. **Context Package** (1時間)
   - URL: https://pkg.go.dev/context
   - 内容:
     - context.Background
     - context.WithValue
     - context.WithTimeout
     - context.WithCancel

4. **Testing in Go** (2時間)
   - URL: https://go.dev/doc/tutorial/add-a-test
   - 内容:
     - Table-driven tests
     - httptest package
     - Mocking

#### 🎯 統合課題（Week 1最終課題）

```go
// 課題: シンプルなChat APIサーバーを実装せよ
//
// 要件:
// 1. Ginフレームワークを使用
// 2. 以下のエンドポイントを実装:
//    - POST /chats          - チャット作成（DynamoDBに保存）
//    - GET  /chats          - チャット一覧取得
//    - GET  /chats/:id      - チャット詳細取得
// 3. JWT認証ミドルウェア（簡易版でOK）
// 4. エラーハンドリング
// 5. ユニットテスト（各エンドポイント）

// main.go
package main

import (
    "github.com/gin-gonic/gin"
)

func main() {
    router := gin.Default()

    // TODO: ミドルウェア登録
    // TODO: ルート登録

    router.Run(":8080")
}

// handler/chat.go
package handler

type ChatHandler struct {
    // TODO: DynamoDBクライアントを持つ
}

func (h *ChatHandler) CreateChat(c *gin.Context) {
    // TODO: 実装
}

func (h *ChatHandler) ListChats(c *gin.Context) {
    // TODO: 実装
}

func (h *ChatHandler) GetChat(c *gin.Context) {
    // TODO: 実装
}

// middleware/auth.go
package middleware

func JWTAuth() gin.HandlerFunc {
    return func(c *gin.Context) {
        // TODO: 簡易JWT検証（ハードコードトークンでOK）
    }
}

// handler/chat_test.go
package handler_test

func TestCreateChat(t *testing.T) {
    // TODO: httptest.NewRecorderを使ったテスト
}
```

**提出方法**:
- GitHubリポジトリにプッシュ
- `README.md`に実装説明・起動方法を記載
- チームレビュー会で発表（5分）

**評価基準**:
- ✅ すべてのエンドポイントが正常動作
- ✅ DynamoDBへの保存・取得が成功
- ✅ ユニットテストがパス
- ✅ エラーハンドリングが適切
- ✅ コードがGoの慣用句に従っている

---

## 📝 補足教材（オプション）

### Go言語スタイルガイド

- [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md)
  - 実践的なコーディング規約
  - エラーハンドリングパターン
  - パフォーマンス最適化

- [Google Go Style Guide](https://google.github.io/styleguide/go/)
  - Googleのベストプラクティス

### パフォーマンス最適化

- [Go Performance Tips](https://github.com/dgryski/go-perfbook)
  - メモリアロケーション削減
  - 文字列操作最適化
  - プロファイリング

### デバッグ・トラブルシューティング

- [Delve Debugger](https://github.com/go-delve/delve)
  - ブレークポイント設定
  - 変数インスペクション

- [pprof](https://pkg.go.dev/net/http/pprof)
  - CPU/メモリプロファイリング
  - Goroutine可視化

---

## ✅ Week 1完了チェックリスト

各メンバーは以下をクリアしてください:

### 基礎文法
- [ ] A Tour of Go完了
- [ ] Go by Example基礎編完了
- [ ] Day 1課題3つ提出・レビュー完了

### エラーハンドリング
- [ ] Effective Go Errors読了
- [ ] Day 2課題3つ提出・レビュー完了

### 並行処理
- [ ] A Tour of Go Concurrency完了
- [ ] Go by Example Concurrency編完了
- [ ] Day 3課題4つ提出・レビュー完了
- [ ] Goroutineリーク記事読了

### AWS SDK
- [ ] AWS SDK for Go v2 Developer Guide読了
- [ ] DynamoDB/S3/Bedrock Examples実行
- [ ] Day 4課題3つ提出・レビュー完了

### HTTPサーバー
- [ ] Gin Quickstart完了
- [ ] Day 5統合課題提出・発表完了
- [ ] ユニットテスト全パス

---

## 🎓 チームレビュー会（Day 5終了時）

**日時**: Week 1金曜 16:00-18:00

**形式**: 各メンバー5分発表

**内容**:
1. 統合課題のデモ（2分）
2. 学習で難しかった点（1分）
3. Week 2への質問（2分）

**評価**:
- 全メンバーがチェックリスト80%以上クリア → Week 2進行
- 50-80%のメンバーがいる → 補講実施
- 50%未満のメンバーがいる → 個別サポート

---

## 🆘 質問・サポート

**Slackチャンネル**: `#genu-go-training`

**質問推奨時間**: 平日 10:00-18:00

**メンター**:
- Go言語: @tech-lead
- AWS SDK: @devops-lead
- 並行処理: @senior-engineer

**よくある質問**:

Q. Goroutineがいつ終了するかわからない
A. `sync.WaitGroup`を使うか、channelで終了を待ちましょう

Q. ポインタと値、どちらを使うべき？
A. 大きな構造体はポインタ、小さな値型は値で渡すのが一般的

Q. エラーをいつラップすべき？
A. 文脈情報を追加したいとき。`fmt.Errorf("failed to %s: %w", op, err)`

---

**ドキュメントバージョン**: 1.0
**最終更新**: 2025-10-31
**次回更新**: Week 2開始時
