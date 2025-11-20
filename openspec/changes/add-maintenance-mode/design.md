# Design: Maintenance Mode System

## Architecture Overview

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────┐
│           CloudFront Distribution               │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  ViewerRequest Function                   │ │
│  │  - Check maintenance flag in KVS          │ │
│  │  - Check client IP against whitelist     │ │
│  │  - Redirect to /maintenance.html if needed│ │
│  └───────────────────────────────────────────┘ │
│                     │                           │
│                     ▼                           │
│  ┌───────────────────────────────────────────┐ │
│  │  Origin (S3 or Maintenance S3)            │ │
│  └───────────────────────────────────────────┘ │
│                     │                           │
│                     ▼                           │
│  ┌───────────────────────────────────────────┐ │
│  │  ViewerResponse Function                  │ │
│  │  - Return 503 if maintenance page         │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
                     │
                     ▼
              ┌─────────────┐
              │ KeyValueStore│
              │ - maintenance│
              │ - ipWhitelist│
              └─────────────┘
```

## Component Design

### 1. CloudFront Functions

#### ViewerRequest Function
**Purpose**: Intercept incoming requests and redirect to maintenance page if mode is active.

**Logic Flow**:
```javascript
1. Read KVS values:
   - maintenance: "true" | "false" (string)
   - ipWhitelist: "ip1,ip2,ip3" (comma-separated)

2. If maintenance !== "true":
   → Allow request to proceed normally

3. Parse ipWhitelist into array

4. Get client IP from request

5. If clientIP in ipWhitelist:
   → Allow request to proceed (admin access)

6. If path already is "/maintenance.html" or "/maintenance.css":
   → Allow request to proceed (avoid redirect loop)

7. Otherwise:
   → Redirect to /maintenance.html
```

**Key Considerations**:
- CloudFront Functions have 10KB code size limit
- KVS access is synchronous and fast (< 1ms)
- Client IP available in `event.viewer.ip`
- Must handle both IPv4 and IPv6 addresses

#### ViewerResponse Function
**Purpose**: Set 503 status code for maintenance page responses.

**Logic Flow**:
```javascript
1. If request path matches /maintenance.html or /maintenance.css:
   → Set response status to 503
   → Add Retry-After header (e.g., 3600 seconds)

2. Otherwise:
   → Pass response through unchanged
