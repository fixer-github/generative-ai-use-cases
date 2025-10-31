# GenU Go API アーキテクチャ設計書

ECS移行プロジェクト - Go言語版アーキテクチャ

最終更新: 2025-10-31

---

## 📐 アーキテクチャ概要

### システム構成図

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│              Application Load Balancer (ALB)                  │
│  - HTTPS Termination                                          │
│  - Path-based routing                                         │
└───────────────────────────┬──────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌───────▼────────┐  ┌──────▼──────┐
│  ECS Task 1    │  │  ECS Task 2    │  │  ECS Task N │
│  (Go API)      │  │  (Go API)      │  │  (Go API)   │
│  - 1 vCPU      │  │  - 1 vCPU      │  │  - 1 vCPU   │
│  - 2GB RAM     │  │  - 2GB RAM     │  │  - 2GB RAM  │
└───────┬────────┘  └───────┬────────┘  └──────┬──────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌───────▼────────┐  ┌──────▼──────────┐
│   DynamoDB     │  │      S3        │  │  Bedrock        │
│ (Per-Tenant)   │  │ (Per-Tenant)   │  │  Runtime        │
└────────────────┘  └────────────────┘  └─────────────────┘
```

---

## 🏛️ レイヤードアーキテクチャ

Go APIは **Clean Architectureを参考にしたレイヤード構成** を採用します。

### レイヤー構成

```
┌────────────────────────────────────────┐
│         Presentation Layer             │
│  (Handler / Middleware)                │
│  - HTTP request/response handling      │
│  - JWT authentication                  │
│  - Tenant context extraction           │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│         Application Layer              │
│  (Service / Use Cases)                 │
│  - Business logic                      │
│  - Orchestration                       │
│  - Transaction management              │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│         Domain Layer                   │
│  (Model / Entity)                      │
│  - Domain models                       │
│  - Business rules                      │
│  - Validation                          │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│         Infrastructure Layer           │
│  (Repository / AWS Client)             │
│  - Data access                         │
│  - External service integration        │
│  - AWS SDK wrappers                    │
└────────────────────────────────────────┘
```

---

## 📁 プロジェクト構造

### ディレクトリレイアウト

```
packages/api-go/
├── cmd/
│   ├── server/
│   │   └── main.go                 # エントリポイント（Ginサーバー起動）
│   └── worker/
│       └── main.go                 # SQSワーカー（PPTX生成等）
│
├── internal/                       # プライベートパッケージ（外部公開不可）
│   ├── handler/                    # Presentation Layer
│   │   ├── chat.go                 # Chat APIハンドラー
│   │   ├── predict.go              # Predict APIハンドラー
│   │   ├── file.go                 # File APIハンドラー
│   │   ├── image.go                # Image APIハンドラー
│   │   ├── video.go                # Video APIハンドラー
│   │   ├── admin.go                # Admin APIハンドラー
│   │   └── share.go                # Share APIハンドラー
│   │
│   ├── middleware/                 # ミドルウェア
│   │   ├── auth.go                 # JWT認証
│   │   ├── tenant.go               # テナントコンテキスト抽出
│   │   ├── logger.go               # リクエストロギング
│   │   ├── cors.go                 # CORS設定
│   │   ├── recovery.go             # パニックリカバリ
│   │   └── xray.go                 # X-Rayトレーシング
│   │
│   ├── service/                    # Application Layer
│   │   ├── chat.go                 # チャットビジネスロジック
│   │   ├── message.go              # メッセージビジネスロジック
│   │   ├── bedrock.go              # Bedrock統合
│   │   ├── langchain.go            # LangChain統合（最小限）
│   │   ├── pptx.go                 # PPTX生成ロジック
│   │   └── video.go                # 動画生成ロジック
│   │
│   ├── repository/                 # Infrastructure Layer - Data Access
│   │   ├── chat.go                 # Chatリポジトリ
│   │   ├── message.go              # Messageリポジトリ
│   │   ├── share.go                # Shareリポジトリ
│   │   ├── systemcontext.go        # SystemContextリポジトリ
│   │   ├── stats.go                # Statsリポジトリ
│   │   └── dynamodb.go             # DynamoDB共通処理
│   │
│   ├── model/                      # Domain Layer
│   │   ├── chat.go                 # Chat構造体・バリデーション
│   │   ├── message.go              # Message構造体・バリデーション
│   │   ├── user.go                 # User構造体
│   │   ├── share.go                # Share構造体
│   │   └── types.go                # 共通型定義
│   │
│   ├── config/                     # 設定管理
│   │   └── config.go               # 環境変数・設定読み込み
│   │
│   └── router/                     # ルーティング定義
│       └── router.go               # Ginルーター設定
│
├── pkg/                            # パブリックパッケージ（外部公開可）
│   ├── awsclient/                  # AWS SDK ラッパー
│   │   ├── dynamodb.go             # DynamoDBクライアント
│   │   ├── s3.go                   # S3クライアント
│   │   ├── bedrock.go              # Bedrockクライアント
│   │   ├── sts.go                  # STSクライアント
│   │   └── credentials.go          # 認証情報キャッシュ
│   │
│   ├── logger/                     # 構造化ロガー
│   │   └── logger.go               # uber/zap ラッパー
│   │
│   └── errors/                     # カスタムエラー型
│       └── errors.go               # アプリケーションエラー定義
│
├── tests/
│   ├── integration/                # 統合テスト
│   │   ├── chat_test.go
│   │   └── predict_test.go
│   ├── load/                       # 負荷テスト
│   │   └── artillery.yml
│   └── testdata/                   # テストデータ
│
├── deployments/
│   ├── Dockerfile                  # 本番用Dockerfile
│   ├── Dockerfile.dev              # 開発用Dockerfile
│   └── docker-compose.yml          # ローカル開発環境
│
├── scripts/
│   ├── build.sh                    # ビルドスクリプト
│   └── migrate.sh                  # マイグレーションスクリプト
│
├── go.mod                          # Go module定義
├── go.sum                          # 依存関係ロックファイル
├── .air.toml                       # ホットリロード設定
└── README.md
```

---

## 🧩 パッケージ責務詳細

### 1. Presentation Layer (`internal/handler`, `internal/middleware`)

**責務**: HTTPリクエスト/レスポンス処理、認証・認可

#### handler/chat.go

```go
package handler

