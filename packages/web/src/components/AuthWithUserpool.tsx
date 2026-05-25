import { Amplify } from 'aws-amplify';
import { Authenticator, translations } from '@aws-amplify/ui-react';
import { I18n } from 'aws-amplify/utils';
import React from 'react';
import { useTranslation } from 'react-i18next';
import MfaSetupEnforcer from './MfaSetupEnforcer';

const selfSignUpEnabled: boolean =
  import.meta.env.VITE_APP_SELF_SIGN_UP_ENABLED === 'true';
const speechToSpeechEventApiEndpoint: string = import.meta.env
  .VITE_APP_SPEECH_TO_SPEECH_EVENT_API_ENDPOINT;
const cognitoUserPoolProxyEndpoint = import.meta.env
  .VITE_APP_COGNITO_USER_POOL_PROXY_ENDPOINT;
const cognitoIdentityPoolProxyEndpoint = import.meta.env
  .VITE_APP_COGNITO_IDENTITY_POOL_PROXY_ENDPOINT;

type Props = {
  children: React.ReactNode;
};
const AuthWithUserpool: React.FC<Props> = (props) => {
  const { t, i18n } = useTranslation();

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_APP_USER_POOL_ID,
        userPoolClientId: import.meta.env.VITE_APP_USER_POOL_CLIENT_ID,
        identityPoolId: import.meta.env.VITE_APP_IDENTITY_POOL_ID,
        ...(cognitoUserPoolProxyEndpoint && cognitoIdentityPoolProxyEndpoint
          ? {
              userPoolEndpoint: cognitoUserPoolProxyEndpoint,
              identityPoolEndpoint: cognitoIdentityPoolProxyEndpoint,
              region: import.meta.env.VITE_APP_REGION,
            }
          : {}),
      },
    },
    API: {
      Events: {
        endpoint: speechToSpeechEventApiEndpoint,
        region: process.env.VITE_APP_REGION!,
        defaultAuthMode: 'userPool',
      },
    },
  });

  I18n.putVocabularies(translations);
  I18n.setLanguage(i18n.language === 'ja' ? 'ja' : 'en');

  return (
    <Authenticator
      hideSignUp={!selfSignUpEnabled}
      formFields={{
        setupTotp: {
          QR: {
            totpIssuer: 'GaiXer',
          },
        },
      }}
      components={{
        Header: () => (
          <div className="text-aws-font-color mb-5 mt-10 flex justify-center text-3xl">
            {t('auth.title')}
          </div>
        ),
        SetupTotp: {
          Header() {
            return (
              <div className="mb-4 text-center">
                <h2 className="text-aws-font-color text-lg font-semibold">
                  {t('auth.mfa.setup_title')}
                </h2>
                <p className="mt-2 text-sm text-gray-600">
                  {t('auth.mfa.setup_description')}
                </p>
                <ol className="marker:text-aws-sky mt-3 list-inside list-decimal space-y-1 text-left text-sm text-gray-700 marker:font-semibold">
                  <li>{t('auth.mfa.setup_step1')}</li>
                  <li>{t('auth.mfa.setup_step2')}</li>
                </ol>
              </div>
            );
          },
        },
        ConfirmSignIn: {
          Header() {
            return (
              <div className="mb-4 text-center">
                <h2 className="text-aws-font-color text-lg font-semibold">
                  {t('auth.mfa.confirm_title')}
                </h2>
                <p className="mt-2 text-sm text-gray-600">
                  {t('auth.mfa.confirm_description')}
                </p>
              </div>
            );
          },
        },
      }}>
      <MfaSetupEnforcer>{props.children}</MfaSetupEnforcer>
    </Authenticator>
  );
};

export default AuthWithUserpool;
