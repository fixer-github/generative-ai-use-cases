import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getTenantId } from '../../../utils/tenantUtils';

const SERVICE_NAME = process.env.SERVICE_NAME || 'GenU';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || '';
const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

const COLORS = {
  primary: '#232F3E',
  accent: '#2074d5',
  orange: '#ff9900',
  background: '#f5f5f5',
  white: '#ffffff',
  text: '#333333',
  lightGray: '#e0e0e0',
};

interface SendInvoiceEmailInput {
  invoiceId: string;
  recipientEmail: string;
}

const secretsCache: Record<string, any> = {};

async function getSecret(secretName: string): Promise<any> {
  if (secretsCache[secretName]) {
    return secretsCache[secretName];
  }

  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} is empty`);
  }

  const secret = JSON.parse(response.SecretString);
  secretsCache[secretName] = secret;

  return secret;
}

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

const createInvoiceSummaryBlock = (
  amount: number,
  currency: string,
  date: string,
  planName?: string
): string => {
  const formattedAmount = new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);

  const formattedDate = new Date(date).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `
    <div style="background-color: ${COLORS.background}; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        ${planName ? `<tr>
          <td style="padding: 8px 0;">
            <span style="font-size: 14px; color: #666;">プラン</span><br>
            <span style="font-size: 16px; font-weight: bold; color: ${COLORS.primary};">${planName}</span>
          </td>
        </tr>` : ''}
        <tr>
          <td style="padding: 8px 0; ${planName ? `border-top: 1px solid ${COLORS.lightGray};` : ''}">
            <span style="font-size: 14px; color: #666;">請求金額</span><br>
            <span style="font-size: 24px; font-weight: bold; color: ${COLORS.accent};">${formattedAmount}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-top: 1px solid ${COLORS.lightGray};">
            <span style="font-size: 14px; color: #666;">請求日</span><br>
            <span style="font-size: 16px; font-weight: bold; color: ${COLORS.primary};">${formattedDate}</span>
          </td>
        </tr>
      </table>
    </div>
  `;
};

const createInvoiceEmail = (
  amount: number,
  currency: string,
  invoiceDate: string,
  invoicePdfUrl: string,
  planName?: string
): { subject: string; htmlContent: string } => {
  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; color: ${COLORS.primary}; font-size: 20px;">請求書のお知らせ</h2>
    <p style="margin: 0 0 16px 0; color: ${COLORS.text}; font-size: 15px; line-height: 1.6;">
      ${SERVICE_NAME}のサブスクリプション請求書が発行されました。<br>
      以下の内容をご確認ください。
    </p>
    ${createInvoiceSummaryBlock(amount, currency, invoiceDate, planName)}
    <div style="text-align: center; margin: 24px 0;">
      <a href="${invoicePdfUrl}" style="display: inline-block; background-color: ${COLORS.accent}; color: ${COLORS.white}; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 16px; font-weight: bold;">請求書をダウンロード</a>
    </div>
    <p style="margin: 24px 0 0 0; color: #666; font-size: 13px; line-height: 1.5;">
      このメールはサブスクリプション請求の確認のために自動送信されています。<br>
      ご不明な点がございましたら、カスタマーサポートまでお問い合わせください。
    </p>
  `;

  const footerNote = 'このメールは自動送信されています。返信には対応できません。';

  return {
    subject: `【${SERVICE_NAME}】請求書発行のお知らせ`,
    htmlContent: createEmailHtml('請求書発行のお知らせ', bodyContent, footerNote),
  };
};

const sendEmail = async (
  to: string,
  subject: string,
  htmlContent: string
): Promise<void> => {
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

  console.log(`Invoice email sent successfully to ${to}`);
};

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Send invoice email request received');

  try {
    const tenantId = getTenantId(event);

    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const input: SendInvoiceEmailInput = JSON.parse(event.body);

    if (!input.invoiceId || !input.recipientEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'invoiceId and recipientEmail are required',
        }),
      };
    }

    console.log('Send invoice email request:', {
      invoiceId: input.invoiceId,
      recipientEmail: input.recipientEmail,
      tenantId,
    });

    const secretName = `${tenantId}/billing/stripe`;
    const secret = await getSecret(secretName);
    const stripe = new Stripe(secret.apiKey, {
      apiVersion: '2025-10-29.clover',
    });

    const invoice = await stripe.invoices.retrieve(input.invoiceId);

    if (!invoice.invoice_pdf) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invoice PDF not available' }),
      };
    }

    const planName = invoice.lines?.data?.[0]?.description || undefined;
    const invoiceDate =
      invoice.status_transitions?.finalized_at || invoice.created;

    const emailContent = createInvoiceEmail(
      invoice.amount_due,
      invoice.currency,
      new Date(invoiceDate * 1000).toISOString(),
      invoice.invoice_pdf,
      planName
    );

    await sendEmail(
      input.recipientEmail,
      emailContent.subject,
      emailContent.htmlContent
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Invoice email sent successfully' }),
    };
  } catch (error) {
    console.error('Error sending invoice email:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
