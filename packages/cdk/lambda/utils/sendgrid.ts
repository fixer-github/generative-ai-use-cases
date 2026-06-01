/**
 * SendGrid mail sender (shared)
 *
 * Minimal helper that sends a plaintext email through the SendGrid Mail Send
 * API. Configuration is provided through two env vars (set from cdk.json via
 * the common `sendgridApiKey` / `mailFrom` settings):
 *   - SENDGRID_API_KEY: the SendGrid API key
 *   - MAIL_FROM:        the authenticated sender address
 */

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM;

const SENDGRID_ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';

/**
 * Whether SendGrid is configured (both API key and sender address present).
 */
export function isSendGridConfigured(): boolean {
  return (
    !!SENDGRID_API_KEY &&
    SENDGRID_API_KEY.length > 0 &&
    !!MAIL_FROM &&
    MAIL_FROM.length > 0
  );
}

/**
 * Send an email through the SendGrid Mail Send API.
 *
 * Always sends a plaintext part; when `html` is provided an HTML part is added
 * as well. SendGrid requires the content array to be ordered with `text/plain`
 * before `text/html`, which clients use as the fallback when they can't render
 * HTML.
 */
export async function sendMail(
  toEmail: string,
  subject: string,
  text: string,
  html?: string
): Promise<void> {
  if (!isSendGridConfigured()) {
    throw new Error('SendGrid is not configured');
  }

  const content: { type: string; value: string }[] = [
    { type: 'text/plain', value: text },
  ];
  if (html) {
    content.push({ type: 'text/html', value: html });
  }

  const res = await fetch(SENDGRID_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: MAIL_FROM },
      subject: subject.substring(0, 998), // RFC 5322 subject length guard
      content,
    }),
  });

  if (res.status >= 400) {
    const detail = await res.text().catch(() => '');
    throw new Error(`SendGrid request failed: ${res.status} ${detail}`);
  }
}
