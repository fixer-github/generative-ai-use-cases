import {
  buildClient,
  CommitmentPolicy,
  KmsKeyringNode,
} from '@aws-crypto/client-node';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { CustomEmailSenderTriggerEvent } from 'aws-lambda';

// Helper to safely get email from user attributes
// Cognito sends userAttributes with different structures depending on trigger type
function getUserEmail(
  userAttributes: unknown
): string | undefined {
  if (!userAttributes || typeof userAttributes !== 'object') return undefined;
  const attrs = userAttributes as Record<string, unknown>;
  const email = attrs['email'];
  return typeof email === 'string' ? email : undefined;
}

// KMS configuration for decrypting the code
const { decrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT);

const keyId = process.env.KMS_KEY_ID!;
const keyArn = process.env.KMS_KEY_ARN!;
const keyring = new KmsKeyringNode({ generatorKeyId: keyId, keyIds: [keyArn] });

// SES configuration
const sesClient = new SESClient({ region: process.env.SES_REGION || process.env.AWS_REGION });
const fromEmail = process.env.SES_FROM_EMAIL!;
const fromName = process.env.SES_FROM_NAME || 'GaiXer';

// Color theme
const COLORS = {
  primary: '#232F3E', // aws-squid-ink
  accent: '#2074d5', // aws-sky
  orange: '#ff9900', // aws-smile
  background: '#f5f5f5',
  white: '#ffffff',
  text: '#333333',
  lightGray: '#e0e0e0',
};

const SERVICE_NAME = fromName;

