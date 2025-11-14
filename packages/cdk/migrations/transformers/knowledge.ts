import { KnowledgeSource } from 'generative-ai-use-cases';
import { OldBotKnowledge } from '../types/old-schema';
import * as crypto from 'crypto';

export type KnowledgeTransformOptions = {
  defaultStatus?: 'QUEUED' | 'SYNCING' | 'SUCCEEDED' | 'FAILED'; // KnowledgeSource status doesn't include PARTIAL
};

/**
 * Extract S3 bucket and key from S3 URL
 * Supports formats:
 * - s3://bucket/key
 * - https://bucket.s3.region.amazonaws.com/key
 * - https://s3.region.amazonaws.com/bucket/key
 */
export function parseS3Url(url: string): { bucket: string; key: string } | null {
  // s3:// format
  const s3Match = url.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (s3Match) {
    return {
      bucket: s3Match[1],
      key: s3Match[2],
    };
  }

  // https://bucket.s3.region.amazonaws.com/key format
  const httpsMatch1 = url.match(
    /^https?:\/\/([^.]+)\.s3[.-]([^.]+)\.amazonaws\.com\/(.+)$/
  );
  if (httpsMatch1) {
    return {
      bucket: httpsMatch1[1],
      key: httpsMatch1[3],
    };
  }

  // https://s3.region.amazonaws.com/bucket/key format
  const httpsMatch2 = url.match(
    /^https?:\/\/s3[.-]([^.]+)\.amazonaws\.com\/([^/]+)\/(.+)$/
  );
  if (httpsMatch2) {
    return {
      bucket: httpsMatch2[2],
      key: httpsMatch2[3],
    };
  }

  return null;
}

/**
 * Extract filename from S3 key or URL
 */
export function extractFileName(urlOrKey: string): string {
  const parts = urlOrKey.split('/');
  return parts[parts.length - 1] || urlOrKey;
}

/**
 * Transform old Knowledge object to new KnowledgeSource array
 */
export function transformKnowledgeSources(
  oldKnowledge: OldBotKnowledge | undefined,
  options: KnowledgeTransformOptions = {}
): KnowledgeSource[] {
  if (!oldKnowledge) {
    return [];
  }

  const sources: KnowledgeSource[] = [];
  const defaultStatus = options.defaultStatus || 'QUEUED';

  // Transform s3_urls to file type knowledge sources
  if (oldKnowledge.s3_urls && oldKnowledge.s3_urls.length > 0) {
    for (const s3Url of oldKnowledge.s3_urls) {
      const parsed = parseS3Url(s3Url);
      if (parsed) {
        sources.push({
          id: crypto.randomUUID(),
          type: 'file',
          sourceType: 'file',
          storageKey: parsed.key,
          name: extractFileName(parsed.key),
          displayName: extractFileName(parsed.key),
          url: s3Url,
          sourceUrl: s3Url,
          status: defaultStatus,
        });
      } else {
        console.warn(`Failed to parse S3 URL: ${s3Url}`);
      }
    }
  }

  // Transform filenames to file type knowledge sources
  // Note: filenames might not have full S3 path, just the filename
  if (oldKnowledge.filenames && oldKnowledge.filenames.length > 0) {
    for (const filename of oldKnowledge.filenames) {
      // Skip if already processed as s3_url
      if (sources.some((s) => s.name === filename || s.storageKey === filename)) {
        continue;
      }

      sources.push({
        id: crypto.randomUUID(),
        type: 'file',
        sourceType: 'file',
        storageKey: filename, // Might need to be resolved to full path during migration
        name: extractFileName(filename),
        displayName: extractFileName(filename),
        status: defaultStatus,
      });
    }
  }

  // Transform source_urls to url type knowledge sources
  if (oldKnowledge.source_urls && oldKnowledge.source_urls.length > 0) {
    for (const sourceUrl of oldKnowledge.source_urls) {
      sources.push({
        id: crypto.randomUUID(),
        type: 'url',
        sourceType: 'url',
        url: sourceUrl,
        sourceUrl,
        name: new URL(sourceUrl).hostname,
        displayName: new URL(sourceUrl).hostname,
        status: defaultStatus,
      });
    }
  }

  // Transform sitemap_urls to web type knowledge sources
  // Note: New schema might use 'web' or 'url' - using 'web' to distinguish sitemaps
  if (oldKnowledge.sitemap_urls && oldKnowledge.sitemap_urls.length > 0) {
    for (const sitemapUrl of oldKnowledge.sitemap_urls) {
      sources.push({
        id: crypto.randomUUID(),
        type: 'web',
        sourceType: 'web',
        url: sitemapUrl,
        sourceUrl: sitemapUrl,
        name: `Sitemap: ${new URL(sitemapUrl).hostname}`,
        displayName: `Sitemap: ${new URL(sitemapUrl).hostname}`,
        status: defaultStatus,
      });
    }
  }

  return sources;
}

/**
 * Validate knowledge source transformation
 */
export function validateKnowledgeSourceTransformation(
  oldKnowledge: OldBotKnowledge | undefined,
  newSources: KnowledgeSource[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!oldKnowledge) {
    return { valid: true, errors };
  }

  const expectedCount =
    (oldKnowledge.s3_urls?.length || 0) +
    (oldKnowledge.source_urls?.length || 0) +
    (oldKnowledge.sitemap_urls?.length || 0) +
    (oldKnowledge.filenames?.length || 0);

  // Account for potential duplicates between s3_urls and filenames
  const uniqueFilenames = new Set([
    ...(oldKnowledge.s3_urls || []).map((url) => parseS3Url(url)?.key || url),
    ...(oldKnowledge.filenames || []),
  ]);

  const minExpectedCount =
    uniqueFilenames.size +
    (oldKnowledge.source_urls?.length || 0) +
    (oldKnowledge.sitemap_urls?.length || 0);

  if (newSources.length < minExpectedCount) {
    errors.push(
      `Expected at least ${minExpectedCount} knowledge sources, got ${newSources.length}`
    );
  }

  // Validate each source has required fields
  for (const source of newSources) {
    if (!source.type && !source.sourceType) {
      errors.push('Knowledge source missing type/sourceType');
    }
    if (!source.status) {
      errors.push('Knowledge source missing status');
    }
    if (source.type === 'file' && !source.storageKey) {
      errors.push('File knowledge source missing storageKey');
    }
    if (
      (source.type === 'url' || source.type === 'web') &&
      !source.url &&
      !source.sourceUrl
    ) {
      errors.push('URL/Web knowledge source missing url/sourceUrl');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
