# Maintenance Mode Operations Guide

This guide explains how to activate, deactivate, and manage the maintenance mode system for GenU.

## Overview

The maintenance mode system allows you to display a maintenance page to users during system maintenance while allowing IP-whitelisted administrators to continue accessing the application. This system activates in under 60 seconds compared to the 10+ minute deployment process.

## First-Time Setup (Post-Deployment)

After deploying the stack with maintenance mode, you must initialize the KeyValueStore manually:

### Step 1: Get the KVS ARN

Find the KeyValueStore ARN from CloudFormation stack outputs:
```bash
aws cloudformation describe-stacks --stack-name <YOUR_STACK_NAME> \
  --query "Stacks[0].Outputs[?OutputKey=='MaintenanceKVSArn'].OutputValue" \
  --output text
```

Or check the AWS CloudFormation console under the stack outputs.

### Step 2: Get the Current ETag

```bash
aws cloudfront-keyvaluestore describe-key-value-store \
  --kvs-arn <KVS_ARN_FROM_STEP_1>
```

Note the `ETag` value from the response.

### Step 3: Initialize the Keys

Initialize the `maintenance` key (use the ETag from Step 2):
```bash
aws cloudfront-keyvaluestore put-key \
  --kvs-arn <KVS_ARN> \
  --key maintenance \
  --value false \
  --if-match <ETAG>
```

Get the new ETag:
```bash
aws cloudfront-keyvaluestore describe-key-value-store \
  --kvs-arn <KVS_ARN>
```

Initialize the `ipWhitelist` key (use the new ETag):
```bash
aws cloudfront-keyvaluestore put-key \
  --kvs-arn <KVS_ARN> \
  --key ipWhitelist \
  --value "" \
  --if-match <NEW_ETAG>
```

**Note**: The ETag changes with each update, so you must get the latest ETag before each `put-key` operation.

### Step 4: Verify Initialization

```bash
aws cloudfront-keyvaluestore list-keys --kvs-arn <KVS_ARN>
```

You should see both `maintenance` and `ipWhitelist` keys listed.

---

## Architecture

The system uses:
- **CloudFront Functions**: Intercept requests and redirect to maintenance page
- **KeyValueStore (KVS)**: Stores maintenance state and IP whitelist
- **S3 Bucket**: Hosts maintenance page assets (HTML and CSS)
- **CloudFront Distribution**: Serves maintenance page with 503 status code

## Activating Maintenance Mode

### Step 1: Locate the KeyValueStore

1. Log in to the AWS Console
2. Navigate to **CloudFront** service
3. In the left sidebar, click **Key value stores**
4. Find the store named **MaintenanceModeStore**
   - You can also use the KVS ARN from the CloudFormation stack outputs (look for `MaintenanceModeKVSArn`)

### Step 2: Enable Maintenance Mode

1. Click on the **MaintenanceModeStore** name
2. Click the **Keys** tab
3. Find the key named **maintenance**
4. Click **Edit** next to the maintenance key
5. Change the value from `false` to `true`
6. Click **Save changes**

### Step 3: Verify Activation

1. Wait approximately 30-60 seconds for the change to propagate to all CloudFront edge locations
2. Open a new browser window (or incognito/private window to avoid cache)
3. Navigate to your application URL
4. You should see the maintenance page with a 503 status code
   - You can verify the status code using browser developer tools (Network tab)

## Deactivating Maintenance Mode

### Step 1: Access KeyValueStore

Follow the same steps as activation to locate and open the **MaintenanceModeStore**.

### Step 2: Disable Maintenance Mode

1. Click the **Keys** tab
2. Find the key named **maintenance**
3. Click **Edit**
4. Change the value from `true` to `false`
5. Click **Save changes**

### Step 3: Verify Deactivation

1. Wait approximately 30-60 seconds for propagation
2. Refresh your browser (or open a new window)
3. You should now see the normal application
4. Verify users can access and use the application normally

## Managing IP Whitelist

The IP whitelist allows specific IP addresses to bypass maintenance mode and access the application normally.

### Step 1: Update Whitelist

1. Navigate to **CloudFront** → **Key value stores** → **MaintenanceModeStore**
2. Click the **Keys** tab
3. Find the key named **ipWhitelist**
4. Click **Edit**
5. Enter comma-separated IP addresses (no spaces):
   ```
   203.0.113.1,198.51.100.42,192.0.2.10
   ```
6. Supports both IPv4 and IPv6 addresses
7. Click **Save changes**

### Step 2: Test Whitelist Access

1. Activate maintenance mode (if not already active)
2. From a whitelisted IP address, navigate to the application
3. You should see the normal application (not the maintenance page)
4. From a non-whitelisted IP, you should see the maintenance page

### Finding Your IP Address

To find your current IP address:
- Visit https://api.ipify.org or https://checkip.amazonaws.com
- Or use command line: `curl https://checkip.amazonaws.com`

## Propagation Time

- **KeyValueStore updates**: 30-60 seconds to all edge locations
- **During this time**: Some users may see maintenance page while others see the application
- **Recommendation**: Plan for up to 2 minutes for complete global propagation