import (
    "github.com/gin-gonic/gin"
    "github.com/fixer-github/generative-ai-use-cases/packages/api-go/internal/service"
)

type ChatHandler struct {
    chatService *service.ChatService
}

func NewChatHandler(chatService *service.ChatService) *ChatHandler {
    return &ChatHandler{chatService: chatService}
}

// ListChats - チャット一覧取得
// GET /chats
func (h *ChatHandler) ListChats(c *gin.Context) {
    ctx := c.Request.Context()

    // コンテキストからユーザー情報取得
    userID := ctx.Value("userID").(string)
    tenantID := ctx.Value("tenantID").(string)

    // ページネーションパラメータ
    exclusiveStartKey := c.Query("exclusiveStartKey")

    // サービス層呼び出し
    chats, nextKey, err := h.chatService.ListChats(ctx, userID, tenantID, exclusiveStartKey)
    if err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }

    c.JSON(200, gin.H{
        "chats": chats,
        "lastEvaluatedKey": nextKey,
    })
}

// CreateChat - チャット作成
// POST /chats
func (h *ChatHandler) CreateChat(c *gin.Context) {
    // ... 実装
}

// GetChat - チャット詳細取得
// GET /chats/:id
func (h *ChatHandler) GetChat(c *gin.Context) {
    // ... 実装
}

// DeleteChat - チャット削除
// DELETE /chats/:id
func (h *ChatHandler) DeleteChat(c *gin.Context) {
    // ... 実装
}
```

#### middleware/auth.go

```go
package middleware

import (
    "context"
    "strings"

    "github.com/gin-gonic/gin"
    "github.com/golang-jwt/jwt/v5"
)

