# Tasks: Maintenance Mode Implementation

## Phase 1: Infrastructure Setup

### Task 1.1: Create MaintenanceMode CDK Construct
- [x] Create new file `packages/cdk/lib/construct/maintenance-mode.ts`
- [x] Define `MaintenanceModeProps` interface with required properties
- [x] Implement construct class extending `Construct`
- [x] Export KVS ARN and maintenance bucket name as public properties

**Validation**: Construct compiles without errors and exports are accessible

**Dependencies**: None

### Task 1.2: Implement S3 Bucket for Maintenance Assets
- [x] Create private S3 bucket with versioning enabled
- [x] Enable server-side encryption (AES-256)
- [x] Configure bucket policy for CloudFront OAI access only
- [x] Set removal policy appropriately (retain for production)
- [x] Export bucket name as CDK output

**Validation**:
- `cdk synth` shows bucket resource with correct properties
- Bucket policy restricts access to OAI only

**Dependencies**: Task 1.1

### Task 1.3: Implement CloudFront KeyValueStore
- [x] Create CloudFront KeyValueStore resource in CDK
- [x] Export KVS ARN as CDK output
- [x] Document manual initialization requirement (AWS SDK for KVS not available in AwsCustomResource)

**Note**: KVS initialization changed from automatic to manual due to CloudFront KeyValueStore API not being available through CDK AwsCustomResource. Users must initialize the KVS manually after deployment using AWS CLI commands documented in `docs/MAINTENANCE_MODE.md`.

**Validation**:
- `cdk synth` shows KVS resource
- Deploy and verify KVS exists in AWS Console
- Manual initialization via AWS CLI works as documented

**Dependencies**: Task 1.1

### Task 1.4: Create CloudFront Origin Access Identity
- [x] Create OAI for maintenance bucket access
- [x] Grant OAI read permissions in bucket policy
- [x] Associate OAI with CloudFront distribution

**Validation**: CloudFront can access maintenance bucket objects via OAI

**Dependencies**: Task 1.2

## Phase 2: CloudFront Functions

### Task 2.1: Implement ViewerRequest Function Code
- [x] Create JavaScript file for ViewerRequest function (e.g., `packages/cdk/cloudfront-functions/viewer-request.js`)
- [x] Implement KVS read logic for `maintenance` and `ipWhitelist` keys
- [x] Implement IP parsing from comma-separated string
- [x] Implement IP comparison logic (exact string match for IPv4/IPv6)
- [x] Implement redirect logic to `/maintenance.html` for non-whitelisted IPs
- [x] Add redirect loop prevention (allow `/maintenance.html` and `/maintenance.css`)
- [x] Add error handling (fail open on KVS errors)
- [x] Add logging for errors and key decisions
- [x] Use placeholder `"KVS_ID"` for KeyValueStore ID

**Validation**:
- Function code is under 10KB
- Logic handles all scenarios from spec
- Error handling tested

**Dependencies**: None (can be developed in parallel)

### Task 2.2: Implement ViewerResponse Function Code
- [x] Create JavaScript file for ViewerResponse function (e.g., `packages/cdk/cloudfront-functions/viewer-response.js`)
- [x] Detect responses for `/maintenance.html` and `/maintenance.css`
- [x] Set status code to 503 for maintenance paths
- [x] Add `Retry-After: 3600` header
- [x] Pass through other responses unchanged

**Validation**:
- Function code is under 10KB
- 503 status set correctly for maintenance paths

**Dependencies**: None (can be developed in parallel)

### Task 2.3: Deploy CloudFront Functions via CDK
- [x] Read ViewerRequest function code from file
- [x] Replace `"KVS_ID"` placeholder with actual KeyValueStore ID
- [x] Create CloudFront Function resource for ViewerRequest
- [x] Create CloudFront Function resource for ViewerResponse
- [x] Ensure functions are created before distribution association

**Validation**: `cdk synth` shows CloudFront Function resources with injected KVS ID

**Dependencies**: Task 1.3, Task 2.1, Task 2.2

## Phase 3: CloudFront Distribution Integration

### Task 3.1: Add Maintenance Bucket as CloudFront Origin
- [x] Modify `packages/cdk/lib/construct/web.ts` to accept maintenance mode props
- [x] Add maintenance S3 bucket as additional origin to CloudFront distribution
- [x] Configure origin with OAI authentication
- [x] Set appropriate origin path and behaviors

**Validation**: CloudFront distribution has two origins (main app + maintenance)

**Dependencies**: Task 1.2, Task 1.4

### Task 3.2: Associate CloudFront Functions with Distribution
- [x] Attach ViewerRequest function to distribution's default behavior
- [x] Attach ViewerResponse function to distribution's default behavior
- [x] Configure function associations for appropriate event types
- [x] Ensure functions execute for all requests

**Validation**:
- `cdk synth` shows function associations in distribution config
- Deploy and verify in CloudFront console

