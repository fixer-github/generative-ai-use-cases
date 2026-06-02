jest.mock('@aws-crypto/client-node', () => ({
  buildClient: jest.fn(() => ({ decrypt: jest.fn() })),
  CommitmentPolicy: {
    FORBID_ENCRYPT_ALLOW_DECRYPT: 'FORBID_ENCRYPT_ALLOW_DECRYPT',
  },
  KmsKeyringNode: jest.fn(),
}));

jest.mock('../../lambda/utils/sendgrid', () => ({
  sendMail: jest.fn(),
}));

import {
  buildMessage,
  renderHtml,
  renderText,
  unescapeHtmlEntities,
} from '../../lambda/customEmailSender';

describe('customEmailSender', () => {
  test('unescapes one layer of HTML entities', () => {
    expect(
      unescapeHtmlEntities(
        'Pass&lt;&gt;&quot;&#x27;&#39;&apos;&amp;&amp;lt;'
      )
    ).toBe('Pass<>"\'\'\'&&lt;');
  });

  test('unescapes AdminCreateUser temporary password before rendering', () => {
    const message = buildMessage(
      'CustomEmailSender_AdminCreateUser',
      'user@example.com',
      'Temp&lt;123&gt;&amp;Q'
    );

    expect(message).toBeDefined();
    expect(message?.credentials?.[1].value).toBe('Temp<123>&Q');
    expect(renderText(message!)).toContain('仮パスワード: Temp<123>&Q');

    const html = renderHtml(message!);
    expect(html).toContain('Temp&lt;123&gt;&amp;Q');
    expect(html).not.toContain('Temp&amp;lt;123&amp;gt;&amp;amp;Q');
  });

  test('does not unescape verification codes', () => {
    const message = buildMessage(
      'CustomEmailSender_SignUp',
      'user@example.com',
      '123&lt;456&gt;'
    );

    expect(message?.code).toBe('123&lt;456&gt;');
  });
});
