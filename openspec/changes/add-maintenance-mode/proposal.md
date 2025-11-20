# Proposal: Add Maintenance Mode

## Change ID
`add-maintenance-mode`

## Summary
Implement a fast-activating maintenance mode system for GenU that displays a maintenance page to users during system maintenance while allowing IP-whitelisted administrators to access the application. The system uses CloudFront Functions with KeyValueStore for near-instant activation (< 1 minute) compared to the current 10+ minute deployment process.

## Why
Currently, deploying infrastructure changes takes over 10 minutes, making maintenance windows unnecessarily long and prone to human error. A dedicated maintenance mode system provides:

1. **Fast Activation**: Toggle maintenance mode in under 1 minute vs 10+ minute deployment
2. **Reduced Errors**: Simple toggle mechanism reduces human error during maintenance
3. **Admin Access**: IP whitelisting allows administrators to verify functionality during maintenance
4. **Better UX**: Users see a clear maintenance message instead of errors

Reference implementation: [CloudFront Functions maintenance mode](https://zenn.dev/nekoniki/articles/e72e30171bebba)

## Requirements

### Must Have
- CloudFront Functions to intercept requests and serve maintenance page
- KeyValueStore for storing maintenance state and IP whitelist
- Separate S3 bucket for maintenance page assets (HTML, CSS)
- Static maintenance page with separate CSS file
- Console-based activation (edit KeyValueStore values directly)
- IP whitelist stored in KeyValueStore, independent from existing WAF rules
- 503 status code returned to non-whitelisted clients during maintenance
- Documentation for non-contributors explaining how the system works

### Should Have
- Maintenance mode toggleable via simple KeyValueStore value change
- Maintenance page visually consistent with GenU branding
- Clear instructions in documentation for activating/deactivating maintenance mode
- CDK infrastructure as code for all components

### Could Have
- CLI script to simplify KeyValueStore updates
- Lambda function for programmatic maintenance mode toggling
- Maintenance mode status indicator in admin dashboard

### Won't Have (Out of Scope)
- Automated maintenance mode scheduling
- Multi-region maintenance coordination
- Advanced maintenance page features (countdown timer, status updates)
- Integration with existing monitoring/alerting systems

## Impact

### Users
- **During Maintenance**: See clear maintenance page instead of errors (503 status)
- **Normal Operation**: No impact on performance or functionality

### Administrators
- **Activation**: Change KeyValueStore value in AWS Console (< 1 minute)
- **Access**: Can access application during maintenance if IP is whitelisted
- **Learning Curve**: Need to understand KeyValueStore and CloudFront Functions basics

### System
- **New Resources**: CloudFront Functions (2), KeyValueStore, S3 bucket for maintenance page
- **Existing Resources**: CloudFront distribution configuration modified to attach functions
- **Performance**: Negligible impact (CloudFront Functions run at edge with sub-millisecond latency)
- **Cost**: Minimal incremental cost (~$0.10/month for KeyValueStore, CloudFront Functions priced per invocation)

## Dependencies
- AWS CDK v2.118.0+ (for KeyValueStore support)
- Existing CloudFront distribution (in `packages/cdk/lib/construct/web.ts`)
- AWS account with CloudFront and KeyValueStore permissions

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Misconfigured IP whitelist locks out admins | High | Document multiple ways to update KVS; provide CloudFormation rollback procedure |
| CloudFront Function errors break entire site | Critical | Thorough testing in non-prod; implement error handling to fail open |
| KVS eventual consistency causes state mismatch | Medium | Use CloudFront cache invalidation when toggling mode; document expected propagation time |
| Maintenance page assets fail to load | Medium | Use inline CSS fallback; test S3 bucket accessibility from CloudFront |

## Success Criteria
- Maintenance mode activates/deactivates in < 60 seconds
- IP-whitelisted administrators can access application during maintenance
- Non-whitelisted users receive 503 status with maintenance page
- Zero configuration errors when toggling maintenance mode via documented process
- Complete documentation enables non-contributors to understand and use the system

## Alternatives Considered

### 1. Lambda@Edge
**Rejected**: Higher latency and cost compared to CloudFront Functions; requires full Lambda deployment for simple toggle logic.

### 2. Reuse Existing WAF IP Restrictions
**Rejected**: User specified separate whitelist needed; mixing concerns makes IP management confusing.

### 3. Static Maintenance Page in Main S3 Bucket
**Rejected**: User specified separate S3 bucket for better isolation and independent deployment lifecycle.

## Related Changes
None (initial implementation)

## Approval Checklist
- [ ] Requirements are clear and unambiguous
- [ ] Impact on existing functionality is documented
- [ ] Risks have mitigation strategies
- [ ] Success criteria are measurable
- [ ] Documentation plan is included
