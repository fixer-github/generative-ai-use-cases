import { Authenticator, translations } from '@aws-amplify/ui-react';
import { I18n } from 'aws-amplify/utils';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const selfSignUpEnabled: boolean =
  import.meta.env.VITE_APP_SELF_SIGN_UP_ENABLED === 'true';

type Props = {
  children: React.ReactNode;
};
const AuthWithUserpool: React.FC<Props> = (props) => {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    I18n.putVocabularies(translations);
    /* eslint-disable i18nhelper/no-jp-string -- Amplify UI translation override */
    I18n.putVocabularies({
      ja: {
        Username: 'メールアドレス',
        'Enter your username': 'メールアドレスを入力',
        'Enter your Username': 'メールアドレスを入力',
        'Username cannot be empty': 'メールアドレスは入力必須です',
      },
    });
    /* eslint-enable i18nhelper/no-jp-string */
    I18n.setLanguage(i18n.language === 'ja' ? 'ja' : 'en');
  }, [i18n.language]);

  return (
    <Authenticator
      hideSignUp={!selfSignUpEnabled}
      components={{
        Header: () => (
          <div className="text-aws-font-color mb-5 mt-10 flex justify-center text-3xl">
            {t('auth.title')}
          </div>
        ),
      }}>
      {props.children}
    </Authenticator>
  );
};

export default AuthWithUserpool;
