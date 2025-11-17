# レビュー結果: Lambda Database-Migration

## 担当ファイル
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/database-migration/applyMigrations.ts`
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/database-migration/migrationRunner.ts`
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/database-migration/certs/rds-ca-bundle.pem`

## 重大な問題（Critical）

### 1. CloudFormation Custom Resourceのエラー時の不完全な処理（applyMigrations.ts:190-201）
**問題**: エラー発生時に`sendResponse`でFAILEDを返した後に`throw error`で再スローしているが、sendResponseが失敗した場合にもエラーが再スローされる。これによりCloudFormationにはレスポンスが届かない可能性がある。

**影響**: CloudFormationスタックがハング状態になり、タイムアウトまで待つ必要が出る（通常60分）。

**該当コード**:
```typescript
} catch (error) {
  console.error('Error in migration runner:', error);

  await sendResponse(
    event,
    'FAILED',
    `Error: ${(error as Error).message}`,
    physicalResourceId
  );

  // Re-throw to ensure Lambda execution is marked as failed
  throw error;
}
```

**推奨**: sendResponseが確実に完了してから例外を再スローするべき。またsendResponse自体が失敗した場合のハンドリングも必要。

---

### 2. マイグレーション失敗時のロールバック不完全（migrationRunner.ts:91-94）
**問題**: `schema_migrations`テーブルへのINSERTが成功してもその後の処理でエラーが出た場合、トランザクションはロールバックされるが、マイグレーションの実行状態が不整合になる可能性がある。

**該当コード**:
```typescript
// SQLを実行
await client.query(migration.sql);

// schema_migrationsテーブルに記録
await client.query(
  'INSERT INTO schema_migrations (version) VALUES ($1)',
  [migration.version]
);
```

**影響**: マイグレーションSQLの実行が成功したがschema_migrationsへの記録が失敗した場合、次回実行時に同じマイグレーションが再実行される可能性がある。

**推奨**: トランザクションの順序は適切だが、エラーメッセージでどの段階で失敗したかを明確にすべき。

---

## 警告レベルの問題（Warning）

### 3. パスワードのログ出力リスク（applyMigrations.ts:106-111）
**問題**: RDS接続情報をログ出力しているが、パスワードは出力していないものの、デバッグ時に誤ってパスワードを追加してしまうリスクがある。

**該当コード**:
```typescript
console.log('RDS connection info:', {
  host: credentials.host,
  port: credentials.port,
  database: credentials.database,
  username: credentials.username,
});
```

**推奨**: usernameもマスクするか、ログレベルを制御できるようにする。

---

### 4. マイグレーションディレクトリの存在チェックタイミング（applyMigrations.ts:136）
**問題**: マイグレーションディレクトリのパスは`executeMigrations`内で決定されるが、実際の存在チェックは`loadMigrationFiles`内で行われる。この間にRDS接続が確立されるため、ディレクトリが存在しない場合に無駄なリソースを消費する。

**該当コード**:
```typescript
const migrationsDir = props.MigrationsPath || path.join(__dirname, 'database/migrations');

console.log('Migrations directory:', migrationsDir);