// JWTAuth - JWT認証ミドルウェア
func JWTAuth(userPoolID, clientID string) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Authorizationヘッダーからトークン抽出
        authHeader := c.GetHeader("Authorization")
        if authHeader == "" {
            c.AbortWithStatusJSON(401, gin.H{"error": "Missing authorization header"})
            return
        }

        tokenString := strings.TrimPrefix(authHeader, "Bearer ")

        // JWT検証（Cognito公開鍵で検証）
        token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
            // TODO: CognitoのJWKSから公開鍵取得
            return getPublicKey(userPoolID, token)
        })

        if err != nil || !token.Valid {
            c.AbortWithStatusJSON(401, gin.H{"error": "Invalid token"})
            return
        }

        // クレーム取得
        claims, ok := token.Claims.(jwt.MapClaims)
        if !ok {
            c.AbortWithStatusJSON(401, gin.H{"error": "Invalid claims"})
            return
        }

        // コンテキストに保存
        c.Set("claims", claims)
        c.Next()
    }
}
```

#### middleware/tenant.go

```go
package middleware

import (
    "context"

    "github.com/gin-gonic/gin"
    "github.com/golang-jwt/jwt/v5"
)

// TenantContext - テナントコンテキスト抽出ミドルウェア
func TenantContext() gin.HandlerFunc {
    return func(c *gin.Context) {
        claims, exists := c.Get("claims")
        if !exists {
            c.AbortWithStatusJSON(401, gin.H{"error": "Unauthorized"})
            return
        }

        jwtClaims := claims.(jwt.MapClaims)

        // テナントID・ユーザーID抽出
        tenantID := extractString(jwtClaims, "custom:tenant_id", "default")
        userID := extractString(jwtClaims, "cognito:username", "")

        if userID == "" {
            c.AbortWithStatusJSON(401, gin.H{"error": "Missing user ID"})
            return
        }

        // context.Contextに保存
        ctx := c.Request.Context()
        ctx = context.WithValue(ctx, "tenantID", tenantID)
        ctx = context.WithValue(ctx, "userID", userID)
        c.Request = c.Request.WithContext(ctx)

        c.Next()
    }
}

func extractString(claims jwt.MapClaims, key, defaultValue string) string {
    if val, ok := claims[key].(string); ok {
        return val
    }
    return defaultValue
}
```

---

### 2. Application Layer (`internal/service`)

**責務**: ビジネスロジック、ユースケース実装、トランザクション管理

#### service/chat.go

```go
package service

import (
    "context"
    "time"

    "github.com/google/uuid"
    "github.com/fixer-github/generative-ai-use-cases/packages/api-go/internal/model"
    "github.com/fixer-github/generative-ai-use-cases/packages/api-go/internal/repository"
)

type ChatService struct {
    chatRepo    *repository.ChatRepository
    messageRepo *repository.MessageRepository
}

func NewChatService(chatRepo *repository.ChatRepository, messageRepo *repository.MessageRepository) *ChatService {
    return &ChatService{
        chatRepo:    chatRepo,
        messageRepo: messageRepo,
    }
}

// ListChats - チャット一覧取得（ビジネスロジック）
func (s *ChatService) ListChats(ctx context.Context, userID, tenantID, exclusiveStartKey string) ([]model.Chat, string, error) {
    // リポジトリ層呼び出し
    return s.chatRepo.ListByUser(ctx, userID, tenantID, exclusiveStartKey)
}

// CreateChat - チャット作成（バリデーション含む）
func (s *ChatService) CreateChat(ctx context.Context, userID, tenantID, title string) (*model.Chat, error) {
    // ドメインモデル作成
    chat := &model.Chat{
        ID:        uuid.New().String(),
        UserID:    userID,
        Title:     title,
        CreatedAt: time.Now(),
        UpdatedAt: time.Now(),
    }

    // バリデーション
    if err := chat.Validate(); err != nil {
        return nil, err
    }

    // リポジトリ保存
    if err := s.chatRepo.Create(ctx, tenantID, chat); err != nil {
        return nil, err
    }

    return chat, nil
}
```

#### service/bedrock.go

```go
package service

import (
    "context"

    "github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
    "github.com/fixer-github/generative-ai-use-cases/packages/api-go/pkg/awsclient"
)

type BedrockService struct {
    client *awsclient.BedrockClient
}

func NewBedrockService(client *awsclient.BedrockClient) *BedrockService {
    return &BedrockService{client: client}
}

