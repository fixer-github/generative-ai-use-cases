/* eslint-disable i18nhelper/no-jp-string */
/**
 * Cognito Custom Email Sender Lambda Trigger.
 *
 * When attached, Amazon Cognito delegates ALL outbound user emails (sign-up
 * verification, admin invitation, forgot-password, attribute verification,
 * MFA, account-takeover notification) to this function instead of sending
 * them itself. Codes / temporary passwords arrive encrypted with the user
 * pool's `customSenderKmsKey`; we decrypt them with the AWS Encryption SDK
 * and deliver the message through SendGrid.
 *
 * This trigger is only wired up when SendGrid is configured and we are not in
 * closed-network mode (see auth.ts).
 */

import { CustomEmailSenderTriggerEvent } from 'aws-lambda';
import {
  buildClient,
  CommitmentPolicy,
  KmsKeyringNode,
} from '@aws-crypto/client-node';
import { sendMail } from './utils/sendgrid';

const KMS_KEY_ARN = process.env.KMS_KEY_ARN!;

// Validity of admin-issued temporary passwords. Set from the same value used
// for the user pool's `tempPasswordValidity` (see auth.ts) so the wording in
// the invitation email matches the actual expiry. Defaults to Cognito's
// 7-day default if unset.
const TEMP_PASSWORD_VALIDITY_DAYS = Number(
  process.env.TEMP_PASSWORD_VALIDITY_DAYS || '7'
);

const BRAND = 'GaiXer'; // Service name shown in the header
const COMPANY = 'FIXER'; // Company name shown in the footer copyright
const BRAND_COLOR = '#1a2b4a';

const { decrypt } = buildClient(CommitmentPolicy.FORBID_ENCRYPT_ALLOW_DECRYPT);
const keyring = new KmsKeyringNode({ keyIds: [KMS_KEY_ARN] });

/**
 * Decrypt the base64 code/temporary-password delivered by Cognito.
 */
async function decryptCode(encryptedCode: string): Promise<string> {
  const { plaintext } = await decrypt(
    keyring,
    Buffer.from(encryptedCode, 'base64')
  );
  return plaintext.toString();
}

/**
 * Semantic description of an email. The plaintext and HTML bodies are both
 * rendered from this so the two parts always stay in sync.
 */
interface MessageContent {
  subject: string;
  heading: string;
  /** Intro paragraph; `\n` becomes a line break. */
  intro: string;
  /** A verification code rendered in an emphasized box. */
  code?: string;
  /** Key/value rows (e.g. username + temporary password). */
  credentials?: { label: string; value: string }[];
  /** Expiry notice shown near the note (e.g. "valid for 24 hours"). */
  expiry?: string;
  /** Footnote (e.g. "discard this email if unexpected"). */
  note?: string;
  /** Render with a warning accent (used for security notifications). */
  alert?: boolean;
}

/** Escape user-controlled / decrypted values before embedding in HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render the plaintext part. This is the fallback for clients that don't
 * display HTML, so it mirrors the same information.
 */
function renderText(c: MessageContent): string {
  const lines: string[] = [c.intro];

  if (c.code) {
    lines.push('', `確認コード: ${c.code}`);
  }
  if (c.credentials) {
    lines.push('', ...c.credentials.map((r) => `${r.label}: ${r.value}`));
  }
  if (c.expiry) {
    lines.push('', c.expiry);
  }
  if (c.note) {
    lines.push('', c.note);
  }

  return lines.join('\n');
}

/**
 * Render the HTML part. Uses a table layout with inline CSS for mail-client
 * compatibility. Note that Outlook (Windows) ignores `border-radius` and
 * `box-shadow`, so the design must remain readable as flat rectangles.
 */