```

### 2. KeyValueStore

**Schema**:
```json
{
  "maintenance": "false",  // "true" | "false" (string, not boolean)
  "ipWhitelist": "203.0.113.1,198.51.100.42"  // comma-separated IPs
}
```

**Why Strings**: CloudFront Functions KVS API returns values as strings only.

**Access Pattern**:
- Read-heavy (every request checks maintenance flag)
- Write-rare (only when toggling mode or updating whitelist)
- Global replication (edge locations)

**CDK Implementation Note**: Use string replacement to inject KVS ID into function code, similar to reference article approach.

### 3. Maintenance Page S3 Bucket

**Structure**:
```
maintenance-bucket/
├── maintenance.html   (HTML structure, references CSS)
└── maintenance.css    (Styles)
```

**Bucket Configuration**:
- Private bucket (not public)
- CloudFront Origin Access Identity (OAI) for access
- Separate from main application S3 bucket
- Versioning enabled for rollback capability

**HTML Requirements**:
- Link to external CSS: `<link rel="stylesheet" href="/maintenance.css">`
- Clear maintenance message
- Consistent with GenU branding
- No JavaScript dependencies (static only)

**CSS Requirements**:
- Separate file for easier styling updates
- Responsive design
- Accessible color contrast

### 4. CDK Stack Modifications

**New Construct**: `MaintenanceMode` (in `packages/cdk/lib/construct/maintenance-mode.ts`)

**Components Created**:
1. S3 Bucket for maintenance page
2. CloudFront KeyValueStore
3. CloudFront Functions (ViewerRequest, ViewerResponse)
4. CloudFront distribution behavior modification

**Integration Point**: Modify `packages/cdk/lib/construct/web.ts`
- Add maintenance mode construct instantiation
- Attach functions to existing CloudFront distribution
- Add maintenance bucket as additional origin

**CDK Output**: Export KVS ARN for easy identification in console

## Data Flow Scenarios

### Scenario 1: Normal Operation (Maintenance Off)
```
1. User requests /app/chat
2. ViewerRequest reads KVS: maintenance="false"
3. Request proceeds to origin S3 normally
4. User sees application
```

### Scenario 2: Maintenance Mode (Non-Whitelisted User)
```
1. User requests /app/chat
2. ViewerRequest reads KVS: maintenance="true", ipWhitelist="203.0.113.1"
3. Client IP is 198.51.100.50 (not in whitelist)
4. ViewerRequest redirects to /maintenance.html
5. Request goes to maintenance S3 bucket origin
6. ViewerResponse sets status to 503
7. User sees maintenance page with 503 status
```

### Scenario 3: Maintenance Mode (Whitelisted Admin)
```
1. Admin requests /app/chat
2. ViewerRequest reads KVS: maintenance="true", ipWhitelist="203.0.113.1"
3. Client IP is 203.0.113.1 (in whitelist)
4. Request proceeds to origin S3 normally
5. Admin sees application (bypasses maintenance mode)
```

### Scenario 4: CSS Request During Maintenance
```
1. Browser requests /maintenance.css
2. ViewerRequest sees path is /maintenance.css
3. Allows request to proceed (avoid redirect loop)
4. Request goes to maintenance S3 bucket origin
5. CSS file returned successfully
```

## Activation/Deactivation Process

### Activation (Enable Maintenance Mode)
```bash
1. Admin opens AWS Console
2. Navigate to CloudFront → Key value stores
3. Open maintenance KVS (find via CDK output ARN)
4. Edit key "maintenance" → change value to "true"
5. Save changes
6. Wait ~30-60 seconds for edge propagation
7. Verify: non-whitelisted request shows maintenance page
```

### Deactivation (Disable Maintenance Mode)
```bash
1. Admin opens AWS Console
2. Navigate to CloudFront → Key value stores
3. Open maintenance KVS
4. Edit key "maintenance" → change value to "false"
5. Save changes
6. Wait ~30-60 seconds for edge propagation
7. Verify: requests show normal application
```

### IP Whitelist Management
```bash
1. Navigate to maintenance KVS in console
2. Edit key "ipWhitelist"
3. Set value to comma-separated IPs: "203.0.113.1,198.51.100.42"
4. Save changes
5. Test access from whitelisted IP during maintenance mode
```

## Error Handling

### CloudFront Function Failures
**Strategy**: Fail open (allow traffic through)

```javascript
try {
  // KVS access and logic
} catch (error) {
  // Log error (available in CloudWatch)
  // Allow request to proceed to avoid breaking site
  return request;
}
```

### KVS Access Errors
- Log to CloudWatch Logs
- Default to maintenance="false" if read fails
- Continue request processing

### Maintenance Page Load Failures
- CloudFront will return 503/404 naturally
- Consider inline CSS fallback in HTML as backup

## Performance Considerations

### Latency Impact
- CloudFront Functions: < 1ms execution time
- KVS reads: < 1ms (cached at edge)
- Total overhead: < 2ms per request (negligible)

### Caching Strategy
- Maintenance page: Cache-Control: no-cache (always fresh)
- CSS: Cache-Control: max-age=3600 (1 hour, can be longer)
- KVS values: Cached internally by CloudFront Functions

### Edge Propagation Time
- KeyValueStore updates: 30-60 seconds to all edges
- CloudFront Function updates: 2-5 minutes to all edges
- Design accounts for eventual consistency

## Security Considerations

### IP Whitelist Validation
- Validate IP format (IPv4/IPv6) before comparison
- Use exact string match (no CIDR for simplicity in v1)
- Consider future enhancement: CIDR range support

### CloudFront Function Limits
- 10KB code size limit → Keep logic minimal
- No external network calls allowed
- No access to customer data beyond request context

### S3 Bucket Security
- Bucket policy: Only CloudFront OAI can read
- No public access
- Encryption at rest: AES-256

## Monitoring & Observability

### CloudWatch Logs
- CloudFront Function execution logs
- Track maintenance mode activations
- Monitor IP whitelist matches/mismatches

### Metrics to Track
- 503 response count (indicates maintenance mode active)
- Maintenance page requests
- CloudFront Function errors

### Alerts (Future Enhancement)
- Alert on unexpected 503 spike
- Alert on CloudFront Function errors

## Future Enhancements (Not in This Proposal)

1. **CLI Tool**: Script to toggle maintenance mode without console
2. **Lambda API**: REST endpoint for programmatic control
3. **Scheduled Maintenance**: Automated activation at specific times
4. **Dynamic Status**: Real-time status updates on maintenance page
5. **CIDR Support**: IP ranges instead of individual IPs
6. **Admin Dashboard**: In-app maintenance mode toggle

## Testing Strategy

### Unit Tests
- CloudFront Function logic (mock KVS responses)
- IP whitelist parsing
- Redirect logic

### Integration Tests
- Deploy to test environment
- Verify maintenance mode activation
- Test IP whitelist with known IPs
- Verify 503 status codes
- Test CSS loading

### Manual Testing Checklist
- [ ] Toggle maintenance mode on/off
- [ ] Verify propagation time < 60 seconds
- [ ] Test with whitelisted IP (access granted)
- [ ] Test with non-whitelisted IP (maintenance page shown)
- [ ] Verify 503 status code returned
- [ ] Verify CSS loads correctly
- [ ] Test redirect loop prevention
- [ ] Verify error handling (simulate KVS failure)

## Rollback Plan

### If Maintenance Mode Breaks Site
1. Update CloudFront distribution: Remove function associations
2. Wait 2-5 minutes for propagation
3. Site returns to normal operation
4. Fix functions, re-deploy after testing

### If Locked Out (IP Whitelist Misconfigured)
1. Use AWS Console from different network/VPN
2. Update ipWhitelist in KVS
3. Alternative: Use CloudFormation rollback
4. Emergency: Remove function associations entirely

## Documentation Requirements

### For Operators (docs/MAINTENANCE_MODE.md)
- How to activate/deactivate maintenance mode
- How to update IP whitelist
- Expected propagation times
- Troubleshooting guide
- Screenshots of console workflow

### For Developers (README or CONTRIBUTING)
- Architecture overview
- How to modify maintenance page
- How to update CloudFront Functions
- Testing procedures

### For Non-Contributors (docs/HOW_MAINTENANCE_MODE_WORKS.md)
- High-level explanation of the system
- What happens during maintenance mode
- How administrators access during maintenance
- Diagrams and visual explanations
