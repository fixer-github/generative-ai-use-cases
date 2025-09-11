/**
 * XSS Protection Utilities
 * 
 * This module provides utility functions to prevent Cross-Site Scripting (XSS) attacks
 * by validating URLs and sanitizing user input.
 */

/**
 * Validates a URL to ensure it uses safe protocols and doesn't contain dangerous schemes
 * @param url - The URL to validate
 * @returns true if the URL is safe, false otherwise
 */
export const validateUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') {
    return false;
  }

  // Remove whitespace and convert to lowercase for consistent checking
  const normalizedUrl = url.trim().toLowerCase();

  // Block dangerous schemes
  const blockedSchemes = [
    'javascript:',
    'vbscript:',
    'data:text/html',
    'file:',
    'ftp:',
  ];

  // Check for blocked schemes
  for (const scheme of blockedSchemes) {
    if (normalizedUrl.startsWith(scheme)) {
      return false;
    }
  }

  // Allow safe schemes
  const allowedSchemes = [
    'http:',
    'https:',
    'data:image/',
    'data:video/',
    'data:audio/',
    'blob:',
    'mailto:',
    'tel:',
  ];

  // Check if URL starts with any allowed scheme or is a relative URL
  const isRelativeUrl = !normalizedUrl.includes(':') || normalizedUrl.startsWith('/');
  const hasAllowedScheme = allowedSchemes.some(scheme => normalizedUrl.startsWith(scheme));

  if (!isRelativeUrl && !hasAllowedScheme) {
    return false;
  }

  // Additional validation for data URLs
  if (normalizedUrl.startsWith('data:')) {
    // Ensure data URLs are properly formatted and safe
    const dataUrlPattern = /^data:(image|video|audio)\/[a-z0-9+.-]+;base64,[a-z0-9+/=]+$/i;
    return dataUrlPattern.test(normalizedUrl);
  }

  try {
    // For absolute URLs, try to parse them to ensure they're well-formed
    if (normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://')) {
      new URL(url); // Validate URL format
      // Additional checks could go here (e.g., domain whitelist)
      return true;
    }
  } catch (error) {
    return false;
  }

  return true;
};

/**
 * Returns a safe URL or a fallback if the URL is unsafe
 * @param url - The URL to validate
 * @param fallback - Fallback URL to use if the original is unsafe (default: '#')
 * @returns A safe URL or the fallback
 */
export const getSafeUrl = (url: string, fallback: string = '#'): string => {
  return validateUrl(url) ? url : fallback;
};

/**
 * Sanitizes HTML input by escaping special characters
 * @param input - The string to sanitize
 * @returns Sanitized string with HTML entities escaped
 */
export const sanitizeHtmlInput = (input: string): string => {
  if (!input || typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/`/g, '&#96;');
};

/**
 * Validates and sanitizes a filename to prevent path traversal attacks
 * @param filename - The filename to validate
 * @returns Sanitized filename
 */
export const sanitizeFilename = (filename: string): string => {
  if (!filename || typeof filename !== 'string') {
    return 'file';
  }

  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Replace unsafe characters
    .replace(/\.{2,}/g, '.') // Replace multiple dots
    .replace(/^\.+|\.+$/g, '') // Remove leading/trailing dots
    .substring(0, 255) // Limit length
    || 'file'; // Fallback if empty
};

/**
 * Checks if a string contains potential XSS patterns
 * @param input - The string to check
 * @returns true if potentially dangerous patterns are found
 */
export const containsXSSPatterns = (input: string): boolean => {
  if (!input || typeof input !== 'string') {
    return false;
  }

  const xssPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /on\w+\s*=/gi,
    /<iframe[^>]*>/gi,
    /<object[^>]*>/gi,
    /<embed[^>]*>/gi,
    /<form[^>]*>/gi,
    /expression\s*\(/gi,
    /url\s*\(\s*javascript:/gi,
  ];

  return xssPatterns.some(pattern => pattern.test(input));
};

/**
 * Validates if a string is safe for use in HTML attributes
 * @param value - The value to validate
 * @returns true if the value is safe for HTML attributes
 */
export const isSafeForHtmlAttribute = (value: string): boolean => {
  if (!value || typeof value !== 'string') {
    return true; // Empty values are safe
  }

  // Check for dangerous patterns in attribute values
  const dangerousPatterns = [
    /javascript:/gi,
    /vbscript:/gi,
    /on\w+\s*=/gi,
    /expression\s*\(/gi,
    /<[^>]*>/gi,
  ];

  return !dangerousPatterns.some(pattern => pattern.test(value));
};