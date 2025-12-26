/**
 * Email Service
 *
 * 共通メール送信機能を提供するサービス。
 * SendGrid APIを使用してメールを送信します。
 */

const SERVICE_NAME = process.env.SERVICE_NAME || 'GenU';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || '';
const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

/**
 * カラーテーマ（既存のメールテンプレートと統一）
 */
export const COLORS = {
  primary: '#232F3E',
  accent: '#2074d5',
  orange: '#ff9900',
  background: '#f5f5f5',
  white: '#ffffff',
  text: '#333333',
  lightGray: '#e0e0e0',
};

/**
 * HTMLエスケープ関数
 * ユーザー入力をHTMLに埋め込む際にXSS/HTMLインジェクションを防止
 */
export const escapeHtml = (str: string = ''): string => {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, (char) => escapeMap[char]);
};

/**
 * 料金フォーマット
 */
export function formatPrice(amount: number, currency: string = 'jpy'): string {
  const currencyUpper = currency.toUpperCase();
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: currencyUpper,
  }).format(amount);
}

/**
 * 日付フォーマット（日本語）
 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * 共通HTMLメールレイアウト
 */
export const createEmailHtml = (
  title: string,
  bodyContent: string,
  footerNote?: string
): string => {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Noto Sans JP', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif; background-color: ${COLORS.background};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${COLORS.background};">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: ${COLORS.white}; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color: ${COLORS.primary}; padding: 24px 32px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: ${COLORS.white}; font-size: 24px; font-weight: bold;">${SERVICE_NAME}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              ${bodyContent}
            </td>
          </tr>
          <tr>
            <td style="background-color: ${COLORS.background}; padding: 20px 32px; border-radius: 0 0 8px 8px; border-top: 1px solid ${COLORS.lightGray};">
              ${footerNote ? `<p style="margin: 0; font-size: 12px; color: #666;">${escapeHtml(footerNote)}</p>` : ''}
              <p style="margin: 8px 0 0 0; font-size: 11px; color: #999;">&copy; ${new Date().getFullYear()} ${SERVICE_NAME}. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * SendGridでメール送信
 */
export const sendEmail = async (
  to: string,
  subject: string,
  htmlContent: string
): Promise<void> => {
  if (!SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY is not configured, skipping email send');
    return;
  }

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: SENDGRID_FROM_EMAIL },
    subject: subject,
    content: [{ type: 'text/html', value: htmlContent }],
  };

  const response = await fetch(SENDGRID_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `SendGrid API error: ${response.status} ${response.statusText} - ${errorBody}`
    );
  }

  console.log(`Email sent successfully to ${to}`);
};

/**
 * サービス名を取得
 */
export function getServiceName(): string {
  return SERVICE_NAME;
}