**Dependencies**: Task 2.3, Task 3.1

### Task 3.3: Configure Cache Behaviors for Maintenance Assets
- [x] Set cache policy for `/maintenance.html`: no-cache
- [x] Set cache policy for `/maintenance.css`: max-age=3600
- [x] Configure proper headers for maintenance responses

**Validation**: Cache headers are correct in CloudFront console

**Dependencies**: Task 3.1

## Phase 4: Maintenance Page Assets

### Task 4.1: Create maintenance.html
- [x] Design HTML structure with semantic elements
- [x] Include GenU branding elements
- [x] Add clear maintenance message
- [x] Link to external CSS file (`<link href="/maintenance.css">`)
- [x] Add meta viewport for mobile responsiveness
- [x] Ensure valid HTML5 document structure
- [x] Test accessibility (semantic HTML, alt text if images used)

**Validation**:
- HTML validates with W3C validator
- Page is mobile-responsive
- Branding is consistent with GenU

**Dependencies**: None (can be developed in parallel)

### Task 4.2: Create maintenance.css
- [x] Style page with GenU brand colors
- [x] Implement responsive design (mobile, tablet, desktop)
- [x] Ensure WCAG AA color contrast compliance
- [x] Use GenU-consistent fonts
- [x] Add loading state handling if needed

**Validation**:
- CSS renders correctly on all viewport sizes
- Color contrast meets WCAG AA standards

**Dependencies**: Task 4.1

### Task 4.3: Deploy Initial Maintenance Assets to S3
- [x] Upload `maintenance.html` to maintenance S3 bucket root
- [x] Upload `maintenance.css` to maintenance S3 bucket root
- [x] Set proper content-types for each file
- [x] Configure metadata if needed
- [x] Consider using CDK's `BucketDeployment` for automated upload

**Validation**:
- Files are accessible via CloudFront (when maintenance mode enabled)
- CSS loads correctly when HTML is accessed

**Dependencies**: Task 1.2, Task 4.1, Task 4.2

## Phase 5: Integration and Stack Wiring

### Task 5.1: Integrate MaintenanceMode into Main Stack
- [x] Modify `packages/cdk/lib/create-stacks.ts` or appropriate stack file
- [x] Instantiate MaintenanceMode construct
- [x] Pass CloudFront distribution from Web construct to MaintenanceMode
- [x] Wire up dependencies between constructs
- [x] Add CloudFormation outputs for KVS ARN and maintenance bucket name

**Validation**: `cdk synth` succeeds with no circular dependencies

**Dependencies**: Task 1.1, Task 3.2

### Task 5.2: Handle CDK Stack Parameters
- [x] Add optional parameter to enable/disable maintenance mode feature (if desired)
- [x] Update `packages/cdk/parameter.ts` if feature flag needed
- [x] Ensure backward compatibility with existing deployments

**Validation**: Feature flag works correctly if implemented

**Dependencies**: Task 5.1

## Phase 6: Testing

**Note**: These tests will be performed after deployment to a test/staging environment.

### Task 6.1: Unit Test CloudFront Function Logic
- [ ] Write tests for ViewerRequest IP parsing
- [ ] Write tests for ViewerRequest redirect logic
- [ ] Write tests for ViewerRequest whitelist matching
- [ ] Write tests for ViewerResponse status code logic
- [ ] Mock KVS responses for different scenarios
- [ ] Test error handling paths

**Validation**: All unit tests pass

**Dependencies**: Task 2.1, Task 2.2

**Status**: Deferred - Test infrastructure not yet in place

### Task 6.2: Integration Test in Non-Production Environment
- [ ] Deploy stack to development/staging AWS account
- [ ] Verify KVS contains initial keys
- [ ] Test activating maintenance mode via Console
- [ ] Test deactivating maintenance mode via Console
- [ ] Test IP whitelisting with known test IPs
- [ ] Verify 503 status codes during maintenance
- [ ] Test CSS loading on maintenance page
- [ ] Measure propagation time (should be < 60 seconds)
- [ ] Test redirect loop prevention
- [ ] Simulate KVS errors (if possible) and verify fail-open behavior

**Validation**:
- All integration test scenarios pass
- Propagation time meets < 60 second requirement

**Dependencies**: All previous tasks in Phases 1-5

**Status**: To be performed during deployment to staging

### Task 6.3: Load Test Maintenance Mode Activation
- [ ] Use load testing tool to generate traffic
- [ ] Activate maintenance mode during load test
- [ ] Measure impact on request latency
- [ ] Verify CloudFront Functions don't introduce significant overhead
- [ ] Monitor CloudWatch metrics during test

**Validation**: Latency impact < 2ms per request

**Dependencies**: Task 6.2

**Status**: To be performed during deployment to staging

## Phase 7: Documentation

