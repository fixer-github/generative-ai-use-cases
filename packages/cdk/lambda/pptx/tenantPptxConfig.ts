/**
 * Utility to get tenant-specific PPTX resource names
 */

const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';

/**
 * Sanitize tenant ID for use in resource names
 * Matches the sanitization logic in pptx-db.ts
 */
function sanitizeTenantId(tenantId: string): string {
  return tenantId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
}

/**
 * Get the DynamoDB table name for PPTX templates for a specific tenant
 */
export function getPptxTemplatesTableName(tenantId: string): string {
  const sanitizedTenantId = sanitizeTenantId(tenantId);
  return `pptx-templates-${ENVIRONMENT}-${sanitizedTenantId}`;
}

/**
 * Get the DynamoDB table name for PPTX generations for a specific tenant
 */
export function getPptxGenerationsTableName(tenantId: string): string {
  const sanitizedTenantId = sanitizeTenantId(tenantId);
  return `pptx-generations-${ENVIRONMENT}-${sanitizedTenantId}`;
}

/**
 * Get the S3 bucket name for PPTX templates for a specific tenant
 * This should match the naming convention used in tenant-s3.ts
 */
export function getPptxTemplatesBucketName(tenantId: string): string {
  // Note: This will need to match the actual S3 bucket naming from TenantS3Stack
  // For now, using a placeholder pattern - needs to be updated with actual bucket name lookup
  const sanitizedTenantId = sanitizeTenantId(tenantId);
  return process.env.PPTX_TEMPLATES_BUCKET_PATTERN?.replace('{tenantId}', sanitizedTenantId) || '';
}

/**
 * Get the S3 bucket name for PPTX outputs for a specific tenant
 */
export function getPptxOutputsBucketName(tenantId: string): string {
  // Note: This will need to match the actual S3 bucket naming from TenantS3Stack
  const sanitizedTenantId = sanitizeTenantId(tenantId);
  return process.env.PPTX_OUTPUTS_BUCKET_PATTERN?.replace('{tenantId}', sanitizedTenantId) || '';
}
