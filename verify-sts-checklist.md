# STS Implementation Verification Checklist

## Post-Deployment Checks

- [ ] IAM Role created: `GenerativeAiUseCasesStack-MultiTenantAccessRole`
- [ ] Role trust policy includes `cognito-identity.amazonaws.com`
- [ ] CloudFormation stack shows role creation successful

## Frontend Configuration

- [ ] `VITE_APP_TENANT_ROLE_ARN` is set (not empty)
- [ ] `VITE_APP_USE_STS_TEMP_CREDENTIALS` is "true"
- [ ] Browser console shows no errors when loading

## User Configuration

- [ ] Test user has `custom:tenant_id` attribute set
- [ ] JWT token contains tenant ID in payload
- [ ] Pre-token generation Lambda is attached to user pool

## Runtime Verification

- [ ] Login successful with test user
- [ ] Network tab shows STS AssumeRoleWithWebIdentity calls
- [ ] API calls include AWS signature headers
- [ ] No 403 Forbidden errors for valid tenant resources

## Tenant Isolation Test

- [ ] User can access resources with matching tenant ID
- [ ] User cannot access resources with different tenant ID
- [ ] CloudTrail shows AssumeRole events with correct principal tags

## Debugging

If issues occur:

1. Check browser console for errors
2. Enable debug mode: `localStorage.setItem('STS_DEBUG', 'true')`
3. Check network tab for failed requests
4. Verify IAM role policies
5. Check CloudWatch logs for Lambda errors
