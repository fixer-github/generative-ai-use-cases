/**
 * Backend Input Validation Utilities
 * 
 * This module provides utilities to validate and sanitize input data
 * in AWS Lambda functions to prevent XSS and injection attacks.
 */

/**
 * XSS attack patterns to detect and remove
 */
const XSS_PATTERNS = [
  /<script[^>]*>.*?<\/script>/gi,
  /javascript:/gi,
  /vbscript:/gi,
  /on\w+\s*=/gi,
  /<iframe[^>]*>/gi,
  /<object[^>]*>/gi,
  /<embed[^>]*>/gi,
  /<form[^>]*>/gi,
  /<input[^>]*>/gi,
  /expression\s*\(/gi,
  /url\s*\(\s*javascript:/gi,
  /<link[^>]*>/gi,
  /<style[^>]*>.*?<\/style>/gi,
  /<meta[^>]*>/gi,
  /data:text\/html/gi,
];

/**
 * Validates and sanitizes a string input by removing XSS patterns
 * @param input - The string to validate and sanitize
 * @param maxLength - Maximum allowed length (default: 10000)
 * @returns Sanitized string
 */
export const validateAndSanitizeInput = (input: unknown, maxLength: number = 10000): string => {
  if (typeof input !== 'string') {
    return '';
  }

  if (input.length > maxLength) {
    throw new Error(`Input exceeds maximum length of ${maxLength} characters`);
  }

  let sanitizedInput = input;

  // Remove XSS patterns
  XSS_PATTERNS.forEach(pattern => {
    sanitizedInput = sanitizedInput.replace(pattern, '');
  });

  // Additional HTML entity encoding for safety
  sanitizedInput = sanitizedInput
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');

  return sanitizedInput;
};

/**
 * Validates URL to ensure it uses safe protocols
 * @param url - The URL to validate
 * @returns true if URL is safe, false otherwise
 */
export const validateUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const normalizedUrl = url.trim().toLowerCase();

  // Block dangerous schemes
  const blockedSchemes = [
    'javascript:',
    'vbscript:',
    'data:text/html',
    'file:',
  ];

  if (blockedSchemes.some(scheme => normalizedUrl.startsWith(scheme))) {
    return false;
  }

  // Allow safe schemes
  const allowedSchemes = [
    'http:',
    'https:',
    'data:image/',
    'data:video/',
    'data:audio/',
    'mailto:',
    'tel:',
  ];

  const isRelativeUrl = !normalizedUrl.includes(':') || normalizedUrl.startsWith('/');
  const hasAllowedScheme = allowedSchemes.some(scheme => normalizedUrl.startsWith(scheme));

  return isRelativeUrl || hasAllowedScheme;
};

/**
 * Recursively validates and sanitizes an object's string properties
 * @param obj - The object to sanitize
 * @param maxDepth - Maximum recursion depth (default: 5)
 * @param currentDepth - Current recursion depth (internal use)
 * @returns Sanitized object
 */
export const validateAndSanitizeObject = (
  obj: any,
  maxDepth: number = 5,
  currentDepth: number = 0
): any => {
  if (currentDepth >= maxDepth) {
    console.warn('Maximum validation depth reached, skipping deeper properties');
    return obj;
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return validateAndSanitizeInput(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => validateAndSanitizeObject(item, maxDepth, currentDepth + 1));
  }

  if (typeof obj === 'object') {
    const sanitizedObj: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const sanitizedKey = validateAndSanitizeInput(key, 100); // Limit key length
        sanitizedObj[sanitizedKey] = validateAndSanitizeObject(
          obj[key], 
          maxDepth, 
          currentDepth + 1
        );
      }
    }
    return sanitizedObj;
  }

  return obj;
};

/**
 * Validates Lambda event body and sanitizes string inputs
 * @param event - AWS Lambda event object
 * @returns Sanitized event body
 */
