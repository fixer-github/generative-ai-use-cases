# Spec: CloudFront Maintenance Functions

## ADDED Requirements

### Requirement: ViewerRequest Function for Maintenance Checking
The system SHALL implement a CloudFront Function that executes on viewer request events to determine whether to serve the maintenance page.

#### Scenario: Normal operation with maintenance mode disabled
**Given** the KeyValueStore contains `maintenance="false"`
**When** a user requests any path (e.g., `/app/chat`)
**Then** the request proceeds to the origin without modification
**And** the user sees the normal application

#### Scenario: Maintenance mode enabled for non-whitelisted IP
**Given** the KeyValueStore contains `maintenance="true"` and `ipWhitelist="203.0.113.1"`
**And** the client IP is `198.51.100.50`
**When** the client requests `/app/chat`
**Then** the function redirects the request to `/maintenance.html`
**And** the client receives the maintenance page

#### Scenario: Maintenance mode enabled for whitelisted admin IP
**Given** the KeyValueStore contains `maintenance="true"` and `ipWhitelist="203.0.113.1,198.51.100.42"`
**And** the client IP is `203.0.113.1`
**When** the client requests `/app/chat`
**Then** the request proceeds to the origin without modification
**And** the admin sees the normal application (bypasses maintenance mode)

#### Scenario: Avoid redirect loop for maintenance assets
**Given** the KeyValueStore contains `maintenance="true"`
**And** the client is not whitelisted
**When** the client requests `/maintenance.html` or `/maintenance.css`
**Then** the request proceeds to the maintenance origin without redirect
**And** the maintenance page and CSS load successfully

#### Scenario: IPv6 address in whitelist
**Given** the KeyValueStore contains `maintenance="true"` and `ipWhitelist="2001:db8::1"`
**And** the client IP is `2001:db8::1`
**When** the client requests any path
**Then** the request proceeds to the origin (admin access granted)

#### Scenario: KVS read failure during maintenance check
**Given** the KeyValueStore is temporarily unavailable
**When** a user requests any path
**Then** the function logs the error
**And** the request proceeds to the origin (fail open to avoid site outage)

### Requirement: ViewerResponse Function for Maintenance Status Code
The system SHALL implement a CloudFront Function that executes on viewer response events to set appropriate HTTP status codes for maintenance page responses.

#### Scenario: Maintenance page response gets 503 status
**Given** a request for `/maintenance.html` has been processed
**When** the ViewerResponse function receives the response
**Then** it sets the status code to `503 Service Unavailable`
**And** it adds a `Retry-After: 3600` header (1 hour)

#### Scenario: CSS response gets 503 status during maintenance
**Given** a request for `/maintenance.css` has been processed
**When** the ViewerResponse function receives the response
**Then** it sets the status code to `503 Service Unavailable`
**And** it adds a `Retry-After: 3600` header

#### Scenario: Normal application responses pass through unchanged
**Given** a request for `/app/chat` has been processed
**And** maintenance mode is disabled or user is whitelisted
**When** the ViewerResponse function receives the response
**Then** it passes the response through without modification
**And** the original status code is preserved

### Requirement: CloudFront Function Association with Distribution
The system SHALL attach the ViewerRequest and ViewerResponse functions to the existing CloudFront distribution's default behavior.

#### Scenario: Functions attached to CloudFront distribution
**Given** a CloudFront distribution exists for the GenU application
**When** the maintenance mode infrastructure is deployed via CDK
**Then** the ViewerRequest function is associated with the distribution's viewer request event
**And** the ViewerResponse function is associated with the distribution's viewer response event
**And** both functions execute for all requests to the distribution

### Requirement: IP Address Parsing and Comparison
The ViewerRequest function SHALL parse the IP whitelist from KeyValueStore and compare against the client IP.

#### Scenario: Single IP in whitelist matches client IP
**Given** `ipWhitelist="203.0.113.1"`
**And** client IP is `203.0.113.1`
**When** the function compares IPs
**Then** the match succeeds
**And** the request is allowed to proceed

#### Scenario: Multiple IPs in whitelist with match
**Given** `ipWhitelist="203.0.113.1,198.51.100.42,192.0.2.10"`
**And** client IP is `198.51.100.42`
**When** the function compares IPs
**Then** the match succeeds (second IP matches)
**And** the request is allowed to proceed

#### Scenario: Client IP not in whitelist
**Given** `ipWhitelist="203.0.113.1,198.51.100.42"`
**And** client IP is `192.0.2.50`
**When** the function compares IPs
**Then** the match fails
**And** the request is redirected to maintenance page

#### Scenario: Empty whitelist during maintenance
**Given** `ipWhitelist=""` (empty string)
**And** `maintenance="true"`
**When** any client requests a path
**Then** all requests are redirected to maintenance page
**And** no IPs are whitelisted

#### Scenario: Whitespace in IP whitelist is trimmed
**Given** `ipWhitelist=" 203.0.113.1 , 198.51.100.42 "`
**And** client IP is `198.51.100.42`
**When** the function parses and compares IPs
**Then** the match succeeds (whitespace is trimmed)
**And** the request is allowed to proceed

### Requirement: CloudFront Function Code Size Compliance
The ViewerRequest and ViewerResponse function code SHALL remain within CloudFront Functions' 10KB size limit.

#### Scenario: Function code size within limits
**Given** the ViewerRequest and ViewerResponse functions are implemented
**When** the code is deployed via CDK
**Then** each function's code size is less than 10KB
**And** CloudFront accepts the function deployment

### Requirement: KeyValueStore ID Injection into Function Code
The CDK deployment SHALL inject the actual KeyValueStore ID into the CloudFront Function code.

#### Scenario: KVS ID placeholder replaced during CDK synthesis
**Given** the function code contains a placeholder `"KVS_ID"`
**And** the KeyValueStore is created with a specific ARN/ID
**When** the CDK stack is synthesized
**Then** the placeholder is replaced with the actual KeyValueStore ID
**And** the function code can successfully access the KVS at runtime

### Requirement: Error Logging for Maintenance Function
The ViewerRequest function SHALL log errors to CloudWatch Logs when KVS access or IP checking fails.

#### Scenario: KVS access error logged
**Given** the KeyValueStore is temporarily unavailable
**When** the function attempts to read the maintenance flag
**Then** an error is logged to CloudWatch Logs
**And** the log entry contains the error message and request details

#### Scenario: IP parsing error logged
**Given** the ipWhitelist contains invalid data
**When** the function attempts to parse IPs
**Then** a warning is logged to CloudWatch Logs
**And** the function continues with an empty whitelist (fail safe)
