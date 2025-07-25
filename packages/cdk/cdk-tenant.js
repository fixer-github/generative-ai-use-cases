#!/usr/bin/env node

/**
 * CDK Tenant Deployment Wrapper
 * 
 * This script enables separate CDK configurations for tenant-specific deployments.
 * 
 * Why this wrapper is needed:
 * - CDK only reads configuration from 'cdk.json' in the current directory
 * - We need different contexts and app entry points for common vs tenant stacks
 * - CDK doesn't support specifying alternate config files (like --config flag)
 * 
 * How it works:
 * 1. Temporarily backs up the original cdk.json
 * 2. Replaces it with cdk.tenant.json
 * 3. Runs the CDK command with tenant configuration
 * 4. Restores the original cdk.json
 * 
 * This allows us to maintain separate configurations:
 * - cdk.json: For common/main application stacks
 * - cdk.tenant.json: For tenant-specific stacks
 */
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const cdkJsonPath = path.join(__dirname, 'cdk.json');
const cdkTenantJsonPath = path.join(__dirname, 'cdk.tenant.json');
const cdkJsonBackupPath = path.join(__dirname, 'cdk.json.backup');

// Check if cdk.tenant.json exists
if (!fs.existsSync(cdkTenantJsonPath)) {
  console.error('Error: cdk.tenant.json not found. Please copy cdk.tenant.example.json to cdk.tenant.json and configure it.');
  process.exit(1);
}

try {
  // Backup original cdk.json
  fs.copyFileSync(cdkJsonPath, cdkJsonBackupPath);
  
  // Replace cdk.json with cdk.tenant.json
  fs.copyFileSync(cdkTenantJsonPath, cdkJsonPath);
  
  // Run CDK command
  execSync(`npx cdk ${args.join(' ')}`, { stdio: 'inherit' });
  
} catch (error) {
  console.error('CDK command failed:', error.message);
  process.exit(1);
} finally {
  // Restore original cdk.json
  if (fs.existsSync(cdkJsonBackupPath)) {
    fs.copyFileSync(cdkJsonBackupPath, cdkJsonPath);
    fs.unlinkSync(cdkJsonBackupPath);
  }
}