function renderHtml(c: MessageContent): string {
  const accent = c.alert ? '#b3261e' : BRAND_COLOR;
  const intro = escapeHtml(c.intro).replace(/\n/g, '<br>');

  let main = `<p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#444;">${intro}</p>`;

  if (c.code) {
    main += `<div style="background:#f0f4fa;border:1px solid #d6e0ef;border-radius:8px;text-align:center;padding:20px;margin:0 0 24px;">
            <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:${BRAND_COLOR};">${escapeHtml(
              c.code
            )}</span>
          </div>`;
  }

  if (c.credentials) {
    const rows = c.credentials
      .map(
        (r) => `<tr>
              <td style="padding:6px 0;font-size:13px;color:#888;white-space:nowrap;">${escapeHtml(
                r.label
              )}</td>
              <td style="padding:6px 0 6px 16px;font-size:14px;color:#1a1a1a;font-weight:bold;word-break:break-all;">${escapeHtml(
                r.value
              )}</td>
            </tr>`
      )
      .join('');
    main += `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f0f4fa;border:1px solid #d6e0ef;border-radius:8px;width:100%;margin:0 0 24px;">
            <tr><td style="padding:8px 20px;"><table role="presentation" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
          </table>`;
  }

  if (c.expiry) {
    main += `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#666;">${escapeHtml(
      c.expiry
    )}</p>`;
  }

  if (c.note) {
    main += `<p style="margin:0;font-size:12px;line-height:1.7;color:#888;">${escapeHtml(
      c.note
    )}</p>`;
  }

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Helvetica Neue',Arial,'Hiragino Sans','Meiryo',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr><td bgcolor="${accent}" style="background:${accent};padding:24px;text-align:center;">
          <span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px;">${BRAND}</span>
        </td></tr>
        <tr><td style="padding:32px 32px 24px;color:#1a1a1a;">
          <h1 style="margin:0 0 16px;font-size:18px;">${escapeHtml(
            c.heading
          )}</h1>
          ${main}
        </td></tr>
        <tr><td bgcolor="#fafafa" style="background:#fafafa;padding:16px 32px;text-align:center;border-top:1px solid #eee;">
          <span style="font-size:11px;color:#aaa;">&copy; ${COMPANY} | このメールは自動送信です</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Build the semantic content for the given trigger source. Returns undefined
 * for sources we intentionally do not handle.
 */
function buildMessage(
  triggerSource: string,
  email: string,
  code: string | undefined
): MessageContent | undefined {
  switch (triggerSource) {
    case 'CustomEmailSender_SignUp':
    case 'CustomEmailSender_ResendCode':
      return {
        subject: '[GaiXer] メールアドレスの確認',
        heading: 'メールアドレスの確認',
        intro: `GaiXer へのご登録ありがとうございます。
以下の確認コードを入力して、メールアドレスの確認を完了してください。`,
        code,
        expiry: 'このコードは24時間有効です。',
        note: 'このメールに心当たりがない場合は破棄してください。',
      };
    case 'CustomEmailSender_ForgotPassword':
      return {
        subject: '[GaiXer] パスワードのリセット',
        heading: 'パスワードのリセット',
        intro: `パスワードリセットのリクエストを受け付けました。
以下の確認コードを入力して、パスワードの再設定を行ってください。`,
        code,
        expiry: 'このコードは1時間有効です。',
        note: 'このメールに心当たりがない場合は破棄してください。',
      };
    case 'CustomEmailSender_AdminCreateUser':
      return {
        subject: '[GaiXer] アカウントが作成されました',
        heading: 'アカウントが作成されました',
        intro: `GaiXer のアカウントが作成されました。
以下の情報でログインしてください。`,
        credentials: [
          { label: 'ユーザー名', value: email },
          { label: '仮パスワード', value: code ?? '' },
        ],
        expiry: `この仮パスワードは${TEMP_PASSWORD_VALIDITY_DAYS}日間有効です。期限内にログインしてください。`,
        note: '初回ログイン時に新しいパスワードの設定が必要です。',
      };
    case 'CustomEmailSender_UpdateUserAttribute':
    case 'CustomEmailSender_VerifyUserAttribute':
      return {
        subject: '[GaiXer] アカウント情報変更の確認',
        heading: 'アカウント情報変更の確認',
        intro: `アカウント情報の変更を確認しています。
以下の確認コードを入力して、変更を完了してください。`,
        code,
        expiry: 'このコードは24時間有効です。',
      };
    case 'CustomEmailSender_Authentication':
      return {
        subject: '[GaiXer] サインインの確認コード',
        heading: 'サインインの確認コード',
        intro: 'サインインの確認コードです。',
        code,
      };
    case 'CustomEmailSender_AccountTakeOverNotification':
      return {
        subject: '[GaiXer] アカウントのセキュリティ通知',
        heading: 'アカウントのセキュリティ通知',
        intro: `お使いのアカウントで通常と異なるサインインが検知されました。
心当たりがない場合は、速やかにパスワードを変更してください。`,
        alert: true,
      };
    default:
      return undefined;
  }
}

export const handler = async (
  event: CustomEmailSenderTriggerEvent
): Promise<void> => {
  const userAttributes = event.request.userAttributes as Record<
    string,
    string | undefined
  >;
  const email = userAttributes.email;
  if (!email) {
    console.error(
      `No email attribute for user; skipping (${event.triggerSource})`
    );
    return;
  }

  const code = event.request.code
    ? await decryptCode(event.request.code)
    : undefined;

  const message = buildMessage(event.triggerSource, email, code);
  if (!message) {
    console.warn(`Unhandled triggerSource: ${event.triggerSource}`);
    return;
  }

  await sendMail(
    email,
    message.subject,
    renderText(message),
    renderHtml(message)
  );
};