// InvokeStream - Bedrock ConverseStream呼び出し
func (s *BedrockService) InvokeStream(ctx context.Context, modelID string, messages []Message) (<-chan string, error) {
    output := make(chan string, 100)

    go func() {
        defer close(output)

        stream, err := s.client.ConverseStream(ctx, &bedrockruntime.ConverseStreamInput{
            ModelId:  &modelID,
            Messages: convertMessages(messages),
        })

        if err != nil {
            return
        }

        // ストリームイベント処理
        for event := range stream.GetStream().Events() {
            switch e := event.(type) {
            case *types.ConverseStreamOutputMemberContentBlockDelta:
                if e.Value.Delta != nil {
                    output <- *e.Value.Delta.Text
                }
            }
        }
    }()

    return output, nil
}
```

---

### 3. Domain Layer (`internal/model`)

**責務**: ドメインモデル、ビジネスルール、バリデーション

#### model/chat.go

```go
package model

import (
    "errors"
    "time"
)

// Chat - チャットドメインモデル
type Chat struct {
    ID        string    `json:"id" dynamodbav:"PK"`
    UserID    string    `json:"userId" dynamodbav:"userId"`
    Title     string    `json:"title" dynamodbav:"title"`
    CreatedAt time.Time `json:"createdAt" dynamodbav:"createdAt"`
    UpdatedAt time.Time `json:"updatedAt" dynamodbav:"updatedAt"`
}

// Validate - ビジネスルール検証
func (c *Chat) Validate() error {
    if c.ID == "" {
        return errors.New("chat ID is required")
    }

    if c.UserID == "" {
        return errors.New("user ID is required")
    }

    if len(c.Title) > 200 {
        return errors.New("title must be 200 characters or less")
    }

    return nil
}

// UpdateTitle - タイトル更新（ビジネスロジック）
func (c *Chat) UpdateTitle(newTitle string) error {
    if len(newTitle) > 200 {
        return errors.New("title must be 200 characters or less")
    }

    c.Title = newTitle
    c.UpdatedAt = time.Now()
    return nil
}
```

#### model/message.go

```go
package model

import (
    "errors"
    "time"
)

// Message - メッセージドメインモデル
type Message struct {
    ID        string    `json:"id" dynamodbav:"SK"`
    ChatID    string    `json:"chatId" dynamodbav:"PK"`
    UserID    string    `json:"userId" dynamodbav:"userId"`
    Role      string    `json:"role" dynamodbav:"role"`        // "user" or "assistant"
    Content   Content   `json:"content" dynamodbav:"content"`
    CreatedAt time.Time `json:"createdAt" dynamodbav:"createdAt"`
    TokenUsage *TokenUsage `json:"tokenUsage,omitempty" dynamodbav:"tokenUsage,omitempty"`
}

type Content struct {
    ContentType string `json:"contentType" dynamodbav:"contentType"`  // "text", "image"
    Body        string `json:"body" dynamodbav:"body"`
}

type TokenUsage struct {
    InputTokens  int `json:"inputTokens" dynamodbav:"inputTokens"`
    OutputTokens int `json:"outputTokens" dynamodbav:"outputTokens"`
}

// Validate - メッセージバリデーション
func (m *Message) Validate() error {
    if m.Role != "user" && m.Role != "assistant" {
        return errors.New("role must be 'user' or 'assistant'")
    }

    if m.Content.Body == "" {
        return errors.New("message content is required")
    }

    return nil
}
```

---

### 4. Infrastructure Layer (`internal/repository`, `pkg/awsclient`)

**責務**: データアクセス、外部サービス統合、AWS SDK操作

#### repository/chat.go

```go
package repository

import (
    "context"
    "fmt"

    "github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
    "github.com/aws/aws-sdk-go/aws"

    "github.com/fixer-github/generative-ai-use-cases/packages/api-go/internal/model"
    "github.com/fixer-github/generative-ai-use-cases/packages/api-go/pkg/awsclient"
)

type ChatRepository struct {
    tableName string
}

func NewChatRepository(tableName string) *ChatRepository {
    return &ChatRepository{tableName: tableName}
}