// マイグレーションを実行
await runMigrations(pool, migrationsDir);
```

**推奨**: RDS接続前にマイグレーションディレクトリの存在を確認する。

---

### 5. バージョン番号の抽出ロジックが脆弱（migrationRunner.ts:63）
**問題**: ファイル名から`split('_')[0]`でバージョンを取得しているが、ファイル名が規約に従っていない場合（例: `create_plans.sql`）の処理が不明確。

**該当コード**:
```typescript
// ファイル名から番号を抽出（例: 001_create_plans_table.sql -> 001）
const version = filename.split('_')[0];
```

**推奨**:
- バージョン番号の形式をバリデーションする
- 正規表現を使って数字部分を確実に抽出する
- 無効なファイル名の場合はエラーを投げる

---

### 6. RDS CA証明書の更新管理（certs/rds-ca-bundle.pem）
**問題**: RDS CA証明書は定期的にAWSによって更新される。証明書ファイルがコードベースにハードコードされているため、更新時にコードの再デプロイが必要になる。

**推奨**:
- 証明書の有効期限を監視する仕組みを導入
- 可能であればAWS Systems Manager Parameter StoreやS3から動的に取得する

---

### 7. トランザクション内でのエラーハンドリング（migrationRunner.ts:101-107）
**問題**: ROLLBACK後にエラーログを出力してthrowしているが、ROLLBACKそのものが失敗する可能性についての考慮がない。

**該当コード**:
```typescript
} catch (error) {
  await client.query('ROLLBACK');
  console.error(
    `Failed to apply migration ${migration.version}: ${migration.filename}`,
    error
  );
  throw error;
}
```

**推奨**: ROLLBACK自体もtry-catchで囲み、失敗した場合のログを出力する。

---

## 軽微な問題・改善提案（Info）

### 8. CloudFormation Response送信の失敗ハンドリング（applyMigrations.ts:64-69）
**問題**: sendResponseでfetchが失敗した場合、エラーログを出力するだけで例外をスローしていない。CloudFormationへの通知が必須であるため、失敗時の処理が不十分。

**該当コード**:
```typescript
if (!response.ok) {
  console.error(
    'Failed to send CloudFormation response:',
    response.statusText
  );
}
```

**推奨**: レスポンス送信の失敗時にリトライロジックを追加するか、エラーを投げる。

---

### 9. データベース接続プールのサイズ設定（applyMigrations.ts:124）
**問題**: `max: 5`の接続プール設定だが、マイグレーション実行は基本的にシーケンシャルなので、接続数は1-2で十分。

**該当コード**:
```typescript
max: 5,
connectionTimeoutMillis: 10000,
```

**推奨**: `max: 2`程度に削減してリソースを節約する。

---

### 10. マイグレーションファイルが0件の場合の処理（migrationRunner.ts:126-128）
**問題**: マイグレーションファイルが0件の場合は正常終了しているが、これが意図した状態なのか、エラー（ディレクトリパスの誤りなど）なのかが判別できない。

**該当コード**:
```typescript
if (migrations.length === 0) {
  console.log('No migration files found');
  return;
}
```

**推奨**: Warningレベルのログを出力するか、オプションで厳密モードを設けてエラーとする。

---

### 11. Secret取得時のフィールド名の後方互換性（applyMigrations.ts:93）
**問題**: `secret.dbname || secret.database`のようにフィールド名の違いを吸収しているが、どちらが正式な形式なのかが不明確。

**該当コード**:
```typescript
database: secret.dbname || secret.database,
```

**推奨**: AWS RDS Secretsの公式フォーマットに従い、コメントでどのフィールド名が標準かを明記する。

---

### 12. 冪等性の保証方法が暗黙的（全体設計）
**問題**: マイグレーションの冪等性は`schema_migrations`テーブルへの記録に依存しているが、この設計がドキュメント化されていない。

**推奨**:
- コメントでマイグレーションの冪等性がどのように保証されているかを明記
- schema_migrationsテーブルの作成を0番のマイグレーションとして明示的に管理

---

### 13. Content-Lengthヘッダーの設定（applyMigrations.ts:59）
**問題**: `Content-Length`ヘッダーを文字列の長さで設定しているが、本来はバイト長であるべき。マルチバイト文字がある場合に不正確になる。

**該当コード**:
```typescript
'Content-Length': JSON.stringify(responseBody).length.toString(),
```

**推奨**: `Buffer.byteLength(JSON.stringify(responseBody), 'utf8')`を使用する。

---

### 14. Lambda Context未使用（applyMigrations.ts:154）
**問題**: `_context`パラメータが完全に未使用。タイムアウト管理などに利用できる可能性がある。

**該当コード**:
```typescript
export const handler = async (
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<void> => {
```

**推奨**: `context.getRemainingTimeInMillis()`を使ってタイムアウト前の適切な処理終了を検討。

---

### 15. マイグレーションの順序保証（migrationRunner.ts:54）
**問題**: ファイル名のソートに`.sort()`を使っているが、文字列ソートのため、`10_xxx.sql`が`2_xxx.sql`より前に来る可能性がある。

**該当コード**:
```typescript
const files = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();
```

**推奨**: バージョン番号は`001`, `002`, `010`のようにゼロパディングすることを規約として明記するか、数値ソートを行う。

---

### 16. SSL設定のハードコード（applyMigrations.ts:120-122）
**問題**: SSL設定が常に`rejectUnauthorized: true`でハードコードされている。開発環境では柔軟性が必要になる可能性がある。

**該当コード**:
```typescript
ssl: {
  rejectUnauthorized: true,
  ca: fs.readFileSync(path.join(__dirname, 'certs/rds-ca-bundle.pem')).toString(),
},
```

**推奨**: 環境変数で制御できるようにする（ただし本番環境では必ずtrueにする）。

---

## 総合評価

**要修正**

### 総評
マイグレーション実行ロジックとランナーの基本設計は適切ですが、以下の重大な問題があります：

1. **CloudFormation Custom Resourceのエラーハンドリングが不完全** - スタックがハング状態になるリスクがある
2. **マイグレーション失敗時のエラーメッセージが不明確** - トラブルシューティングが困難になる

その他、バージョン番号の抽出ロジック、証明書管理、エラーハンドリングの堅牢性など、複数の改善点があります。

### 良い点
- トランザクションを使った適切なロールバック機構
- schema_migrationsテーブルによる冪等性の保証
- 適用済みマイグレーションのスキップ機能
- RDS証明書の適切な管理（SSL/TLS接続）

### 改善が必要な点
- Critical問題1, 2への対応が必須
- バージョン番号抽出の堅牢性向上
- エラーハンドリングの強化
- ログ出力時のセキュリティ考慮
