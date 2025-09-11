import { describe, expect, test } from 'vitest';
import {
  validateUrl,
  getSafeUrl,
  sanitizeHtmlInput,
  sanitizeFilename,
  containsXSSPatterns,
  isSafeForHtmlAttribute
} from '../../src/utils/xssProtection';

describe('XSS Protection Utilities', () => {
  describe('validateUrl', () => {
    test('should allow safe HTTP URLs', () => {
      expect(validateUrl('http://example.com')).toBe(true);
      expect(validateUrl('https://example.com')).toBe(true);
      expect(validateUrl('https://example.com/path?param=value')).toBe(true);
    });

    test('should allow relative URLs', () => {
      expect(validateUrl('/path/to/resource')).toBe(true);
      expect(validateUrl('./relative/path')).toBe(true);
      expect(validateUrl('../parent/path')).toBe(true);
    });

    test('should allow safe data URLs', () => {
      expect(validateUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==')).toBe(true);
      expect(validateUrl('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/wA8=')).toBe(true);
    });

    test('should allow blob URLs', () => {
      expect(validateUrl('blob:http://example.com/550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    test('should allow mailto and tel URLs', () => {
      expect(validateUrl('mailto:user@example.com')).toBe(true);
      expect(validateUrl('tel:+1234567890')).toBe(true);
    });

    test('should block javascript URLs', () => {
      expect(validateUrl('javascript:alert(1)')).toBe(false);
      expect(validateUrl('JAVASCRIPT:alert(1)')).toBe(false);
      expect(validateUrl('  javascript:alert(1)  ')).toBe(false);
    });

    test('should block vbscript URLs', () => {
      expect(validateUrl('vbscript:msgbox(1)')).toBe(false);
      expect(validateUrl('VBSCRIPT:msgbox(1)')).toBe(false);
    });

    test('should block file URLs', () => {
      expect(validateUrl('file:///etc/passwd')).toBe(false);
      expect(validateUrl('file://c:/windows/system32')).toBe(false);
    });

    test('should block dangerous data URLs', () => {
      expect(validateUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(validateUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe(false);
    });

    test('should handle invalid inputs', () => {
      expect(validateUrl('')).toBe(false);
      expect(validateUrl(null as any)).toBe(false);
      expect(validateUrl(undefined as any)).toBe(false);
      expect(validateUrl(123 as any)).toBe(false);
    });

    test('should validate malformed data URLs', () => {
      expect(validateUrl('data:image/png;base64,invalid-base64')).toBe(false);
      expect(validateUrl('data:image/png,not-base64')).toBe(false);
    });
  });

  describe('getSafeUrl', () => {
    test('should return safe URLs unchanged', () => {
      const safeUrl = 'https://example.com';
      expect(getSafeUrl(safeUrl)).toBe(safeUrl);
    });

    test('should return fallback for dangerous URLs', () => {
      expect(getSafeUrl('javascript:alert(1)')).toBe('#');
      expect(getSafeUrl('javascript:alert(1)', '/safe-fallback')).toBe('/safe-fallback');
    });

    test('should return fallback for invalid inputs', () => {
      expect(getSafeUrl('')).toBe('#');
      expect(getSafeUrl(null as any)).toBe('#');
    });
  });

  describe('sanitizeHtmlInput', () => {
    test('should escape HTML special characters', () => {
      expect(sanitizeHtmlInput('<script>alert("xss")</script>'))
        .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
    });

    test('should escape single quotes', () => {
      expect(sanitizeHtmlInput("'alert(1)'")).toBe('&#x27;alert(1)&#x27;');
    });

    test('should escape ampersands', () => {
      expect(sanitizeHtmlInput('&amp; test')).toBe('&amp;&amp; test');
    });

    test('should escape backticks', () => {
      expect(sanitizeHtmlInput('`eval(code)`')).toBe('&#96;eval(code)&#96;');
    });

    test('should handle empty or invalid inputs', () => {
      expect(sanitizeHtmlInput('')).toBe('');
      expect(sanitizeHtmlInput(null as any)).toBe('');
      expect(sanitizeHtmlInput(undefined as any)).toBe('');
      expect(sanitizeHtmlInput(123 as any)).toBe('');
    });

    test('should preserve safe text', () => {
      expect(sanitizeHtmlInput('Hello, World!')).toBe('Hello, World!');
      expect(sanitizeHtmlInput('User: john_doe123')).toBe('User: john_doe123');
    });
  });

  describe('sanitizeFilename', () => {
    test('should sanitize unsafe characters in filenames', () => {
      expect(sanitizeFilename('file<script>alert(1)</script>.txt'))
        .toBe('file_script_alert_1___script_.txt');
    });

    test('should handle path traversal attempts', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
      expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('windows_system32');
    });

    test('should limit filename length', () => {
      const longFilename = 'a'.repeat(300);
      const result = sanitizeFilename(longFilename);
      expect(result.length).toBeLessThanOrEqual(255);
    });

    test('should provide fallback for empty or invalid inputs', () => {
      expect(sanitizeFilename('')).toBe('file');
      expect(sanitizeFilename(null as any)).toBe('file');
      expect(sanitizeFilename('...')).toBe('file');
      expect(sanitizeFilename('.')).toBe('file');
    });

    test('should preserve safe filenames', () => {
      expect(sanitizeFilename('document.pdf')).toBe('document.pdf');
      expect(sanitizeFilename('image-2024.png')).toBe('image-2024.png');
      expect(sanitizeFilename('my_file_v2.txt')).toBe('my_file_v2.txt');
    });
  });

  describe('containsXSSPatterns', () => {
    test('should detect script tags', () => {
      expect(containsXSSPatterns('<script>alert(1)</script>')).toBe(true);
      expect(containsXSSPatterns('<SCRIPT>alert(1)</SCRIPT>')).toBe(true);
      expect(containsXSSPatterns('<script src="malicious.js"></script>')).toBe(true);
    });

    test('should detect javascript URLs', () => {
      expect(containsXSSPatterns('javascript:alert(1)')).toBe(true);
      expect(containsXSSPatterns('JAVASCRIPT:alert(1)')).toBe(true);
    });

    test('should detect event handlers', () => {
      expect(containsXSSPatterns('<img onload="alert(1)">')).toBe(true);
      expect(containsXSSPatterns('<div onclick="malicious()">')).toBe(true);
      expect(containsXSSPatterns('<body onload="xss()">')).toBe(true);
    });

    test('should detect iframe tags', () => {
      expect(containsXSSPatterns('<iframe src="malicious.html"></iframe>')).toBe(true);
      expect(containsXSSPatterns('<IFRAME src="javascript:alert(1)"></IFRAME>')).toBe(true);
    });

    test('should detect object and embed tags', () => {
      expect(containsXSSPatterns('<object data="malicious.swf"></object>')).toBe(true);
      expect(containsXSSPatterns('<embed src="malicious.swf">')).toBe(true);
    });

    test('should not flag safe content', () => {
      expect(containsXSSPatterns('Hello, World!')).toBe(false);
      expect(containsXSSPatterns('<p>This is safe HTML</p>')).toBe(false);
      expect(containsXSSPatterns('Email: user@example.com')).toBe(false);
    });

    test('should handle empty or invalid inputs', () => {
      expect(containsXSSPatterns('')).toBe(false);
      expect(containsXSSPatterns(null as any)).toBe(false);
      expect(containsXSSPatterns(undefined as any)).toBe(false);
    });
  });

  describe('isSafeForHtmlAttribute', () => {
    test('should allow safe attribute values', () => {
      expect(isSafeForHtmlAttribute('safe-value')).toBe(true);
      expect(isSafeForHtmlAttribute('123')).toBe(true);
      expect(isSafeForHtmlAttribute('')).toBe(true);
    });

    test('should block javascript in attributes', () => {
      expect(isSafeForHtmlAttribute('javascript:alert(1)')).toBe(false);
      expect(isSafeForHtmlAttribute('JAVASCRIPT:void(0)')).toBe(false);
    });

    test('should block event handlers in attributes', () => {
      expect(isSafeForHtmlAttribute('onload=alert(1)')).toBe(false);
      expect(isSafeForHtmlAttribute('onclick=malicious()')).toBe(false);
    });

    test('should block HTML tags in attributes', () => {
      expect(isSafeForHtmlAttribute('<script>alert(1)</script>')).toBe(false);
      expect(isSafeForHtmlAttribute('<img src="x" onerror="alert(1)">')).toBe(false);
    });

    test('should block CSS expressions', () => {
      expect(isSafeForHtmlAttribute('expression(alert(1))')).toBe(false);
      expect(isSafeForHtmlAttribute('EXPRESSION(alert(1))')).toBe(false);
    });

    test('should handle null and undefined inputs', () => {
      expect(isSafeForHtmlAttribute(null as any)).toBe(true);
      expect(isSafeForHtmlAttribute(undefined as any)).toBe(true);
    });
  });
});