export const validateLambdaEventBody = (event: any): any => {
  try {
    let body = event.body;
    
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (error) {
        throw new Error('Invalid JSON in request body');
      }
    }

    if (!body || typeof body !== 'object') {
      throw new Error('Request body must be a valid object');
    }

    return validateAndSanitizeObject(body);
  } catch (error) {
    console.error('Input validation error:', error);
    throw error;
  }
};

/**
 * Validates and sanitizes query string parameters
 * @param queryStringParameters - Lambda event query parameters
 * @returns Sanitized query parameters
 */
export const validateQueryParameters = (queryStringParameters: Record<string, string> | null): Record<string, string> => {
  if (!queryStringParameters) {
    return {};
  }

  const sanitizedParams: Record<string, string> = {};
  
  for (const key in queryStringParameters) {
    if (queryStringParameters.hasOwnProperty(key)) {
      const sanitizedKey = validateAndSanitizeInput(key, 100);
      const sanitizedValue = validateAndSanitizeInput(queryStringParameters[key], 1000);
      sanitizedParams[sanitizedKey] = sanitizedValue;
    }
  }

  return sanitizedParams;
};

/**
 * Validates and sanitizes path parameters
 * @param pathParameters - Lambda event path parameters
 * @returns Sanitized path parameters
 */
export const validatePathParameters = (pathParameters: Record<string, string> | null): Record<string, string> => {
  if (!pathParameters) {
    return {};
  }

  const sanitizedParams: Record<string, string> = {};
  
  for (const key in pathParameters) {
    if (pathParameters.hasOwnProperty(key)) {
      const sanitizedKey = validateAndSanitizeInput(key, 50);
      const sanitizedValue = validateAndSanitizeInput(pathParameters[key], 200);
      
      // Additional validation for path parameters (alphanumeric and common safe characters)
      if (!/^[a-zA-Z0-9_-]+$/.test(sanitizedValue)) {
        throw new Error(`Invalid path parameter: ${key}`);
      }
      
      sanitizedParams[sanitizedKey] = sanitizedValue;
    }
  }

  return sanitizedParams;
};

/**
 * Validates common input fields with specific rules
 */
export const validateSpecificFields = {
  /**
   * Validates email address format
   * @param email - Email to validate
   * @returns true if valid email format
   */
  email: (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
  },

  /**
   * Validates username (alphanumeric, underscore, hyphen)
   * @param username - Username to validate
   * @returns true if valid username
   */
  username: (username: string): boolean => {
    const usernameRegex = /^[a-zA-Z0-9_-]+$/;
    return usernameRegex.test(username) && username.length >= 3 && username.length <= 30;
  },

  /**
   * Validates file name
   * @param filename - Filename to validate
   * @returns true if valid filename
   */
  filename: (filename: string): boolean => {
    // Allow alphanumeric, dots, hyphens, underscores, and spaces
    const filenameRegex = /^[a-zA-Z0-9._\s-]+$/;
    return filenameRegex.test(filename) && filename.length <= 255 && !filename.includes('..');
  },

  /**
   * Validates ID (typically used for database IDs)
   * @param id - ID to validate
   * @returns true if valid ID
   */
  id: (id: string): boolean => {
    const idRegex = /^[a-zA-Z0-9-]+$/;
    return idRegex.test(id) && id.length <= 100;
  }
};

/**
 * Creates a validation middleware function for Lambda handlers
 * @param options - Validation options
 * @returns Validation middleware function
 */
export const createValidationMiddleware = (options: {
  validateBody?: boolean;
  validateQuery?: boolean;
  validatePath?: boolean;
  maxBodySize?: number;
} = {}) => {
  return (event: any) => {
    const result: any = {
      body: null,
      queryStringParameters: {},
      pathParameters: {}
    };

    try {
      if (options.validateBody !== false && event.body) {
        result.body = validateLambdaEventBody(event);
      }

      if (options.validateQuery !== false) {
        result.queryStringParameters = validateQueryParameters(event.queryStringParameters);
      }

      if (options.validatePath !== false) {
        result.pathParameters = validatePathParameters(event.pathParameters);
      }

      return result;
    } catch (error) {
      console.error('Validation middleware error:', error);
      throw new Error('Invalid input data');
    }
  };
};