// Create - チャット作成
func (r *ChatRepository) Create(ctx context.Context, tenantID string, chat *model.Chat) error {
    // テナント専用DynamoDBクライアント取得
    client, err := awsclient.GetTenantDynamoDBClient(ctx, tenantID)
    if err != nil {
        return fmt.Errorf("failed to get tenant DynamoDB client: %w", err)
    }

    // 構造体→DynamoDB Item変換
    item, err := attributevalue.MarshalMap(chat)
    if err != nil {
        return fmt.Errorf("failed to marshal chat: %w", err)
    }

    // PutItem
    _, err = client.PutItem(ctx, &dynamodb.PutItemInput{
        TableName: aws.String(fmt.Sprintf("%s-%s", r.tableName, tenantID)),
        Item:      item,
    })

    if err != nil {
        return fmt.Errorf("failed to put chat: %w", err)
    }

    return nil
}

// ListByUser - ユーザーのチャット一覧取得
func (r *ChatRepository) ListByUser(ctx context.Context, userID, tenantID, exclusiveStartKey string) ([]model.Chat, string, error) {
    client, err := awsclient.GetTenantDynamoDBClient(ctx, tenantID)
    if err != nil {
        return nil, "", err
    }

    // Query実行
    input := &dynamodb.QueryInput{
        TableName:              aws.String(fmt.Sprintf("%s-%s", r.tableName, tenantID)),
        IndexName:              aws.String("UserIdIndex"),
        KeyConditionExpression: aws.String("userId = :userId"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":userId": &types.AttributeValueMemberS{Value: userID},
        },
        Limit: aws.Int32(50),
    }

    if exclusiveStartKey != "" {
        input.ExclusiveStartKey = map[string]types.AttributeValue{
            "PK": &types.AttributeValueMemberS{Value: exclusiveStartKey},
        }
    }

    output, err := client.Query(ctx, input)
    if err != nil {
        return nil, "", err
    }

    // DynamoDB Item→構造体変換
    var chats []model.Chat
    if err := attributevalue.UnmarshalListOfMaps(output.Items, &chats); err != nil {
        return nil, "", err
    }

    // 次ページキー
    var nextKey string
    if output.LastEvaluatedKey != nil {
        if pk, ok := output.LastEvaluatedKey["PK"].(*types.AttributeValueMemberS); ok {
            nextKey = pk.Value
        }
    }

    return chats, nextKey, nil
}
```

#### pkg/awsclient/dynamodb.go

```go
package awsclient

import (
    "context"
    "fmt"
    "sync"

    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/credentials"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

var (
    clientCache sync.Map  // テナント別DynamoDBクライアントキャッシュ
)

// GetTenantDynamoDBClient - テナント専用DynamoDBクライアント取得
func GetTenantDynamoDBClient(ctx context.Context, tenantID string) (*dynamodb.Client, error) {
    // キャッシュ確認
    if cached, ok := clientCache.Load(tenantID); ok {
        return cached.(*dynamodb.Client), nil
    }

    // STS AssumeRoleで認証情報取得
    creds, err := AssumeRoleForTenant(ctx, tenantID)
    if err != nil {
        return nil, fmt.Errorf("failed to assume role for tenant %s: %w", tenantID, err)
    }

    // DynamoDBクライアント作成
    cfg, err := config.LoadDefaultConfig(ctx,
        config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
            creds.AccessKeyId,
            creds.SecretAccessKey,
            creds.SessionToken,
        )),
    )
    if err != nil {
        return nil, err
    }

    client := dynamodb.NewFromConfig(cfg)

    // キャッシュ保存（15分後に削除するタイマーを設定）
    clientCache.Store(tenantID, client)

    return client, nil
}
```

---

## 🔐 マルチテナント分離アーキテクチャ

### テナントコンテキスト伝播パターン

```go
// リクエストフロー
HTTP Request
    ↓
Middleware: JWTAuth()
    ├─ JWTトークン検証
    └─ c.Set("claims", jwtClaims)
    ↓
Middleware: TenantContext()
    ├─ custom:tenant_id 抽出
    ├─ cognito:username 抽出
    └─ ctx = context.WithValue(ctx, "tenantID", tenantID)
    ↓
Handler
    ├─ ctx.Value("tenantID")
    └─ Service層呼び出し
    ↓
