import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { Stack, Duration, CfnResource } from 'aws-cdk-lib';
import { Architecture, Runtime, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { Database } from '../../temp-bedrock-chat/constructs/database';
import { WebSocket } from '../../temp-bedrock-chat/constructs/websocket';
import { Embedding } from '../../temp-bedrock-chat/constructs/embedding';
import { UsageAnalysis } from '../../temp-bedrock-chat/constructs/usage-analysis';
import { BotStore, Language } from '../../temp-bedrock-chat/constructs/bot-store';

/**
 * テナント専用のBedrock Chatスタックのプロパティ定義
 * 各テナントごとに独立したチャット機能のリソースを作成するための設定値
 */
export interface TenantBedrockChatStackProps extends cdk.StackProps {
  /**
   * テナント識別子
   * 各テナントを一意に識別するID（例：tenant-001, company-abc など）
   */
  readonly tenantId?: string;

  /**
   * 環境名（例：dev, staging, prod）
   * リソース名の一部として使用され、環境ごとの分離を実現
   */
  readonly environment: string;

  /**
   * Amazon Bedrockを使用するAWSリージョン
   * Bedrockサービスが利用可能なリージョンを指定（例：us-east-1, ap-northeast-1）
   */
  readonly bedrockRegion: string;

  /**
   * RAG（Retrieval-Augmented Generation）のレプリカを有効化するかどうか
   * RAGは文書検索と生成AIを組み合わせた機能で、レプリカにより可用性と性能が向上
   */
  readonly enableRagReplicas?: boolean;

  /**
   * Bedrockのクロスリージョン推論を有効化するかどうか
   * 複数リージョンでの推論により、レイテンシーの低減と可用性の向上を実現
   */
  readonly enableBedrockCrossRegionInference?: boolean;

  /**
   * Lambda SnapStartを有効化するかどうか
   * SnapStartはLambda関数の起動時間を短縮する機能（Java環境で特に効果的）
   */
  readonly enableLambdaSnapStart?: boolean;

  /**
   * ボットストア機能を有効化するかどうか
   * カスタムボットの定義と管理を行う機能
   */
  readonly enableBotStore?: boolean;

  /**
   * ボットストアのレプリカを有効化するかどうか
   * ボットストアの可用性と読み取り性能を向上
   */
  readonly enableBotStoreReplicas?: boolean;

  /**
   * ボットストアで使用する言語設定
   * 日本語（ja）、英語（en）など、対応言語を指定
   */
  readonly botStoreLanguage?: Language;

  /**
   * グローバルで利用可能なAIモデルのリスト
   * 使用可能なBedrock AIモデルのID一覧（例：claude-3-sonnet など）
   */
  readonly globalAvailableModels?: string[];

  /**
   * 環境プレフィックス
   * リソース名の先頭に付与される識別子（例：prod-、dev- など）
   */
  readonly envPrefix?: string;

  /**
   * リソースの削除ポリシー
   * RETAIN（保持）またはDESTROY（削除）を指定
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: cdk.RemovalPolicy;
}

/**
 * テナント専用のBedrock Chatスタック
 * 
 * このスタックは、各テナントごとに独立したチャット機能を提供するためのAWSリソースを作成します。
 * マルチテナントアーキテクチャにおいて、各テナントのデータとリソースを完全に分離し、
 * セキュアで独立したチャット環境を実現します。
 */
export class TenantBedrockChatStack extends cdk.Stack {
  /**
   * データベースコンストラクト
   * チャット履歴、ボット情報、WebSocketセッションなどを管理するDynamoDBテーブル群
   */
  public readonly database: Database;

  /**
   * WebSocketコンストラクト
   * リアルタイムのチャット通信を実現するWebSocket API
   */
  public readonly websocket: WebSocket;

  /**
   * Embeddingコンストラクト（オプション）
   * RAG機能のための文書ベクトル化と検索機能を提供
   */
  public readonly embedding?: Embedding;

  /**
   * 使用状況分析コンストラクト（オプション）
   * チャットの利用状況をAthenaで分析するための機能
   */
  public readonly usageAnalysis?: UsageAnalysis;

  /**
   * ボットストアコンストラクト（オプション）
   * カスタムボットの定義と管理、OpenSearchによる検索機能
   */
  public readonly botStore?: BotStore;

  /**
   * ドキュメントバケット
   * RAG機能で使用する文書ファイルを保存するS3バケット
   */
  public readonly documentBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: TenantBedrockChatStackProps) {
    super(scope, id, props);

    // テナントIDの取得または作成
    // propsで提供されない場合は、CloudFormationパラメータとして定義
    const tenantId = props?.tenantId || new cdk.CfnParameter(this, 'TenantId', {
      description: 'Bedrock Chatリソース用のテナント識別子',
      type: 'String',
      allowedPattern: '^[a-zA-Z0-9-]+$',
      constraintDescription: 'テナントIDは英数字とハイフンのみ使用可能です',
    }).valueAsString;

    // 必須パラメータの取得
    const environment = props.environment;  // 環境名（dev, staging, prod など）
    const bedrockRegion = props.bedrockRegion;  // Bedrockを使用するリージョン

    // ==============================================
    // 1. ドキュメントバケットの作成
    // ==============================================
    // RAG機能で使用する文書ファイル（PDF、テキストなど）を保存するS3バケット
    // テナントごとに完全に分離されたストレージを提供
    this.documentBucket = new s3.Bucket(this, 'DocumentBucket', {
      bucketName: `bedrock-chat-docs-${environment}-${tenantId}`,
      encryption: s3.BucketEncryption.S3_MANAGED,  // S3管理の暗号化を使用
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,  // パブリックアクセスを完全にブロック
      enforceSSL: true,  // HTTPS接続のみを許可
      removalPolicy: props.removalPolicy || cdk.RemovalPolicy.RETAIN,  // スタック削除時の動作
      autoDeleteObjects: props.removalPolicy === cdk.RemovalPolicy.DESTROY,  // DESTROYの場合、中身も削除
      cors: [  // CORS設定（ブラウザからの直接アップロードを許可）
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ["*"],  // 本番環境では特定のドメインに制限すべき
          allowedHeaders: ["*"],
          maxAge: 3000,
        },
      ],
    });

    // ==============================================
    // 2. データベースの作成
    // ==============================================
    // DynamoDBテーブル群を作成（会話履歴、ボット定義、セッション管理など）
    // Point-in-Time Recovery（PITR）を有効化して、データの復旧を可能に
    this.database = new Database(this, 'Database', {
      pointInTimeRecovery: true,  // 過去35日間の任意の時点へのリストアが可能
    });

    // ==============================================
    // 3. 大容量メッセージ用バケットの作成
    // ==============================================
    // WebSocketやAPIで扱えない大きなメッセージ（画像、長文など）を
    // 一時的に保存するためのS3バケット
    const largeMessageBucket = new s3.Bucket(this, 'LargeMessageBucket', {
      bucketName: `bedrock-chat-large-msg-${environment}-${tenantId}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: props.removalPolicy || cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: props.removalPolicy === cdk.RemovalPolicy.DESTROY,
    });

    // ==============================================
    // 4. API Lambda関数の作成
    // ==============================================
    // Bedrock ChatのAPI処理を行うLambda関数
    // メインスタックのプロキシから呼び出される
    const apiHandler = new PythonFunction(this, 'ApiHandler', {
      entry: path.join(__dirname, '../../temp-bedrock-chat/backend'),
      index: 'app/main.py',
      runtime: Runtime.PYTHON_3_12,
      architecture: Architecture.X86_64,
      memorySize: 1024,
      timeout: Duration.minutes(15),
      environment: {
        CONVERSATION_TABLE_NAME: this.database.conversationTable.tableName,
        BOT_TABLE_NAME: this.database.botTable.tableName,
        ENV_NAME: props.environment,
        ENV_PREFIX: props.envPrefix || '',
        // CORS設定はメインスタックのものを使用
        CORS_ALLOW_ORIGINS: '*',
        // TODO: 認証情報はメインスタックから渡される必要がある
        // プロキシ経由でユーザプールIDとクライアントIDを受け取る仕組みが必要
        USER_POOL_ID: '', // FIXME: メインスタックの認証情報を参照
        CLIENT_ID: '', // FIXME: メインスタックの認証情報を参照
        ACCOUNT: Stack.of(this).account,
        REGION: Stack.of(this).region,
        BEDROCK_REGION: props.bedrockRegion,
        TABLE_ACCESS_ROLE_ARN: '', // TODO: 必要に応じて設定
        DOCUMENT_BUCKET: this.documentBucket.bucketName,
        LARGE_MESSAGE_BUCKET: largeMessageBucket.bucketName,
        OPENSEARCH_DOMAIN_ENDPOINT: this.botStore?.openSearchEndpoint || '',
        ENABLE_BEDROCK_CROSS_REGION_INFERENCE:
          props.enableBedrockCrossRegionInference?.toString() || 'false',
        GLOBAL_AVAILABLE_MODELS: props.globalAvailableModels 
          ? JSON.stringify(props.globalAvailableModels)
          : '[]',
        // Lambda Web Adapter設定
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        PORT: '8000',
      },
      layers: [
        LayerVersion.fromLayerVersionArn(
          this,
          'LwaLayer',
          `arn:aws:lambda:${Stack.of(this).region}:753240598075:layer:LambdaAdapterLayerX86:23`
        ),
      ],
    });

    // Lambda Web Adapterのハンドラー設定
    (apiHandler.node.defaultChild as CfnResource).addPropertyOverride(
      'Handler',
      'run.sh'
    );

    // 必要な権限を付与
    this.database.conversationTable.grantReadWriteData(apiHandler);
    this.database.botTable.grantReadWriteData(apiHandler);
    this.documentBucket.grantReadWrite(apiHandler);
    largeMessageBucket.grantReadWrite(apiHandler);

    // Bedrockへのアクセス権限
    apiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:*'],
        resources: ['*'],
      })
    );

    // TODO: 他に必要な権限があれば追加
    // - UsageAnalysisへのアクセス権限
    // - BotStoreへのアクセス権限
    // - CodeBuildプロジェクトへの権限（必要な場合）

    // ==============================================
    // 5. WebSocket APIの作成
    // ==============================================
    // リアルタイムの双方向通信を実現するWebSocket API
    // ストリーミングレスポンスやリアルタイムチャットに使用
    this.websocket = new WebSocket(this, 'WebSocket', {
      database: this.database,
      websocketSessionTable: this.database.websocketSessionTable,  // WebSocketセッション管理用テーブル
      auth: undefined as any, // フェーズ4でメインスタックの認証機能と統合予定
      bedrockRegion,
      largeMessageBucket,  // 大容量メッセージの一時保存用
      documentBucket: this.documentBucket,  // ドキュメント保存用
      enableBedrockCrossRegionInference: props.enableBedrockCrossRegionInference || false,
      enableLambdaSnapStart: props.enableLambdaSnapStart || false,
      // WebSocketのアクセスログ保存用バケット
      accessLogBucket: new s3.Bucket(this, 'WebSocketAccessLogBucket', {
        bucketName: `bedrock-chat-ws-logs-${environment}-${tenantId}`,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        removalPolicy: props.removalPolicy || cdk.RemovalPolicy.RETAIN,
        autoDeleteObjects: props.removalPolicy === cdk.RemovalPolicy.DESTROY,
      }),
    });

    // ==============================================
    // 5. Embedding（ベクトル化）機能の作成（オプション）
    // ==============================================
    // RAG（Retrieval-Augmented Generation）機能のための文書ベクトル化
    // 文書をAIが理解できる数値ベクトルに変換し、類似検索を可能にする
    if (props.enableRagReplicas !== false) {
      this.embedding = new Embedding(this, 'Embedding', {
        bedrockRegion,
        database: this.database,
        documentBucket: this.documentBucket,
        bedrockCustomBotProject: undefined as any, // フェーズ4でCodeBuildプロジェクトと統合予定
        enableRagReplicas: props.enableRagReplicas || false,  // レプリカによる高可用性
      });
    }

    // ==============================================
    // 6. 使用状況分析機能の作成
    // ==============================================
    // チャットの利用状況を分析するためのログ収集とAthenaクエリ環境
    // アクセスログ保存用バケットの作成
    const accessLogBucket = new s3.Bucket(this, 'AccessLogBucket', {
      bucketName: `bedrock-chat-access-logs-${environment}-${tenantId}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: props.removalPolicy || cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: props.removalPolicy === cdk.RemovalPolicy.DESTROY,
    });

    // 使用状況分析コンストラクトの作成
    // DynamoDBのデータをエクスポートし、Athenaで分析可能にする
    this.usageAnalysis = new UsageAnalysis(this, 'UsageAnalysis', {
      envPrefix: props.envPrefix || '',
      accessLogBucket,  // ログの保存先
      sourceDatabase: this.database,  // 分析対象のデータベース
    });

    // ==============================================
    // 7. ボットストア機能の作成（オプション）
    // ==============================================
    // カスタムボットの定義、管理、検索機能を提供
    // OpenSearchを使用した高度な検索が可能
    if (props.enableBotStore) {
      this.botStore = new BotStore(this, 'BotStore', {
        envPrefix: props.envPrefix || '',
        botTable: this.database.botTable,  // ボット定義を保存するテーブル
        conversationTable: this.database.conversationTable,  // 会話履歴テーブル
        language: props.botStoreLanguage || 'ja',  // デフォルトは日本語
        enableBotStoreReplicas: props.enableBotStoreReplicas || false,  // レプリカによる高可用性
      });
    }

    // ==============================================
    // 8. スタック出力の定義
    // ==============================================
    // 他のスタックやアプリケーションから参照するための出力値
    
    // API Lambda関数のARN（プロキシから呼び出すため）
    new cdk.CfnOutput(this, 'ApiHandlerArn', {
      value: apiHandler.functionArn,
      description: `テナント ${tenantId} のAPI Lambda関数ARN`,
      exportName: `${this.stackName}-ApiHandlerArn`,
    });

    // WebSocketエンドポイントのURL
    new cdk.CfnOutput(this, 'WebSocketEndpoint', {
      value: this.websocket.apiEndpoint,
      description: `テナント ${tenantId} のWebSocketエンドポイント`,
      exportName: `${this.stackName}-WebSocketEndpoint`,  // 他のスタックから参照可能
    });

    // ドキュメントバケット名
    new cdk.CfnOutput(this, 'DocumentBucketName', {
      value: this.documentBucket.bucketName,
      description: `テナント ${tenantId} のドキュメントバケット名`,
      exportName: `${this.stackName}-DocumentBucketName`,
    });

    // ==============================================
    // 9. リソースタグの追加
    // ==============================================
    // コスト管理とリソース識別のためのタグ付け
    cdk.Tags.of(this).add('TenantId', tenantId.toString());  // テナント識別用
    cdk.Tags.of(this).add('Environment', environment);  // 環境識別用
    cdk.Tags.of(this).add('Purpose', 'TenantBedrockChat');  // 用途識別用

    // スタックの説明文を設定
    this.templateOptions.description = 
      `テナント ${tenantId} 専用のBedrock Chatリソースを作成します`;
  }
}