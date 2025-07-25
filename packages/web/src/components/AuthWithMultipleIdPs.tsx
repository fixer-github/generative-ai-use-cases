import React, { useEffect, useState, useMemo } from 'react';
import { Button, Text, Loader, useAuthenticator } from '@aws-amplify/ui-react';
import { Amplify } from 'aws-amplify';
import '@aws-amplify/ui-react/styles.css';
import { signInWithRedirect } from 'aws-amplify/auth';
import { useTranslation } from 'react-i18next';

interface FederatedIdentityProvider {
  name: string;
  type: 'SAML' | 'OIDC';
  enabled: boolean;
}

interface AuthProviders {
  cognitoUserPool?: {
    enabled: boolean;
  };
  federatedIdentityProviders?: FederatedIdentityProvider[];
}

const authProviders: AuthProviders | null = import.meta.env.VITE_APP_AUTH_PROVIDERS ? 
  JSON.parse(import.meta.env.VITE_APP_AUTH_PROVIDERS) : null;
const cognitoDomainPrefix = import.meta.env.VITE_APP_COGNITO_DOMAIN_PREFIX;
const cognitoDomainUrl = import.meta.env.VITE_APP_COGNITO_DOMAIN_URL;
const speechToSpeechEventApiEndpoint = import.meta.env
  .VITE_APP_SPEECH_TO_SPEECH_EVENT_API_ENDPOINT;

type Props = {
  children: React.ReactNode;
};

const AuthWithMultipleIdPs: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  const { authStatus } = useAuthenticator((context) => [context.authStatus]);

  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  // Determine enabled providers
  const cognitoUserPoolEnabled = authProviders?.cognitoUserPool?.enabled ?? true;
  const federatedProviders = useMemo(() => 
    authProviders?.federatedIdentityProviders?.filter(
      (idp) => idp.enabled
    ) || [], 
    []
  );

  useEffect(() => {
    // Verify the authentication status
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
    // Auto-redirect if only one federated IdP is enabled and Cognito User Pool is disabled
    if (!loading && !authenticated && !cognitoUserPoolEnabled && federatedProviders.length === 1) {
      signInWithRedirect({
        provider: {
          custom: federatedProviders[0].name,
        },
      });
    }
  }, [loading, authenticated, cognitoUserPoolEnabled, federatedProviders]);

  const signInWithProvider = (providerName: string) => {
    signInWithRedirect({
      provider: {
        custom: providerName,
      },
    });
  };

  // Configure Amplify
  const domainUrl = cognitoDomainUrl || 
    (cognitoDomainPrefix ? `${cognitoDomainPrefix}.auth.${process.env.VITE_APP_REGION}.amazoncognito.com` : '');

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_APP_USER_POOL_ID,
        userPoolClientId: import.meta.env.VITE_APP_USER_POOL_CLIENT_ID,
        identityPoolId: import.meta.env.VITE_APP_IDENTITY_POOL_ID,
        loginWith: federatedProviders.length > 0 ? {
          oauth: {
            domain: domainUrl,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [window.location.origin],
            redirectSignOut: [window.location.origin],
            responseType: 'code',
          },
        } : undefined,
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
          
          {/* Show Cognito User Pool login if enabled */}
          {cognitoUserPoolEnabled && (
            <>
              {/* This will be handled by the Authenticator component in parent */}
            </>
          )}
          
          {/* Show federated IdP login buttons */}
          {federatedProviders.map((provider) => (
            <Button
              key={provider.name}
              variation="primary"
              onClick={() => signInWithProvider(provider.name)}
              className="mt-4 w-60">
              {t('auth.loginWith', { provider: provider.name })}
            </Button>
          ))}
        </div>
      ) : (
        <>{props.children}</>
      )}
    </>
  );
};

export default AuthWithMultipleIdPs;