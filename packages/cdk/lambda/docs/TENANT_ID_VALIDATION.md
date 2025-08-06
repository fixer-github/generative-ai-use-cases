# Tenant ID Validation Guide

## Overview

This document outlines the validation requirements and implementation strategy for tenant IDs in the multi-tenant architecture. Proper validation is crucial for security, AWS resource naming compatibility, and data isolation.

## Validation Requirements

### 1. Format Requirements

- **Length**: 1-63 characters (AWS resource naming limit)
- **Characters**: Alphanumeric, hyphens, and underscores only
- **Start/End**: Must begin and end with alphanumeric characters
- **Pattern**: `^[a-zA-Z0-9][a-zA-Z0-9-_]*[a-zA-Z0-9]$`

### 2. Security Constraints

#### Reserved Keywords
The following keywords should be rejected or require special handling:
- `default` - Reserved for backwards compatibility
- `admin`, `root`, `system` - Security concerns
- `aws`, `amazon` - AWS reserved prefixes
- `null`, `undefined`, `none` - Could cause parsing issues
- `test`, `demo` - May conflict with test environments

#### Injection Prevention
- **SQL Injection**: Block SQL keywords (SELECT, DROP, INSERT, etc.)
- **Path Traversal**: Reject `..`, `//`, `\` patterns
- **Special Characters**: Block `;`, `'`, `"`, `` ` ``, `#`, `$`, `%`, `&`, `*`, etc.
- **Command Injection**: Reject shell metacharacters

### 3. Malformed Tenant ID Examples

```typescript
// SQL Injection Attempts
"company'; DROP TABLE users--"     // SQL injection with DROP
"1 OR 1=1"                         // Boolean SQL injection
"admin' UNION SELECT * FROM--"     // UNION-based injection
"'; DELETE FROM users WHERE '1'='1" // DELETE injection

// Path Traversal Attacks
"../admin"                         // Parent directory access
"../../etc/passwd"                 // System file access
"company/../../../root"            // Multiple traversals
".\\windows\\system32"             // Windows path injection

// Special Characters (AWS Incompatible)
"company@domain.com"               // @ not allowed in table names
"company#123"                      // # is DynamoDB reserved
"tenant$name"                      // $ causes issues
"my-company!"                      // ! is invalid
"tenant name"                      // Spaces not allowed
"company/division"                 // / causes path issues
"tenant;malicious"                 // ; could be command separator

// Length Violations
"a".repeat(100)                    // Exceeds 63 character limit
""                                 // Empty string
"   "                             // Only whitespace
"a"                               // Too short (depending on requirements)

// Format Issues
"-tenant-"                        // Starts/ends with hyphen
"123-"                            // Ends with non-alphanumeric
"_tenant"                         // Starts with underscore
"tenant_"                         // Ends with underscore
"--double-hyphen"                 // Starts with double hyphen

// Reserved Keywords
"default"                         // Reserved for system use
"system"                          // Could conflict with internals
"admin"                           // Security concern
"aws"                            // AWS prefix
"amazon"                         // AWS related
"cognito"                        // AWS service name
```

## Implementation Strategy

### Phase 1: Basic Validation (Current)
- Length check (1-63 characters)
- Basic character validation
- Default tenant fallback

### Phase 2: Security Validation (To Implement)
```typescript
interface ValidationResult {
  valid: boolean;
  sanitized?: string;
  error?: string;
  severity?: 'error' | 'warning';
}

class TenantIdValidator {
  // Validate against all rules
  static validate(tenantId: string): ValidationResult;
  
  // Attempt to sanitize invalid IDs
  static sanitize(tenantId: string): string;
  
  // Check if ID is reserved
  static isReserved(tenantId: string): boolean;
  
  // Check for injection patterns
  static hasInjectionPattern(tenantId: string): boolean;
}
```

### Phase 3: Advanced Features
- Custom validation rules per environment
- Tenant ID allowlist/blocklist
- Automatic sanitization with logging
- Metrics and monitoring for validation failures

## Validation Locations

### 1. Pre-Token Generation Lambda
- First line of defense
- Validates during token creation
- Can sanitize or reject invalid IDs

### 2. API Gateway Authorizer
- Secondary validation
- Can reject requests with invalid tenant IDs
- Performance-optimized caching

### 3. Repository Layer
- Final validation before DynamoDB operations
- Logs warnings for suspicious patterns
- Falls back to default tenant on critical errors

## Error Handling Strategy

### User-Facing Errors
```json
{
  "error": "INVALID_TENANT_ID",
  "message": "The provided tenant identifier is invalid",
  "details": "Tenant ID must be 1-63 alphanumeric characters"
}
```

### Internal Logging
```typescript
console.error('Tenant validation failed', {
  original: 'company@domain.com',
  sanitized: 'company-domain-com',
  reason: 'Invalid characters: @, .',
  action: 'Sanitized and proceeded'
});
```

## Testing Checklist

### Positive Test Cases
- [ ] Valid alphanumeric IDs: `company123`, `tenant-abc`, `org_xyz`
- [ ] Maximum length (63 chars)
- [ ] Minimum length (2 chars recommended)
- [ ] Mixed case: `CompanyName`, `TenantID`

### Negative Test Cases
- [ ] SQL injection patterns
- [ ] Path traversal attempts
- [ ] Special characters
- [ ] Reserved keywords
- [ ] Empty/whitespace only
- [ ] Length violations
- [ ] Format violations

### Edge Cases
- [ ] Unicode characters
- [ ] Emoji in tenant ID
- [ ] RTL (Right-to-Left) characters
- [ ] Zero-width characters
- [ ] Control characters

## Security Considerations

1. **Log Validation Failures**: Track patterns for security monitoring
2. **Rate Limiting**: Prevent validation DoS attacks
3. **Sanitization Audit**: Log all sanitization events
4. **Regular Pattern Updates**: Update injection patterns regularly
5. **Fail Secure**: Default to safe tenant on validation errors

## Performance Optimization

1. **Caching**: Cache validation results for repeated IDs
2. **Regex Compilation**: Pre-compile validation patterns
3. **Early Rejection**: Check length/format before complex validation
4. **Batch Validation**: Validate multiple IDs efficiently

## Migration Path

1. **Soft Validation**: Log warnings without blocking
2. **Monitoring Period**: Collect data on invalid patterns
3. **Communication**: Notify users of upcoming validation
4. **Grace Period**: Allow time for ID migration
5. **Hard Validation**: Enforce strict validation

## References

- [AWS Resource Naming Restrictions](https://docs.aws.amazon.com/general/latest/gr/aws_service_limits.html)
- [DynamoDB Naming Rules](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html)
- [OWASP Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html)
- [AWS IAM Tag-Based Access Control](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_tags.html)