### Task 7.1: Create Operator Documentation
- [x] Write `docs/MAINTENANCE_MODE.md` with:
  - How to activate maintenance mode (step-by-step with screenshots)
  - How to deactivate maintenance mode
  - How to update IP whitelist
  - Expected propagation times
  - Troubleshooting common issues
  - Emergency rollback procedures
- [x] Include AWS Console navigation instructions
- [x] Add FAQ section

**Validation**: Non-technical operator can follow instructions to toggle maintenance mode

**Dependencies**: Task 6.2 (need to verify steps work)

### Task 7.2: Create User-Facing Documentation
- [x] Write `docs/HOW_MAINTENANCE_MODE_WORKS.md` for non-contributors:
  - High-level system explanation
  - Architecture diagrams
  - What happens during maintenance mode
  - How administrators can access during maintenance
  - FAQ for end users
- [x] Use simple language and visual aids

**Validation**: Non-contributor can understand the system without technical background

**Dependencies**: None (can be written in parallel)

### Task 7.3: Update Developer Documentation
- [x] Update `README.md` or `CONTRIBUTING.md` with:
  - Maintenance mode feature overview
  - How to modify CloudFront Functions
  - How to update maintenance page assets
  - CDK construct usage
  - Testing procedures
- [x] Document CDK construct API

**Validation**: Developer can modify maintenance mode components using docs

**Dependencies**: Task 5.1

### Task 7.4: Create Runbook for Operations Team
- [x] Create runbook with:
  - Pre-maintenance checklist
  - Activation procedure
  - Verification steps
  - Deactivation procedure
  - Rollback procedure
  - Incident response for issues during maintenance
- [x] Include decision tree for troubleshooting

**Validation**: Operations team reviews and approves runbook

**Dependencies**: Task 7.1

## Phase 8: Deployment and Validation

**Note**: These tasks will be completed during actual deployment to staging/production environments.

### Task 8.1: Production Deployment Plan
- [ ] Plan maintenance window for production deployment (if needed)
- [ ] Prepare rollback plan
- [ ] Notify stakeholders of new feature
- [ ] Review all CloudFormation changes before deployment
- [ ] Deploy to production

**Validation**: Deployment succeeds without errors

**Dependencies**: All previous tasks

### Task 8.2: Post-Deployment Smoke Tests
- [ ] Verify KVS exists with correct initial values
- [ ] Verify CloudFront Functions are associated
- [ ] Verify maintenance S3 bucket is accessible via CloudFront
- [ ] Test activating maintenance mode briefly (< 1 minute)
- [ ] Verify application returns to normal after deactivation
- [ ] Check CloudWatch Logs for function execution

**Validation**: All smoke tests pass

**Dependencies**: Task 8.1

### Task 8.3: Monitor for 24 Hours Post-Deployment
- [ ] Monitor CloudWatch metrics for errors
- [ ] Check CloudFront Function execution logs
- [ ] Monitor application performance metrics
- [ ] Be ready to rollback if issues arise

**Validation**: No anomalies detected in 24 hours

**Dependencies**: Task 8.2

## Phase 9: Final Documentation and Handoff

**Note**: These tasks will be completed after successful deployment and testing.

### Task 9.1: Conduct Training Session for Operations Team
- [ ] Schedule training session
- [ ] Walk through maintenance mode activation/deactivation
- [ ] Demonstrate IP whitelist management
- [ ] Review troubleshooting procedures
- [ ] Answer questions

**Validation**: Operations team confirms understanding

**Dependencies**: Task 8.2

### Task 9.2: Update Change Log and Release Notes
- [ ] Add maintenance mode feature to CHANGELOG
- [ ] Write release notes explaining new capability
- [ ] Document any breaking changes (if applicable)

**Validation**: Release notes are clear and complete

**Dependencies**: Task 8.1

### Task 9.3: Archive OpenSpec Change Proposal
- [ ] Run `openspec archive add-maintenance-mode --yes`
- [ ] Update `openspec/specs/` with finalized capability specs
- [ ] Verify archived change passes validation

**Validation**: `openspec validate --strict` passes

**Dependencies**: All tasks complete and deployed

---

## Task Dependencies Summary

```
Phase 1 (Infrastructure) → Phase 2 (Functions) can run in parallel
Phase 2 → Phase 3 (Integration)
Phase 3 → Phase 4 (Assets) can run in parallel
Phase 4 + Phase 3 → Phase 5 (Wiring)
Phase 5 → Phase 6 (Testing)
Phase 6 → Phase 7 (Docs)
Phase 7 → Phase 8 (Deployment)
Phase 8 → Phase 9 (Handoff)
```

## Parallel Work Opportunities

The following tasks can be worked on concurrently:
- **Task 2.1, 2.2** (Functions) parallel with **Task 1.1-1.4** (Infrastructure)
- **Task 4.1, 4.2** (HTML/CSS) parallel with **Tasks 1-3**
- **Task 7.2** (User docs) can start anytime
- **Task 6.1** (Unit tests) parallel with integration work