## Troubleshooting

### Maintenance Mode Not Activating

**Problem**: Changed `maintenance` to `true` but users still see the application

**Solutions**:
1. Verify the value is exactly `true` (lowercase, no quotes in the value field)
2. Wait the full 60 seconds for propagation
3. Clear browser cache or use incognito/private window
4. Check CloudWatch Logs for CloudFront Function errors:
   - Navigate to CloudWatch → Log groups
   - Look for logs related to CloudFront Functions
   - Check for any errors in function execution

### Cannot Access Application from Whitelisted IP

**Problem**: IP is in whitelist but still seeing maintenance page

**Solutions**:
1. Verify IP address is correct (use https://checkip.amazonaws.com)
2. Ensure no spaces in the IP whitelist value
3. Check the format: `ip1,ip2,ip3` (comma-separated, no spaces)
4. Verify maintenance mode is actually enabled (`maintenance=true`)
5. Wait 60 seconds after updating the whitelist

### Accidentally Locked Out

**Problem**: Enabled maintenance mode but cannot access to disable it

**Solutions**:
1. **Access from different network**: Use VPN or mobile hotspot to get a different IP address
2. **Add your current IP**: Update `ipWhitelist` from AWS Console using a different network
3. **Emergency rollback**: Contact AWS administrator to:
   - Update KeyValueStore via AWS CLI:
     ```bash
     aws cloudfront-keyvaluestore update-keys \
       --kvs-arn <KVS_ARN> \
       --puts Key=maintenance,Value=false
     ```
   - Or remove CloudFront Function associations via CloudFormation rollback

### Maintenance Page Not Loading Properly

**Problem**: Page shows but CSS is missing or page looks broken

**Solutions**:
1. Check S3 bucket for maintenance assets:
   - Navigate to S3 → Find maintenance bucket (name in CloudFormation outputs: `MaintenanceModeBucketName`)
   - Verify `maintenance.html` and `maintenance.css` exist
2. Check CloudFront cache:
   - Navigate to CloudFront → Distributions
   - Create invalidation for `/maintenance.html` and `/maintenance.css`
3. Verify CloudFront behaviors are configured:
   - Check distribution has behaviors for `/maintenance.html` and `/maintenance.css`

## Emergency Rollback

If the maintenance mode system causes critical issues:

### Option 1: Disable via KeyValueStore (Fastest)

```bash
aws cloudfront-keyvaluestore update-keys \
  --kvs-arn <KVS_ARN_FROM_OUTPUTS> \
  --puts Key=maintenance,Value=false
```

### Option 2: Remove Function Associations (5-10 minutes)

1. Navigate to CloudFront → Distributions
2. Select your distribution
3. Go to **Behaviors** tab
4. Edit default behavior
5. Remove function associations for maintenance mode functions
6. Save changes (takes 5-10 minutes to deploy)

### Option 3: CloudFormation Rollback (Slowest but Complete)

1. Navigate to CloudFormation → Stacks
2. Find the Web stack
3. Select **Stack actions** → **Roll back**
4. This will remove all maintenance mode resources

## Best Practices

1. **Test Before Production**:
   - Test activation/deactivation in a staging environment first
   - Verify propagation times in your specific setup

2. **Communicate Maintenance Windows**:
   - Notify users in advance of planned maintenance
   - Provide estimated downtime duration

3. **Keep IP Whitelist Updated**:
   - Maintain a list of administrator IPs
   - Update before maintenance windows if IPs change

4. **Monitor During Activation**:
   - Watch CloudWatch metrics for 503 status codes
   - Monitor CloudFront Function execution logs for errors

5. **Document Rollback Plan**:
   - Keep this guide accessible during maintenance
   - Ensure multiple team members can execute rollback

## FAQ

### Q: How long does it take to activate maintenance mode?
**A**: Typically 30-60 seconds for global propagation. Plan for up to 2 minutes to be safe.

### Q: Can I schedule automatic maintenance mode activation?
**A**: Not in the current version. Manual activation via KeyValueStore is required. Future enhancements may add scheduling.

### Q: What HTTP status code do users see during maintenance?
**A**: 503 Service Unavailable with a `Retry-After: 3600` header (1 hour).

### Q: Can I customize the maintenance page?
**A**: Yes. Update the HTML and CSS files in the maintenance S3 bucket. See the developer documentation for details.

### Q: Does maintenance mode affect API endpoints?
**A**: No. Maintenance mode only affects web frontend requests through CloudFront. Backend API endpoints continue functioning normally.

### Q: How many IPs can I whitelist?
**A**: There's no hard limit, but keep the whitelist string under 1000 characters for optimal performance. This allows dozens of IPs.

### Q: Can I use CIDR notation for IP ranges?
**A**: Not in the current version. Only individual IPv4 and IPv6 addresses are supported. CIDR support may be added in future versions.

## Support

For issues not covered in this guide:
1. Check CloudWatch Logs for CloudFront Function errors
2. Review CloudFormation stack outputs for resource ARNs
3. Contact your AWS administrator or DevOps team
4. Consult the developer documentation for architecture details
