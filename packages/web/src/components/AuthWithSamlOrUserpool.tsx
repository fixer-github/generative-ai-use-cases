import React, { useEffect, useState } from 'react';
import {
  Authenticator,
  Button,
  Loader,
  Text,
  translations,
  useAuthenticator,
} from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { signInWithRedirect } from 'aws-amplify/auth';
import { I18n } from 'aws-amplify/utils';
import { useTranslation } from 'react-i18next';

const selfSignUpEnabled: boolean =
  import.meta.env.VITE_APP_SELF_SIGN_UP_ENABLED === 'true';
const samlCognitoFederatedIdentityProviderName: string = import.meta.env
  .VITE_APP_SAML_COGNITO_FEDERATED_IDENTITY_PROVIDER_NAME;

type Props = {
  children: React.ReactNode;
};

const AuthWithSamlOrUserpool: React.FC<Props> = (props) => {
  const { t, i18n } = useTranslation();
  const { authStatus } = useAuthenticator((context) => [context.authStatus]);

  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authStatus === 'configuring') {
      setLoading(true);
      setAuthenticated(false);
    } else if (authStatus === 'authenticated') {
      setLoading(false);
      setAuthenticated(true);
    } else {
      setLoading(false);
      setAuthenticated(false);
    }
  }, [authStatus]);

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

  const signIn = () => {
    signInWithRedirect({
      provider: {
        custom: samlCognitoFederatedIdentityProviderName,
      },
    });
  };

  return (
    <>
      {loading ? (
        <div className="grid grid-cols-1 justify-items-center gap-4">
          <Text className="mt-12 text-center">{t('auth.loading')}</Text>
          <Loader width="5rem" height="5rem" />
        </div>
      ) : !authenticated ? (
        <div className="grid grid-cols-1 justify-items-center gap-4">
          <Text className="mt-12 text-center text-3xl">{t('auth.title')}</Text>
          <Authenticator
            hideSignUp={!selfSignUpEnabled}
            components={{
              Header: () => null,
            }}
          />
          <Button
            variation="primary"
            onClick={() => signIn()}
            className="mt-6 w-60">
            {t('auth.loginWith', {
              provider: samlCognitoFederatedIdentityProviderName,
            })}
          </Button>
        </div>
      ) : (
        <>{props.children}</>
      )}
    </>
  );
};

export default AuthWithSamlOrUserpool;