Service
    ├─ ビジネスロジック
    └─ Repository層呼び出し（tenantID渡す）
    ↓
Repository
    ├─ awsclient.GetTenantDynamoDBClient(ctx, tenantID)
    └─ テナント専用DynamoDBクライアントでCRUD
```

### 認証情報キャッシング戦略

```go
// pkg/awsclient/credentials.go
package awsclient

import (
    "sync"
    "time"
)

type CachedCredentials struct {
    AccessKeyId     string
    SecretAccessKey string
    SessionToken    string
    ExpiresAt       time.Time
}

var (
    credentialsCache = sync.Map{}  // map[string]*CachedCredentials
)

func GetCachedCredentials(tenantID, userID string) (*CachedCredentials, bool) {
    key := fmt.Sprintf("%s:%s", tenantID, userID)

    if cached, ok := credentialsCache.Load(key); ok {
        creds := cached.(*CachedCredentials)

        // 有効期限チェック
        if time.Now().Before(creds.ExpiresAt) {
            return creds, true
        }

        // 期限切れなら削除
        credentialsCache.Delete(key)
    }

    return nil, false
}

func SetCachedCredentials(tenantID, userID string, creds *CachedCredentials) {
    key := fmt.Sprintf("%s:%s", tenantID, userID)
    credentialsCache.Store(key, creds)

    // 15分後に自動削除
    time.AfterFunc(15*time.Minute, func() {
        credentialsCache.Delete(key)
    })
}
```

---

## 🌊 ストリーミングアーキテクチャ

### Bedrock ConverseStream統合パターン

```go
// internal/handler/predict.go
func (h *PredictHandler) PredictStream(c *gin.Context) {
    ctx := c.Request.Context()

    // リクエストボディ解析
    var req PredictRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }

    // Server-Sent Events設定
    c.Header("Content-Type", "text/event-stream")
    c.Header("Cache-Control", "no-cache")
    c.Header("Connection", "keep-alive")

    // Bedrockストリーミング開始
    stream, err := h.bedrockService.InvokeStream(ctx, req.ModelID, req.Messages)
    if err != nil {
        c.SSEvent("error", err.Error())
        return
    }

    // チャンクを順次送信
    for chunk := range stream {
        c.SSEvent("message", chunk)
        c.Writer.Flush()
    }

    c.SSEvent("done", "")
}
```

---

## 📊 依存性注入パターン

### コンストラクタインジェクション

```go
// cmd/server/main.go
package main

import (
    "github.com/gin-gonic/gin"
    "github.com/fixer-github/generative-ai-use-cases/packages/api-go/internal/handler"
    "github.com/fixer-github/generative-ai-use-cases/packages/api-go/internal/service"
    "github.com/fixer-github/generative-ai-use-cases/packages/api-go/internal/repository"
)

func main() {
    // 依存関係構築（手動DI）
    chatRepo := repository.NewChatRepository("Chats")
    messageRepo := repository.NewMessageRepository("Messages")

    chatService := service.NewChatService(chatRepo, messageRepo)
    bedrockService := service.NewBedrockService(bedrockClient)

    chatHandler := handler.NewChatHandler(chatService)
    predictHandler := handler.NewPredictHandler(bedrockService)

    // ルーター設定
    router := gin.Default()
    router.GET("/chats", chatHandler.ListChats)
    router.POST("/chats", chatHandler.CreateChat)
    router.POST("/predict/stream", predictHandler.PredictStream)

    router.Run(":3000")
}
```

**注**: 将来的にDIコンテナ（wire、uber/fx等）導入を検討

---

## 🧪 テスタビリティ

### インターフェース定義によるモック化

```go
// internal/repository/interface.go
type ChatRepositoryInterface interface {
    Create(ctx context.Context, tenantID string, chat *model.Chat) error
    ListByUser(ctx context.Context, userID, tenantID, exclusiveStartKey string) ([]model.Chat, string, error)
}

// internal/service/chat.go
type ChatService struct {
    chatRepo ChatRepositoryInterface  // インターフェースに依存
}

// tests/unit/service/chat_test.go
type MockChatRepository struct {
    mock.Mock
}

