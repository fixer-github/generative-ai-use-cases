#!/usr/bin/env node

// Simple wrapper to temporarily swap cdk.json configs for tenant deployments
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