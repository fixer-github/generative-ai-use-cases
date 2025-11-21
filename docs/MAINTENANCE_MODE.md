# Maintenance Mode - Complete Guide

This document provides a complete guide to using the maintenance mode feature for your GenU (Generative AI Use Cases) deployment.

## 🚀 Quick Start

```bash
# Enable maintenance mode
./scripts/maintenance.sh tmp on

# Disable maintenance mode
./scripts/maintenance.sh tmp off

# Check status
./scripts/maintenance.sh tmp status

# Validate it's working
./scripts/validate-maintenance.sh tmp
```

## 📋 Table of Contents

1. [Overview](#overview)
2. [Scripts](#scripts)
3. [Common Tasks](#common-tasks)
4. [Troubleshooting](#troubleshooting)
5. [Architecture](#architecture)
6. [Best Practices](#best-practices)

## Overview

The maintenance mode feature allows you to temporarily display a maintenance page to users while keeping the site accessible to whitelisted IP addresses (e.g., admin team).

### Key Features

- ✅ **One-command toggle** - Enable/disable with single command
- ✅ **Automatic cache invalidation** - No manual steps needed
- ✅ **IP whitelisting** - Allow specific IPs to bypass maintenance
- ✅ **Multi-environment** - Support for tmp, devel, produ, hosoy
- ✅ **Validation tools** - Verify maintenance mode is working
- ✅ **Color-coded output** - Easy to read status information

### How It Works

```
User Request → CloudFront → Viewer Request Function
                                ↓
                        Check KeyValueStore
                                ↓
                    ┌───────────┴───────────┐
                    ↓                       ↓
            Maintenance = true      Maintenance = false
                    ↓                       ↓
            Check IP Whitelist          Allow Request
                    ↓
        ┌───────────┴───────────┐
        ↓                       ↓
    IP Whitelisted          Not Whitelisted
        ↓                       ↓
    Allow Request       Redirect to /maintenance.html
```

## Scripts

### `maintenance.sh` - Quick Wrapper

**Simple interface for common operations.**

```bash
./scripts/maintenance.sh <env> <on|off|status>
```

**Examples:**
```bash
./scripts/maintenance.sh tmp on      # Enable for tmp environment
./scripts/maintenance.sh tmp off     # Disable for tmp environment
./scripts/maintenance.sh tmp status  # Check current status
```

### `maintenance-mode.sh` - Full-Featured Script

**Complete maintenance mode management with all features.**

```bash
./scripts/maintenance-mode.sh <env> <command> [options]
```

**Commands:**
- `on` - Enable maintenance mode
- `off` - Disable maintenance mode
- `status` - Show current status
- `whitelist-add <ips>` - Add IPs to whitelist
- `whitelist-rm <ips>` - Remove IPs from whitelist
- `whitelist-show` - Show whitelisted IPs
- `whitelist-clear` - Clear all whitelisted IPs

**Options:**
- `--profile <name>` - AWS profile (default: genu)
- `--no-invalidate` - Skip cache invalidation
- `--help` - Show help

**Examples:**
```bash
# Enable with custom profile
./scripts/maintenance-mode.sh produ on --profile production

# Add multiple IPs to whitelist
./scripts/maintenance-mode.sh tmp whitelist-add 203.0.113.1,198.51.100.50

# Show current whitelist
./scripts/maintenance-mode.sh tmp whitelist-show

# Remove IP from whitelist
./scripts/maintenance-mode.sh tmp whitelist-rm 203.0.113.1
```

### `validate-maintenance.sh` - Validation Tool

**Verify that maintenance mode is working correctly.**

```bash
./scripts/validate-maintenance.sh <env> [--profile <profile>]
```

**What it checks:**
1. ✅ KeyValueStore configuration
2. ✅ CloudFront function attachments
3. ✅ Actual HTTP behavior
4. ✅ Recent cache invalidations

**Example:**
```bash
./scripts/validate-maintenance.sh tmp
```

## Common Tasks

### Enable Maintenance Mode

```bash
# 1. Enable maintenance mode
./scripts/maintenance.sh tmp on

# 2. Verify it's working (optional)
./scripts/validate-maintenance.sh tmp

# 3. Test in browser
# Open: https://<cloudfront-domain>
# Should see maintenance page
```

### Disable Maintenance Mode

```bash
# 1. Disable maintenance mode
./scripts/maintenance.sh tmp off

# 2. Wait 60 seconds for propagation

# 3. Hard refresh browser (IMPORTANT!)
# Windows/Linux: Ctrl + Shift + R
# Mac: Cmd + Shift + R

# 4. Verify (optional)
./scripts/validate-maintenance.sh tmp
```

### Whitelist Your Team's IPs

```bash
# 1. Add your team's IPs
./scripts/maintenance-mode.sh tmp whitelist-add 203.0.113.1,198.51.100.50

# 2. Enable maintenance mode
./scripts/maintenance.sh tmp on

# 3. Verify whitelisted IPs can still access
# Your team should see the normal site, not maintenance page
```

### Check Current Status

```bash
./scripts/maintenance.sh tmp status
```

**Output example:**
```
=== Maintenance Mode Status ===
✓ Maintenance mode: DISABLED

=== IP Whitelist ===
  - 203.0.113.1
  - 198.51.100.50

=== CloudFront Distribution ===
  Distribution ID: <distribution-id>
  URL: https://<cloudfront-domain>
```

### Scheduled Maintenance Example

```bash
#!/bin/bash
# scheduled-maintenance.sh

echo "Starting scheduled maintenance at $(date)"

# 1. Enable maintenance mode
./scripts/maintenance.sh produ on

# 2. Wait for propagation
sleep 60

# 3. Run your deployment/updates
echo "Running deployments..."
# ... your deployment commands here ...

# 4. Wait for deployment to complete
sleep 300

# 5. Disable maintenance mode
./scripts/maintenance.sh produ off

echo "Maintenance completed at $(date)"
```

## Troubleshooting

### Issue: Maintenance Page Still Showing After Disabling

**Symptoms:** Set maintenance to `false` but still see maintenance page

**Causes:**
1. Browser cached the 302 redirect
2. CloudFront edge cache not invalidated
3. Haven't waited long enough for propagation

**Solutions:**
```bash
# 1. Verify KVS is set correctly
./scripts/maintenance.sh tmp status

# 2. Ensure cache was invalidated (script does this automatically)
./scripts/maintenance.sh tmp off

# 3. Wait 60 seconds
sleep 60

# 4. Hard refresh browser (CRITICAL!)
# Windows/Linux: Ctrl + Shift + R
# Mac: Cmd + Shift + R

# 5. Or use incognito/private mode
```

### Issue: Maintenance Mode Not Activating

**Symptoms:** Set to `true` but site still accessible

**Solutions:**
```bash
# 1. Check status
./scripts/maintenance.sh tmp status

# 2. Verify KVS has maintenance=true
aws --profile <profile> cloudfront-keyvaluestore list-keys \
  --kvs-arn <kvs-arn>

# 3. Check if your IP is whitelisted
./scripts/maintenance-mode.sh tmp whitelist-show

# 4. Validate configuration
./scripts/validate-maintenance.sh tmp

# 5. Try toggling off then on again
./scripts/maintenance.sh tmp off
sleep 10
./scripts/maintenance.sh tmp on
```

### Issue: Script Can't Find Stack

**Symptoms:** "Could not find Web stack for environment: tmp"

**Solutions:**
```bash
# 1. Verify environment name
# Valid: tmp, devel, produ, hosoy

# 2. Check AWS profile
aws --profile <profile> sts get-caller-identity

# 3. List available stacks
aws --profile <profile> cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE
```

### Issue: IP Whitelist Not Working

**Symptoms:** IP whitelisted but still seeing maintenance page

**Causes:**
1. IP doesn't match exactly (no CIDR ranges supported)
2. Behind proxy/NAT (public IP different from expected)
3. IPv4 vs IPv6 mismatch

**Solutions:**
```bash
# 1. Check your public IP
curl ifconfig.me

# 2. Add your actual public IP
./scripts/maintenance-mode.sh tmp whitelist-add $(curl -s ifconfig.me)

# 3. Verify whitelist
./scripts/maintenance-mode.sh tmp whitelist-show

# 4. Test with browser
# Should see normal site, not maintenance page
```

### Issue: Cache Invalidation Taking Too Long

**Symptoms:** Changes not visible after 5+ minutes

**Note:** CloudFront cache invalidation typically completes in 30-60 seconds but can take up to 15 minutes.

**Solutions:**
```bash
# 1. Check invalidation status
aws --profile <profile> cloudfront list-invalidations \
  --distribution-id <distribution-id> --max-items 1

# 2. Wait for status: Completed

# 3. Hard refresh browser
# Ctrl + Shift + R (or Cmd + Shift + R)

# 4. Test with curl to bypass browser cache
curl -I "https://<cloudfront-domain>/test-$(date +%s).html"
```

## Architecture

### Components

```
┌────────────────────────────────────────────────────┐
│ CloudFront Distribution                            │
│                                                    │
│  ┌──────────────────────────────────────────┐    │
│  │ Viewer Request Function                  │    │
│  │ - Reads maintenance & ipWhitelist keys   │    │
│  │ - Returns 302 redirect if maintenance ON │    │
│  │ - Allows whitelisted IPs through         │    │
│  └──────────────────────────────────────────┘    │
│                  ↓                                 │
│  ┌──────────────────────────────────────────┐    │
│  │ KeyValueStore (KVS)                      │    │
│  │ - maintenance: "true" | "false"          │    │
│  │ - ipWhitelist: "ip1,ip2,..."             │    │
│  │ ARN: <kvs-arn>                           │    │
│  └──────────────────────────────────────────┘    │
│                                                    │
│  ┌──────────────────────────────────────────┐    │
│  │ S3 Bucket (Maintenance Assets)           │    │
│  │ - maintenance.html                        │    │
│  │ - maintenance.css                         │    │
│  └──────────────────────────────────────────┘    │
└────────────────────────────────────────────────────┘
```

### CloudFront Function Logic

Located in `packages/cdk/cloudfront-functions/viewer-request.js`:

```javascript
// 1. Get values from KVS
const maintenance = await kvsHandle.get('maintenance');
const ipWhitelist = await kvsHandle.get('ipWhitelist');

// 2. If maintenance OFF, allow all requests
if (maintenance !== 'true' && maintenance !== true) {
  return request;
}

// 3. Check if client IP is whitelisted
const whitelistedIps = ipWhitelist ? ipWhitelist.split(',') : [];
if (whitelistedIps.includes(clientIp)) {
  return request;
}

// 4. Prevent redirect loop for maintenance assets
if (uri === '/maintenance.html' || uri === '/maintenance.css') {
  return request;
}

// 5. Redirect to maintenance page
return {
  statusCode: 302,
  statusDescription: 'Found',
  headers: { location: { value: '/maintenance.html' } }
};
```

### Error Handling

The function uses **fail-open** error handling:

```javascript
try {
  // ... maintenance logic ...
} catch (error) {
  // If ANY error occurs (KVS access failure, etc.),
  // allow request through to prevent breaking entire site
  console.log('Error: ' + error.message);
  return request;
}
```

This ensures that CloudFront Function errors don't break the site.

## Best Practices

### 1. Always Use Scripts, Not Manual Commands

```bash
# ❌ BAD - Manual commands without cache invalidation
aws cloudfront-keyvaluestore put-key ...

# ✅ GOOD - Use the script (includes automatic cache invalidation)
./scripts/maintenance.sh tmp on
```

### 2. Test in Lower Environments First

```bash
# 1. Test in tmp environment
./scripts/maintenance.sh tmp on
# Verify maintenance page works
./scripts/validate-maintenance.sh tmp

# 2. Disable and verify
./scripts/maintenance.sh tmp off
# Verify site is accessible

# 3. Then apply to production
./scripts/maintenance.sh produ on
```

### 3. Whitelist Admin/Ops Team IPs

```bash
# Add your operations team IPs before enabling maintenance
./scripts/maintenance-mode.sh tmp whitelist-add 203.0.113.1,198.51.100.50

# Then enable maintenance mode
./scripts/maintenance.sh tmp on

# Your team can still access the site
```

### 4. Communicate Maintenance Windows

- Post advance notice to users (email, in-app notification)
- Specify exact start/end times
- Enable maintenance mode at scheduled time
- Monitor for errors during maintenance
- Notify when service is restored

### 5. Monitor During Maintenance

```bash
# Check CloudWatch for errors
aws logs tail /aws/cloudfront/distribution/<distribution-id> --follow

# Verify maintenance page is loading
curl -I https://<cloudfront-domain>

# Check cache invalidation status
./scripts/maintenance-mode.sh <env> status
```

### 6. Always Validate After Changes

```bash
# After any maintenance mode change
./scripts/validate-maintenance.sh tmp
```

## Additional Resources

- **Quick Reference**: [`scripts/QUICKREF.md`](./scripts/QUICKREF.md)
- **Detailed Documentation**: [`scripts/README.md`](./scripts/README.md)
- **CloudFront Function**: `packages/cdk/cloudfront-functions/viewer-request.js`
- **CDK Construct**: `packages/cdk/lib/construct/maintenance-mode.ts`

## Support

For issues or questions:
1. Check this guide and troubleshooting section
2. Run validation: `./scripts/validate-maintenance.sh tmp`
3. Check AWS CloudFormation console for stack status
4. Review CloudFront function logs (if available)