func (m *MockChatRepository) Create(ctx context.Context, tenantID string, chat *model.Chat) error {
    args := m.Called(ctx, tenantID, chat)
    return args.Error(0)
}

func TestChatService_CreateChat(t *testing.T) {
    mockRepo := new(MockChatRepository)
    mockRepo.On("Create", mock.Anything, "tenant1", mock.Anything).Return(nil)

    service := service.NewChatService(mockRepo, nil)

    chat, err := service.CreateChat(context.Background(), "user1", "tenant1", "Test Chat")

    assert.NoError(t, err)
    assert.Equal(t, "Test Chat", chat.Title)
    mockRepo.AssertExpectations(t)
}
```

---

## 📈 パフォーマンス最適化戦略

### 1. コネクションプーリング

```go
// pkg/awsclient/dynamodb.go
func NewDynamoDBClient() *dynamodb.Client {
    cfg, _ := config.LoadDefaultConfig(context.Background(),
        config.WithHTTPClient(&http.Client{
            Transport: &http.Transport{
                MaxIdleConns:        100,
                MaxIdleConnsPerHost: 50,
                IdleConnTimeout:     90 * time.Second,
            },
        }),
    )

    return dynamodb.NewFromConfig(cfg)
}
```

### 2. Goroutineプール

```go
// internal/service/message.go
func (s *MessageService) BatchCreateMessages(ctx context.Context, messages []model.Message) error {
    sem := make(chan struct{}, 10)  // 同時実行数10に制限
    errCh := make(chan error, len(messages))

    for _, msg := range messages {
        sem <- struct{}{}

        go func(m model.Message) {
            defer func() { <-sem }()

            if err := s.messageRepo.Create(ctx, m); err != nil {
                errCh <- err
            }
        }(msg)
    }

    // 全Goroutine完了待機
    for i := 0; i < cap(sem); i++ {
        sem <- struct{}{}
    }

    close(errCh)

    // エラーチェック
    for err := range errCh {
        if err != nil {
            return err
        }
    }

    return nil
}
```

### 3. メモリアロケーション削減

```go
// 悪い例
func BadExample(items []string) []string {
    result := []string{}  // 容量0で初期化、追加のたびに再アロケーション
    for _, item := range items {
        result = append(result, item)
    }
    return result
}

// 良い例
func GoodExample(items []string) []string {
    result := make([]string, 0, len(items))  // 事前に容量確保
    for _, item := range items {
        result = append(result, item)
    }
    return result
}
```

---

## 🔍 監視・ロギング戦略

### 構造化ロギング（uber/zap）

```go
// pkg/logger/logger.go
package logger

import (
    "go.uber.org/zap"
    "go.uber.org/zap/zapcore"
)

var Log *zap.Logger

func Init() {
    config := zap.NewProductionConfig()
    config.EncoderConfig.TimeKey = "timestamp"
    config.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder

    Log, _ = config.Build()
}

// 使用例
logger.Log.Info("chat created",
    zap.String("chatID", chat.ID),
    zap.String("userID", userID),
    zap.String("tenantID", tenantID),
)
```

### X-Ray分散トレーシング

```go
// middleware/xray.go
import (
    "github.com/aws/aws-xray-sdk-go/xray"
)

func XRayMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        ctx, seg := xray.BeginSegment(c.Request.Context(), "go-api")
        defer seg.Close(nil)

        c.Request = c.Request.WithContext(ctx)
        c.Next()
    }
}
```

---

## 🚀 デプロイメント設計

### Dockerfile（マルチステージビルド）

```dockerfile
# ========================================
# Stage 1: ビルド
# ========================================
FROM golang:1.22-alpine AS builder

WORKDIR /build

# 依存関係キャッシュ
COPY go.mod go.sum ./
RUN go mod download

# ソースコピー&ビルド
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o /app/server \
    ./cmd/server

# ========================================
# Stage 2: ランタイム
# ========================================
FROM scratch

COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/server /server

EXPOSE 3000

ENTRYPOINT ["/server"]
```

---

**ドキュメントバージョン**: 1.0
**最終更新**: 2025-10-31
**次回レビュー**: Week 6（POC完了時）
