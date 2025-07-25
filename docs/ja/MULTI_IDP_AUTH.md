# 複数のIdPを使用した認証設定

このドキュメントでは、CognitoをRPとして複数のIdentity Provider (IdP)を設定する方法を説明します。

## 概要

新しい認証設定により、以下が可能になります：
- 複数のSAML IdPの同時利用
- OIDC IdPのサポート
- Cognito User Pool認証と外部IdPの併用
- 単一IdPの場合の自動リダイレクト
- デプロイ時の自動設定（手動でのCognito設定不要）

## 設定方法

### 1. cdk.jsonの設定

`cdk.json`に新しい`authProviders`セクションを追加します：

```json
{
  "context": {
    "authProviders": {
      "cognitoUserPool": {
        "enabled": true,
        "selfSignUpEnabled": true,
        "allowedSignUpEmailDomains": ["example.com"]
      },
      "federatedIdentityProviders": [
        {
          "name": "EntraID",
          "type": "SAML",
          "enabled": true,
          "metadataUrl": "https://login.microsoftonline.com/xxx/federationmetadata/2007-06/federationmetadata.xml",
          "attributeMapping": {
            "email": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
            "custom:idpGroup": "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
          }
        },
        {
          "name": "GoogleWorkspace",
          "type": "OIDC",
          "enabled": true,
          "clientId": "your-client-id.apps.googleusercontent.com",
          "clientSecret": "your-client-secret",
          "issuerUrl": "https://accounts.google.com",
          "scopes": ["openid", "email", "profile"],
          "attributeMapping": {
            "email": "email",
            "name": "name",
            "picture": "picture"
          }
        }
      ]
    },
    "cognitoDomainPrefix": "your-app-name"
  }
}
```

### 2. パラメータの説明

#### cognitoUserPool
- `enabled`: Cognito User Pool認証を有効にするか
- `selfSignUpEnabled`: セルフサインアップを許可するか
- `allowedSignUpEmailDomains`: サインアップを許可するメールドメイン

#### federatedIdentityProviders
各IdPに対して以下を設定：

**共通パラメータ:**
- `name`: IdPの名前（一意である必要があります）
- `type`: "SAML" または "OIDC"
- `enabled`: このIdPを有効にするか
- `attributeMapping`: 属性のマッピング

**SAML固有のパラメータ:**
- `metadataUrl`: SAML メタデータのURL
- `metadataDocument`: またはメタデータドキュメントの内容（metadataUrlの代わりに使用）

**OIDC固有のパラメータ:**
- `clientId`: OIDCクライアントID
- `clientSecret`: OIDCクライアントシークレット
- `issuerUrl`: OIDC発行者URL
- `scopes`: 要求するスコープ（デフォルト: ["openid", "email", "profile"]）

#### cognitoDomainPrefix
Cognito Hosted UIのドメインプレフィックス。世界で一意である必要があります。

### 3. IdP側の設定

#### SAML IdP（例：Microsoft Entra ID）

1. エンタープライズアプリケーションを作成
2. SAML設定で以下を指定：
   - Identifier (Entity ID): `urn:amazon:cognito:sp:<UserPoolID>`
   - Reply URL: `https://<cognitoDomainPrefix>.auth.<region>.amazoncognito.com/saml2/idpresponse`

#### OIDC IdP（例：Google Workspace）

1. OAuth 2.0クライアントIDを作成
2. 承認済みのリダイレクトURIに以下を追加：
   - `https://<cognitoDomainPrefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse`

### 4. デプロイ

設定後、通常通りデプロイを実行：

```bash
npm run cdk:deploy
```

デプロイが完了すると、自動的に：
- Cognito User Poolが作成されます
- 指定したすべてのIdPが設定されます
- Cognito Domainが作成されます
- App Clientが適切に設定されます

### 5. 動作

- **複数のIdPが有効な場合**: ログイン画面で各IdPのボタンが表示されます
- **単一のIdPのみ有効な場合**: 自動的にそのIdPの認証画面にリダイレクトされます
- **Cognito User Poolも有効な場合**: 通常のユーザー名/パスワード入力欄も表示されます

## 移行ガイド

### 既存のSAML設定からの移行

既存の設定：
```json
{
  "samlAuthEnabled": true,
  "samlCognitoDomainName": "your-name.auth.ap-northeast-1.amazoncognito.com",
  "samlCognitoFederatedIdentityProviderName": "EntraID"
}
```

新しい設定：
```json
{
  "authProviders": {
    "cognitoUserPool": {
      "enabled": false
    },
    "federatedIdentityProviders": [
      {
        "name": "EntraID",
        "type": "SAML",
        "enabled": true,
        "metadataUrl": "https://..."
      }
    ]
  },
  "cognitoDomainPrefix": "your-name"
}
```

## 注意事項

1. `cognitoDomainPrefix`は世界で一意である必要があります
2. 少なくとも1つの認証方法が有効である必要があります
3. OIDCのclientSecretは本番環境ではAWS Secrets Managerの使用を推奨します
4. 初回デプロイ後にIdPを追加/削除する場合は、Cognito User Poolの再作成が必要な場合があります