// HTML email layout
const createEmailHtml = (
  title: string,
  bodyContent: string,
  footerNote?: string
): string => {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Noto Sans JP', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif; background-color: ${COLORS.background};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${COLORS.background};">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: ${COLORS.white}; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: ${COLORS.primary}; padding: 24px 32px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: ${COLORS.white}; font-size: 24px; font-weight: bold;">${SERVICE_NAME}</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: ${COLORS.background}; padding: 20px 32px; border-radius: 0 0 8px 8px; border-top: 1px solid ${COLORS.lightGray};">
              ${footerNote ? `<p style="margin: 0; font-size: 12px; color: #666;">${footerNote}</p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

// Code block component
const createCodeBlock = (code: string): string => {
  return `
    <div style="text-align: center; margin: 24px 0;">
      <div style="display: inline-block; background-color: ${COLORS.background}; border: 2px solid ${COLORS.accent}; border-radius: 8px; padding: 16px 32px;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: ${COLORS.primary};">${code}</span>
      </div>
    </div>
  `;
};

// Credentials block for admin invite
const createCredentialsBlock = (
  username: string,
  tempPassword: string
): string => {
  return `
    <div style="background-color: ${COLORS.background}; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="padding: 8px 0;">
            <span style="font-size: 14px; color: #666;">ユーザー名（メールアドレス）</span><br>
            <span style="font-size: 16px; font-weight: bold; color: ${COLORS.primary};">${username}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-top: 1px solid ${COLORS.lightGray};">
            <span style="font-size: 14px; color: #666;">仮パスワード</span><br>
            <span style="font-size: 16px; font-weight: bold; color: ${COLORS.primary}; font-family: monospace;">${tempPassword}</span>
          </td>
        </tr>
      </table>
    </div>
  `;
};

// Sign up email
const createSignUpEmail = (code: string): { subject: string; html: string; text: string } => {
  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; color: ${COLORS.primary}; font-size: 20px;">メールアドレスの確認</h2>
    <p style="margin: 0 0 16px 0; color: ${COLORS.text}; font-size: 15px; line-height: 1.6;">
      ${SERVICE_NAME}へのご登録ありがとうございます。<br>
      アカウントを有効にするため、以下の確認コードを入力してください。
    </p>
    ${createCodeBlock(code)}
    <p style="margin: 0; color: #666; font-size: 13px; line-height: 1.5;">
      このコードは24時間有効です。<br>
      心当たりがない場合は、このメールを無視してください。
    </p>
  `;

  return {
    subject: `【${SERVICE_NAME}】メールアドレスの確認`,
    html: createEmailHtml('メールアドレスの確認', bodyContent),
    text: `${SERVICE_NAME}へのご登録ありがとうございます。\n\n確認コード: ${code}\n\nこのコードは24時間有効です。`,
  };
};

// Forgot password email
const createForgotPasswordEmail = (code: string): { subject: string; html: string; text: string } => {
  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; color: ${COLORS.primary}; font-size: 20px;">パスワードリセット</h2>
    <p style="margin: 0 0 16px 0; color: ${COLORS.text}; font-size: 15px; line-height: 1.6;">
      パスワードリセットのリクエストを受け付けました。<br>
      以下の確認コードを入力して、新しいパスワードを設定してください。
    </p>
    ${createCodeBlock(code)}
    <p style="margin: 0; color: #666; font-size: 13px; line-height: 1.5;">
      このコードは1時間有効です。<br>
      このリクエストに心当たりがない場合は、このメールを無視してください。
    </p>
  `;

  return {
    subject: `【${SERVICE_NAME}】パスワードリセット`,
    html: createEmailHtml('パスワードリセット', bodyContent),
    text: `パスワードリセットのリクエストを受け付けました。\n\n確認コード: ${code}\n\nこのコードは1時間有効です。`,
  };
};

// Admin create user email
const createAdminCreateUserEmail = (
  username: string,
  tempPassword: string
): { subject: string; html: string; text: string } => {
  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; color: ${COLORS.primary}; font-size: 20px;">アカウント招待</h2>
    <p style="margin: 0 0 16px 0; color: ${COLORS.text}; font-size: 15px; line-height: 1.6;">
      ${SERVICE_NAME}へ招待されました。<br>
      以下の情報を使用してログインしてください。
    </p>
    ${createCredentialsBlock(username, tempPassword)}
    <p style="margin: 0; color: #666; font-size: 13px; line-height: 1.5;">
      初回ログイン時にパスワードの変更が求められます。<br>
      セキュリティのため、仮パスワードは安全に管理し、ログイン後すぐに変更してください。
    </p>
  `;

  const footerNote =
    'このメールは管理者によって送信されました。心当たりがない場合は、システム管理者にお問い合わせください。';

  return {
    subject: `【${SERVICE_NAME}】アカウント招待`,
    html: createEmailHtml('アカウント招待', bodyContent, footerNote),
    text: `${SERVICE_NAME}へ招待されました。\n\nユーザー名: ${username}\n仮パスワード: ${tempPassword}\n\n初回ログイン時にパスワードの変更が求められます。`,
  };
};

// Resend code email
const createResendCodeEmail = (code: string): { subject: string; html: string; text: string } => {
  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; color: ${COLORS.primary}; font-size: 20px;">確認コードの再送信</h2>
    <p style="margin: 0 0 16px 0; color: ${COLORS.text}; font-size: 15px; line-height: 1.6;">
      確認コードを再送信しました。<br>
      以下のコードを入力してアカウントを有効にしてください。
    </p>
    ${createCodeBlock(code)}
    <p style="margin: 0; color: #666; font-size: 13px; line-height: 1.5;">
      このコードは24時間有効です。
    </p>
  `;

  return {
    subject: `【${SERVICE_NAME}】確認コードの再送信`,
    html: createEmailHtml('確認コードの再送信', bodyContent),
    text: `確認コードを再送信しました。\n\n確認コード: ${code}\n\nこのコードは24時間有効です。`,
  };
};

// Decrypt the code from Cognito
async function decryptCode(encryptedCode: string): Promise<string> {
  const { plaintext } = await decrypt(
    keyring,
    Buffer.from(encryptedCode, 'base64')
  );
  return plaintext.toString('utf8');
}

// Send email via SES
async function sendEmail(
  toAddress: string,
  subject: string,
  htmlBody: string,
  textBody: string
): Promise<void> {
  const command = new SendEmailCommand({
    Source: `${fromName} <${fromEmail}>`,
    Destination: {
      ToAddresses: [toAddress],
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: htmlBody,
          Charset: 'UTF-8',
        },
        Text: {
          Data: textBody,
          Charset: 'UTF-8',
        },
      },
    },
  });

  await sesClient.send(command);
}

export const handler = async (
  event: CustomEmailSenderTriggerEvent
): Promise<void> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    const { triggerSource, request, userName } = event;
    const userEmail = getUserEmail(request.userAttributes);

    if (!userEmail) {
      console.error('No email address found in user attributes');
      return;
    }

    // Decrypt the code
    const code = await decryptCode(request.code!);
    console.log('Code decrypted successfully');

    let emailContent: { subject: string; html: string; text: string } | null = null;

    switch (triggerSource) {
      case 'CustomEmailSender_SignUp':
        emailContent = createSignUpEmail(code);
        break;

      case 'CustomEmailSender_ResendCode':
        emailContent = createResendCodeEmail(code);
        break;

      case 'CustomEmailSender_ForgotPassword':
        emailContent = createForgotPasswordEmail(code);
        break;

      case 'CustomEmailSender_AdminCreateUser':
        emailContent = createAdminCreateUserEmail(userName, code);
        break;

      case 'CustomEmailSender_UpdateUserAttribute':
      case 'CustomEmailSender_VerifyUserAttribute':
        // Use sign up email template for attribute verification
        emailContent = createSignUpEmail(code);
        emailContent.subject = `【${SERVICE_NAME}】メールアドレスの確認`;
        break;

      default:
        console.log(`Unhandled trigger source: ${triggerSource}`);
        return;
    }

    if (emailContent) {
      await sendEmail(userEmail, emailContent.subject, emailContent.html, emailContent.text);
      console.log(`Email sent successfully to ${userEmail.replace(/[^@.]/g, '*')}`);
    }
  } catch (error) {
    console.error('Error processing custom email sender:', error);
    throw error;
  }
};
