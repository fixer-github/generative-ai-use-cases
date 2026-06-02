import { Duration } from 'aws-cdk-lib';
import {
  CfnUserPoolGroup,
  Mfa,
  UserPool,
  UserPoolClient,
  UserPoolOperation,
} from 'aws-cdk-lib/aws-cognito';
import {
  IdentityPool,
  UserPoolAuthenticationProvider,
} from 'aws-cdk-lib/aws-cognito-identitypool';
import {
  Effect,
  Policy,
  PolicyStatement,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';

export interface AuthProps {
  readonly selfSignUpEnabled: boolean;
  readonly allowedIpV4AddressRanges?: string[] | null;
  readonly allowedIpV6AddressRanges?: string[] | null;
  readonly allowedSignUpEmailDomains?: string[] | null;
  readonly mfaRequired: boolean;
  readonly samlAuthEnabled: boolean;
  // SendGrid email (shared with the scheduler). When both are set and we are
  // not in closed-network mode, Cognito's user emails (verification codes,
  // admin invitations, password resets, etc.) are delivered via SendGrid
  // through a Custom Email Sender Lambda. Otherwise Cognito's default email
  // is used.
  readonly sendgridApiKey?: string | null;
  readonly mailFrom?: string | null;
  readonly closedNetworkMode?: boolean;
}

export class Auth extends Construct {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly idPool: IdentityPool;
  // Custom Email Sender Lambda (only set when SendGrid is enabled). Exposed so
  // the stack can inject the app's login URL via addEnvironment after the Web
  // construct (which determines the URL) has been created — the Web construct
  // depends on this Auth construct, so the URL is not available here yet.
  readonly customEmailSenderFunction?: NodejsFunction;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    // Deliver Cognito's user emails via SendGrid only when it is configured
    // and we have internet egress (not closed-network mode).
    const sendGridEnabled =
      !props.closedNetworkMode && !!props.sendgridApiKey && !!props.mailFrom;

    // Validity period of temporary passwords issued by AdminCreateUser. Set
    // explicitly (rather than relying on Cognito's 7-day default) so the
    // "valid for N days" wording in the SendGrid invitation email always
    // matches the actual expiry. The same value is passed to the Custom Email
    // Sender Lambda via an environment variable.
    const tempPasswordValidityDays = 7;

    // KMS key used by Cognito to encrypt verification codes / temporary
    // passwords before handing them to the Custom Email Sender Lambda, which
    // decrypts them to compose the SendGrid message.
    const customEmailSenderKey = sendGridEnabled
      ? new kms.Key(this, 'CustomEmailSenderKey', {
          enableKeyRotation: true,
        })
      : undefined;

    const userPool = new UserPool(this, 'UserPool', {
      // If SAML authentication is enabled, do not use self-sign-up with UserPool. Be aware of security.
      selfSignUpEnabled: props.samlAuthEnabled
        ? false
        : props.selfSignUpEnabled,
      signInAliases: {
        username: false,
        email: true,
      },
      passwordPolicy: {
        requireUppercase: true,
        requireSymbols: true,
        requireDigits: true,
        minLength: 8,
        tempPasswordValidity: Duration.days(tempPasswordValidityDays),
      },
      // Use Mfa.OPTIONAL and enforce MFA at the application level.
      // Mfa.REQUIRED causes AdminSetUserMFAPreference to be ignored,
      // so we use OPTIONAL and force setup on the frontend when MFA is not configured.
      mfa: props.mfaRequired ? Mfa.OPTIONAL : Mfa.OFF,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
      customSenderKmsKey: customEmailSenderKey,
    });

    const client = userPool.addClient('client', {
      idTokenValidity: Duration.days(1),
    });

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
    if (props.allowedSignUpEmailDomains) {
      const checkEmailDomainFunction = new NodejsFunction(
        this,
        'CheckEmailDomain',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry: './lambda/checkEmailDomain.ts',
          timeout: Duration.minutes(15),
          environment: {
            ALLOWED_SIGN_UP_EMAIL_DOMAINS_STR: JSON.stringify(
              props.allowedSignUpEmailDomains
            ),
          },
        }
      );

      userPool.addTrigger(
        UserPoolOperation.PRE_SIGN_UP,
        checkEmailDomainFunction
      );
    }

    // Custom Email Sender: route all Cognito user emails through SendGrid.
    if (sendGridEnabled && customEmailSenderKey) {
      const customEmailSenderFunction = new NodejsFunction(
        this,
        'CustomEmailSender',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry: './lambda/customEmailSender.ts',
          timeout: Duration.seconds(30),
          environment: {
            SENDGRID_API_KEY: props.sendgridApiKey!,
            MAIL_FROM: props.mailFrom!,
            KMS_KEY_ARN: customEmailSenderKey.keyArn,
            TEMP_PASSWORD_VALIDITY_DAYS: tempPasswordValidityDays.toString(),
          },
          bundling: {
            nodeModules: ['@aws-crypto/client-node'],
          },
        }
      );

      // The Lambda decrypts the codes; Cognito encrypts them.
      customEmailSenderKey.grantDecrypt(customEmailSenderFunction);
      customEmailSenderKey.grantEncrypt(
        new ServicePrincipal('cognito-idp.amazonaws.com')
      );

      userPool.addTrigger(
        UserPoolOperation.CUSTOM_EMAIL_SENDER,
        customEmailSenderFunction
      );

      this.customEmailSenderFunction = customEmailSenderFunction;
    }

    // Admin group
    new CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'admin',
      description: 'Administrator group with user management privileges',
    });

    this.client = client;
    this.userPool = userPool;
    this.idPool = idPool;
  }
}
