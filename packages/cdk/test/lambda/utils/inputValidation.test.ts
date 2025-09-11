import { describe, expect, test } from '@jest/globals';
import {
  validateAndSanitizeInput,
  validateUrl,
  validateAndSanitizeObject,
  validateLambdaEventBody,
  validateQueryParameters,
  validatePathParameters,
  validateSpecificFields,
  createValidationMiddleware
} from '../../../lambda/utils/inputValidation';

describe('Backend Input Validation', () => {
  describe('validateAndSanitizeInput', () => {
    test('should sanitize XSS patterns', () => {
      const maliciousInput = '<script>alert("xss")</script>Hello World';
      const sanitized = validateAndSanitizeInput(maliciousInput);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('Hello World');
    });

    test('should remove javascript URLs', () => {
      const input = 'Click <a href="javascript:alert(1)">here</a>';
      const sanitized = validateAndSanitizeInput(input);
      expect(sanitized).not.toContain('javascript:');
    });

    test('should remove event handlers', () => {
      const input = '<img onload="alert(1)" src="image.jpg">';
      const sanitized = validateAndSanitizeInput(input);
      expect(sanitized).not.toMatch(/onload\s*=/);
    });

    test('should encode HTML entities', () => {
      const input = '<div>Test & "quotes" and \'apostrophes\'</div>';
      const sanitized = validateAndSanitizeInput(input);
      expect(sanitized).toContain('&lt;div&gt;');
      expect(sanitized).toContain('&amp;');
      expect(sanitized).toContain('&quot;');
      expect(sanitized).toContain('&#x27;');
    });

    test('should handle non-string inputs', () => {
      expect(validateAndSanitizeInput(null)).toBe('');
      expect(validateAndSanitizeInput(undefined)).toBe('');
      expect(validateAndSanitizeInput(123)).toBe('');
      expect(validateAndSanitizeInput({})).toBe('');
    });

    test('should enforce maximum length', () => {
      const longInput = 'a'.repeat(100);
      expect(() => validateAndSanitizeInput(longInput, 50))
        .toThrow('Input exceeds maximum length of 50 characters');
    });

    test('should preserve safe content', () => {
      const safeInput = 'Hello, this is safe content with numbers 123 and symbols: !@#$%^*()';
      const sanitized = validateAndSanitizeInput(safeInput);
      expect(sanitized).toContain('Hello, this is safe content');
    });
  });

  describe('validateUrl', () => {
    test('should allow safe HTTP/HTTPS URLs', () => {
      expect(validateUrl('https://example.com')).toBe(true);
      expect(validateUrl('http://example.com/path')).toBe(true);
    });

    test('should allow relative URLs', () => {
      expect(validateUrl('/path/to/resource')).toBe(true);
      expect(validateUrl('./relative')).toBe(true);
    });

    test('should allow safe data URLs', () => {
      expect(validateUrl('data:image/png;base64,iVBORw0')).toBe(true);
      expect(validateUrl('data:audio/mp3;base64,data')).toBe(true);
    });

    test('should block dangerous URLs', () => {
      expect(validateUrl('javascript:alert(1)')).toBe(false);
      expect(validateUrl('vbscript:msgbox(1)')).toBe(false);
      expect(validateUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(validateUrl('file:///etc/passwd')).toBe(false);
    });

    test('should handle invalid inputs', () => {
      expect(validateUrl('')).toBe(false);
      expect(validateUrl(null as any)).toBe(false);
      expect(validateUrl(123 as any)).toBe(false);
    });
  });

  describe('validateAndSanitizeObject', () => {
    test('should recursively sanitize object properties', () => {
      const maliciousObject = {
        name: '<script>alert("name")</script>John',
        email: 'user@example.com',
        profile: {
          bio: '<img onerror="alert(1)" src="x">',
          interests: ['<script>alert("interest")</script>coding', 'music']
        }
      };

      const sanitized = validateAndSanitizeObject(maliciousObject);
      
      expect(sanitized.name).not.toContain('<script>');
      expect(sanitized.name).toContain('John');
      expect(sanitized.profile.bio).not.toMatch(/onerror\s*=/);
      expect(sanitized.profile.interests[0]).not.toContain('<script>');
      expect(sanitized.profile.interests[0]).toContain('coding');
    });

    test('should handle nested arrays', () => {
      const obj = {
        items: [
          { name: '<script>alert(1)</script>Item 1' },
          { name: 'Item 2' }
        ]
      };

      const sanitized = validateAndSanitizeObject(obj);
      expect(sanitized.items[0].name).not.toContain('<script>');
      expect(sanitized.items[1].name).toBe('Item 2');
    });

    test('should respect maximum depth', () => {
      const deepObject = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: '<script>alert(1)</script>deep'
              }
            }
          }
        }
      };

      const sanitized = validateAndSanitizeObject(deepObject, 3);
      // Should stop at maxDepth and not sanitize level5
      expect(sanitized.level1.level2.level3.level4.level5).toBe('<script>alert(1)</script>deep');
    });

    test('should handle primitive values', () => {
      expect(validateAndSanitizeObject('test string')).toContain('test string');
      expect(validateAndSanitizeObject(123)).toBe(123);
      expect(validateAndSanitizeObject(null)).toBe(null);
      expect(validateAndSanitizeObject(undefined)).toBe(undefined);
    });
  });

  describe('validateLambdaEventBody', () => {
    test('should parse and validate JSON string body', () => {
      const event = {
        body: '{"message": "<script>alert(1)</script>Hello", "safe": "content"}'
      };

      const result = validateLambdaEventBody(event);
      expect(result.message).not.toContain('<script>');
      expect(result.message).toContain('Hello');
      expect(result.safe).toBe('content');
    });

    test('should handle already parsed body', () => {
      const event = {
        body: {
          message: '<img onerror="alert(1)" src="x">',
          data: 'safe content'
        }
      };

      const result = validateLambdaEventBody(event);
      expect(result.message).not.toMatch(/onerror\s*=/);
      expect(result.data).toBe('safe content');
    });

    test('should throw error for invalid JSON', () => {
      const event = {
        body: '{"invalid": json}'
      };

      expect(() => validateLambdaEventBody(event))
        .toThrow('Invalid JSON in request body');
    });

    test('should throw error for non-object body', () => {
      const event = {
        body: '"string body"'
      };

      expect(() => validateLambdaEventBody(event))
        .toThrow('Request body must be a valid object');
    });
  });

  describe('validateQueryParameters', () => {
    test('should sanitize query parameters', () => {
      const queryParams = {
        'search': '<script>alert(1)</script>term',
        'page': '1',
        'filter<script>': 'value'
      };

      const result = validateQueryParameters(queryParams);
      expect(result.search).not.toContain('<script>');
      expect(result.search).toContain('term');
      expect(result.page).toBe('1');
      expect(Object.keys(result).some(key => key.includes('<script>'))).toBe(false);
    });

    test('should handle null query parameters', () => {
      const result = validateQueryParameters(null);
      expect(result).toEqual({});
    });

    test('should handle empty query parameters', () => {
      const result = validateQueryParameters({});
      expect(result).toEqual({});
    });
  });

  describe('validatePathParameters', () => {
    test('should sanitize and validate path parameters', () => {
      const pathParams = {
        'id': 'user123',
        'category': 'electronics-gadgets'
      };

      const result = validatePathParameters(pathParams);
      expect(result.id).toBe('user123');
      expect(result.category).toBe('electronics-gadgets');
    });

    test('should reject invalid path parameter characters', () => {
      const pathParams = {
        'id': '<script>alert(1)</script>'
      };

      expect(() => validatePathParameters(pathParams))
        .toThrow('Invalid path parameter: id');
    });

    test('should handle null path parameters', () => {
      const result = validatePathParameters(null);
      expect(result).toEqual({});
    });
  });

  describe('validateSpecificFields', () => {
    describe('email validation', () => {
      test('should validate correct email formats', () => {
        expect(validateSpecificFields.email('user@example.com')).toBe(true);
        expect(validateSpecificFields.email('test.email+tag@domain.co.uk')).toBe(true);
      });

      test('should reject invalid email formats', () => {
        expect(validateSpecificFields.email('invalid-email')).toBe(false);
        expect(validateSpecificFields.email('@domain.com')).toBe(false);
        expect(validateSpecificFields.email('user@')).toBe(false);
      });

      test('should reject overly long emails', () => {
        const longEmail = 'a'.repeat(250) + '@example.com';
        expect(validateSpecificFields.email(longEmail)).toBe(false);
      });
    });

    describe('username validation', () => {
      test('should validate correct usernames', () => {
        expect(validateSpecificFields.username('john_doe')).toBe(true);
        expect(validateSpecificFields.username('user123')).toBe(true);
        expect(validateSpecificFields.username('test-user')).toBe(true);
      });

      test('should reject invalid usernames', () => {
        expect(validateSpecificFields.username('ab')).toBe(false); // too short
        expect(validateSpecificFields.username('user with spaces')).toBe(false);
        expect(validateSpecificFields.username('user@domain')).toBe(false);
        expect(validateSpecificFields.username('a'.repeat(31))).toBe(false); // too long
      });
    });

    describe('filename validation', () => {
      test('should validate safe filenames', () => {
        expect(validateSpecificFields.filename('document.pdf')).toBe(true);
        expect(validateSpecificFields.filename('my file.txt')).toBe(true);
        expect(validateSpecificFields.filename('image_2024.png')).toBe(true);
      });

      test('should reject dangerous filenames', () => {
        expect(validateSpecificFields.filename('../../../etc/passwd')).toBe(false);
        expect(validateSpecificFields.filename('file<script>alert(1)</script>.txt')).toBe(false);
        expect(validateSpecificFields.filename('file|dangerous.exe')).toBe(false);
      });
    });

    describe('id validation', () => {
      test('should validate safe IDs', () => {
        expect(validateSpecificFields.id('user-123')).toBe(true);
        expect(validateSpecificFields.id('ABC123')).toBe(true);
        expect(validateSpecificFields.id('uuid-12345-abcdef')).toBe(true);
      });

      test('should reject invalid IDs', () => {
        expect(validateSpecificFields.id('id with spaces')).toBe(false);
        expect(validateSpecificFields.id('id@domain')).toBe(false);
        expect(validateSpecificFields.id('a'.repeat(101))).toBe(false); // too long
      });
    });
  });

  describe('createValidationMiddleware', () => {
    test('should create middleware that validates all parts by default', () => {
      const middleware = createValidationMiddleware();
      const event = {
        body: '{"message": "test"}',
        queryStringParameters: { search: 'term' },
        pathParameters: { id: 'user123' }
      };

      const result = middleware(event);
      expect(result.body).toBeDefined();
      expect(result.queryStringParameters).toBeDefined();
      expect(result.pathParameters).toBeDefined();
    });

    test('should allow selective validation', () => {
      const middleware = createValidationMiddleware({
        validateBody: true,
        validateQuery: false,
        validatePath: false
      });
      
      const event = {
        body: '{"message": "test"}',
        queryStringParameters: { search: 'term' },
        pathParameters: { id: 'user123' }
      };

      const result = middleware(event);
      expect(result.body).toBeDefined();
      expect(result.queryStringParameters).toEqual({});
      expect(result.pathParameters).toEqual({});
    });

    test('should throw error for invalid input', () => {
      const middleware = createValidationMiddleware();
      const event = {
        body: 'invalid json{',
        queryStringParameters: null,
        pathParameters: null
      };

      expect(() => middleware(event)).toThrow('Invalid input data');
    });
  });
});