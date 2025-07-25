import { Duration } from 'aws-cdk-lib';
import {
  UserPool,
  UserPoolClient,
  UserPoolOperation,
  UserPoolDomain,
  UserPoolIdentityProviderSaml,
  UserPoolIdentityProviderOidc,
  OidcAttributeRequestMethod,
  UserPoolIdentityProviderSamlMetadata,
  UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';
import {
  IdentityPool,
  UserPoolAuthenticationProvider,
} from 'aws-cdk-lib/aws-cognito-identitypool';
import { Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';

export interface FederatedIdentityProvider {
  name: string;
  type: 'SAML' | 'OIDC';
  enabled: boolean;
  metadataUrl?: string;
  metadataDocument?: string;
  attributeMapping?: Record<string, string>;
  clientId?: string;
  clientSecret?: string;
  issuerUrl?: string;
  scopes?: string[];
}

export interface AuthProviders {
  cognitoUserPool?: {
    enabled: boolean;
    selfSignUpEnabled: boolean;
    allowedSignUpEmailDomains?: string[] | null;
  };
  federatedIdentityProviders: FederatedIdentityProvider[];
}

export interface AuthProps {
  readonly selfSignUpEnabled: boolean;
  readonly allowedIpV4AddressRanges?: string[] | null;
  readonly allowedIpV6AddressRanges?: string[] | null;
  readonly allowedSignUpEmailDomains?: string[] | null;
  readonly samlAuthEnabled: boolean;
  // New auth configuration
  readonly authProviders?: AuthProviders | null;
  readonly cognitoDomainPrefix?: string | null;
  readonly webUrl?: string;
}

export class Auth extends Construct {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly idPool: IdentityPool;
  readonly userPoolDomain?: UserPoolDomain;
  readonly federatedProviders: (UserPoolIdentityProviderSaml | UserPoolIdentityProviderOidc)[] = [];

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    // Determine auth configuration (support both legacy and new format)
    const useNewAuthConfig = props.authProviders !== null && props.authProviders !== undefined;
    const cognitoUserPoolEnabled = useNewAuthConfig 
      ? (props.authProviders?.cognitoUserPool?.enabled ?? true)
      : !props.samlAuthEnabled;
    const selfSignUpEnabled = useNewAuthConfig
      ? (props.authProviders?.cognitoUserPool?.selfSignUpEnabled ?? props.selfSignUpEnabled)
      : props.selfSignUpEnabled;
    const allowedSignUpEmailDomains = useNewAuthConfig
      ? (props.authProviders?.cognitoUserPool?.allowedSignUpEmailDomains ?? props.allowedSignUpEmailDomains)
      : props.allowedSignUpEmailDomains;

    const userPool = new UserPool(this, 'UserPool', {
      // Disable self-sign-up if only federated providers are enabled
      selfSignUpEnabled: cognitoUserPoolEnabled ? selfSignUpEnabled : false,
      signInAliases: {
        username: false,
        email: true,
      },
      passwordPolicy: {
        requireUppercase: true,
        requireSymbols: true,
        requireDigits: true,
        minLength: 8,
      },
    });

    // Create Cognito Domain if needed for federated auth
    const needsDomain = useNewAuthConfig 
      ? props.authProviders?.federatedIdentityProviders.some(idp => idp.enabled)
      : props.samlAuthEnabled;
    
    if (needsDomain && props.cognitoDomainPrefix) {
      this.userPoolDomain = new UserPoolDomain(this, 'UserPoolDomain', {
        userPool,
        cognitoDomain: {
          domainPrefix: props.cognitoDomainPrefix,
        },
      });
    }

    // Create client first
    const client = userPool.addClient('client', {
      idTokenValidity: Duration.days(1),
      oAuth: needsDomain ? {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [{
          scopeName: 'openid',
        }, {
          scopeName: 'email',
        }, {
          scopeName: 'profile',
        }],
        callbackUrls: [
          'http://localhost:5173', 
          'https://localhost:5173',
          ...(props.webUrl ? [props.webUrl] : [])
        ],
      } : undefined,
    });

    // Add federated identity providers after client creation
    if (useNewAuthConfig && props.authProviders?.federatedIdentityProviders) {
      for (const provider of props.authProviders.federatedIdentityProviders) {
        if (!provider.enabled) continue;

        if (provider.type === 'SAML') {
          const samlProvider = new UserPoolIdentityProviderSaml(this, `SamlProvider-${provider.name}`, {
            userPool,
            name: provider.name,
            metadata: provider.metadataUrl
              ? UserPoolIdentityProviderSamlMetadata.url(provider.metadataUrl)
              : UserPoolIdentityProviderSamlMetadata.file(provider.metadataDocument!),
            attributeMapping: {
              email: { attributeName: provider.attributeMapping?.email || 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress' },
              ...(provider.attributeMapping && Object.entries(provider.attributeMapping)
                .filter(([key]) => key !== 'email')
                .reduce((acc, [key, value]) => ({
                  ...acc,
                  [key]: { attributeName: value }
                }), {}))
            },
          });
          this.federatedProviders.push(samlProvider);
          // Register the provider with the client
          client.node.addDependency(samlProvider);
        } else if (provider.type === 'OIDC') {
          const oidcProvider = new UserPoolIdentityProviderOidc(this, `OidcProvider-${provider.name}`, {
            userPool,
            name: provider.name,
            clientId: provider.clientId!,
            clientSecret: provider.clientSecret!,
            issuerUrl: provider.issuerUrl!,
            scopes: provider.scopes || ['openid', 'email', 'profile'],
            attributeRequestMethod: OidcAttributeRequestMethod.GET,
            attributeMapping: {
              email: { attributeName: provider.attributeMapping?.email || 'email' },
              ...(provider.attributeMapping && Object.entries(provider.attributeMapping)
                .filter(([key]) => key !== 'email')
                .reduce((acc, [key, value]) => ({
                  ...acc,
                  [key]: { attributeName: value }
                }), {}))
            },
          });
          this.federatedProviders.push(oidcProvider);
          // Register the provider with the client
          client.node.addDependency(oidcProvider);
        }
      }
    }

    const idPool = new IdentityPool(this, 'IdentityPool', {
      authenticationProviders: {
        userPools: [
          new UserPoolAuthenticationProvider({
            userPool,
            userPoolClient: client,
          }),
        ],
      },
    });

    if (props.allowedIpV4AddressRanges || props.allowedIpV6AddressRanges) {
      const ipRanges = [
        ...(props.allowedIpV4AddressRanges
          ? props.allowedIpV4AddressRanges
          : []),
        ...(props.allowedIpV6AddressRanges
          ? props.allowedIpV6AddressRanges
          : []),
      ];

      idPool.authenticatedRole.attachInlinePolicy(
        new Policy(this, 'SourceIpPolicy', {
          statements: [
            new PolicyStatement({
              effect: Effect.DENY,
              resources: ['*'],
              actions: ['*'],
              conditions: {
                NotIpAddress: {
                  'aws:SourceIp': ipRanges,
                },
              },
            }),
          ],
        })
      );
    }

    idPool.authenticatedRole.attachInlinePolicy(
      new Policy(this, 'PollyPolicy', {
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            resources: ['*'],
            actions: ['polly:SynthesizeSpeech'],
          }),
        ],
      })
    );

    // Lambda
    if (allowedSignUpEmailDomains) {
      const checkEmailDomainFunction = new NodejsFunction(
        this,
        'CheckEmailDomain',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry: './lambda/checkEmailDomain.ts',
          timeout: Duration.minutes(15),
          environment: {
            ALLOWED_SIGN_UP_EMAIL_DOMAINS_STR: JSON.stringify(
              allowedSignUpEmailDomains
            ),
          },
        }
      );

      userPool.addTrigger(
        UserPoolOperation.PRE_SIGN_UP,
        checkEmailDomainFunction
      );
    }

    this.client = client;
    this.userPool = userPool;
    this.idPool = idPool;
  }
}
