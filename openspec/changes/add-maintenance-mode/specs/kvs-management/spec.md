# Spec: KeyValueStore Management

## ADDED Requirements

### Requirement: CloudFront KeyValueStore Creation
The system SHALL create a CloudFront KeyValueStore to store maintenance mode configuration.

#### Scenario: KeyValueStore created via CDK
**Given** the maintenance mode CDK construct is deployed
**When** the CloudFormation stack is created
**Then** a CloudFront KeyValueStore resource is created
**And** the KVS has a descriptive name like `<stack-name>-maintenance-kvs`

#### Scenario: KeyValueStore accessible by CloudFront Functions
**Given** the KeyValueStore exists
**And** CloudFront Functions are deployed in the same stack
**When** the functions attempt to read from KVS
**Then** they have the necessary permissions
**And** reads succeed with sub-millisecond latency

### Requirement: Maintenance Flag Key in KVS
The KeyValueStore SHALL contain a key named `maintenance` to control whether maintenance mode is active.

#### Scenario: maintenance key initialized to "false"
**Given** the maintenance mode infrastructure is deployed for the first time
**When** the KeyValueStore is created
**Then** it contains a key named `maintenance`
**And** the initial value is `"false"` (string)

#### Scenario: maintenance key set to "true" enables maintenance mode
**Given** the KeyValueStore exists with `maintenance="false"`
**When** an administrator updates the key to `maintenance="true"`
**Then** the CloudFront ViewerRequest function reads the updated value within 60 seconds
**And** subsequent requests trigger maintenance mode behavior

#### Scenario: maintenance key set to "false" disables maintenance mode
**Given** the KeyValueStore has `maintenance="true"` (active)
**When** an administrator updates the key to `maintenance="false"`
**Then** the CloudFront ViewerRequest function reads the updated value within 60 seconds
**And** subsequent requests proceed to the application normally

#### Scenario: maintenance key value is case-insensitive
**Given** the KeyValueStore maintenance key exists
**When** the value is set to `"True"`, `"TRUE"`, or `"true"`
**Then** the function treats all as equivalent to enabled
**And** maintenance mode activates

### Requirement: IP Whitelist Key in KVS
The KeyValueStore SHALL contain a key named `ipWhitelist` to store comma-separated IP addresses allowed to bypass maintenance mode.

#### Scenario: ipWhitelist key initialized to empty string
**Given** the maintenance mode infrastructure is deployed for the first time
**When** the KeyValueStore is created
**Then** it contains a key named `ipWhitelist`
**And** the initial value is `""` (empty string)

#### Scenario: ipWhitelist contains single IP address
**Given** the KeyValueStore exists
**When** an administrator sets `ipWhitelist="203.0.113.1"`
**Then** only clients with IP `203.0.113.1` bypass maintenance mode
**And** all other IPs see the maintenance page

#### Scenario: ipWhitelist contains multiple IP addresses
**Given** the KeyValueStore exists
**When** an administrator sets `ipWhitelist="203.0.113.1,198.51.100.42,192.0.2.10"`
**Then** clients with any of the three IPs bypass maintenance mode
**And** IPs are comma-separated without spaces for parsing simplicity

#### Scenario: ipWhitelist updated dynamically during maintenance
**Given** maintenance mode is active with `ipWhitelist="203.0.113.1"`
**When** an administrator adds a new IP: `ipWhitelist="203.0.113.1,198.51.100.42"`
**Then** the updated whitelist is effective within 60 seconds
**And** the newly added IP can access the application

#### Scenario: ipWhitelist supports IPv6 addresses
**Given** the KeyValueStore exists
**When** an administrator sets `ipWhitelist="2001:db8::1,2001:db8::2"`
**Then** IPv6 clients matching those addresses bypass maintenance mode
**And** the function correctly parses and compares IPv6 format

### Requirement: KVS Value Format Constraints
KeyValueStore values SHALL be stored as strings to comply with CloudFront Functions KVS API limitations.

#### Scenario: Boolean values stored as strings
**Given** maintenance mode state is boolean in concept
**When** stored in KeyValueStore
**Then** the value is `"true"` or `"false"` as a string
**And** not a native boolean type

#### Scenario: IP list stored as comma-separated string
**Given** multiple IPs need to be whitelisted
**When** stored in KeyValueStore
**Then** the value is a single string like `"ip1,ip2,ip3"`
**And** not an array or JSON structure

### Requirement: KVS ARN/ID Export for Console Access
The CDK stack SHALL export the KeyValueStore ARN or ID to facilitate manual updates via AWS Console.

#### Scenario: KVS ARN exported as CloudFormation output
**Given** the maintenance mode infrastructure is deployed
**When** the CloudFormation outputs are examined
**Then** an output named `MaintenanceKVSArn` exists
**And** its value is the full ARN of the KeyValueStore
**And** operators can use this to locate the KVS in AWS Console

#### Scenario: Console navigation using exported ARN
**Given** an operator has the KVS ARN from CloudFormation outputs
**When** they navigate to CloudFront Key value stores in AWS Console
**Then** they can search/filter using the ARN
**And** quickly locate the correct KeyValueStore to edit

### Requirement: KVS Update Propagation Time
Updates to KeyValueStore values SHALL propagate to CloudFront edge locations within a predictable timeframe.

#### Scenario: KVS update propagates within 60 seconds
**Given** an administrator updates a KVS key value
**When** 60 seconds have elapsed
**Then** at least 95% of CloudFront edge locations have the updated value
**And** requests to those edges reflect the new configuration

#### Scenario: KVS propagation during maintenance activation
**Given** `maintenance="false"` initially
**When** an operator sets `maintenance="true"` at time T
**Then** by time T+60 seconds, most users see the maintenance page
**And** edge caches have refreshed KVS values

### Requirement: KVS Console Edit Workflow
The system SHALL support updating KVS values via AWS Console for non-technical operators.

#### Scenario: Edit maintenance flag via Console
**Given** an operator accesses AWS Console
**And** navigates to CloudFront > Key value stores
**And** opens the maintenance KVS
**When** they click "Edit" on the `maintenance` key
**And** change the value from `"false"` to `"true"`
**And** click "Save changes"
**Then** the update is committed
**And** propagation begins immediately

#### Scenario: Edit IP whitelist via Console
**Given** an operator accesses the maintenance KVS in Console
**When** they edit the `ipWhitelist` key
**And** set the value to `"203.0.113.1,198.51.100.42"`
**And** save changes
**Then** the whitelist is updated
**And** those IPs can bypass maintenance mode within 60 seconds

### Requirement: KVS ETag Handling for Updates
KeyValueStore updates SHALL handle ETags correctly to prevent concurrent update conflicts.

#### Scenario: Sequential updates use correct ETags
**Given** the KVS has an ETag from the last update
**When** an operator makes a new update via Console
**Then** the Console automatically retrieves and uses the current ETag
**And** the update succeeds without conflict

#### Scenario: Concurrent update conflict detected
**Given** two operators attempt to update the same KVS key simultaneously
**When** both submit changes
**Then** the second update receives a conflict error
**And** the operator is prompted to retry with the latest value

### Requirement: KVS Access Permissions
CloudFront Functions SHALL have read-only access to the KeyValueStore.

#### Scenario: Function can read KVS values
**Given** a CloudFront Function is associated with the distribution
**When** it calls the KVS API to read a key
**Then** the read succeeds
**And** the current value is returned

#### Scenario: Function cannot write to KVS
**Given** CloudFront Functions' inherent limitations
**When** the function attempts any write operation
**Then** the operation is not supported (CloudFront Functions are read-only)
**And** writes must be done via Console, CLI, or SDK

### Requirement: KVS Error Handling in Functions
CloudFront Functions SHALL handle KVS access failures gracefully without breaking request flow.

#### Scenario: KVS temporarily unavailable
**Given** the KeyValueStore is experiencing temporary issues
**When** a CloudFront Function attempts to read a value
**Then** the read operation fails with an error
**And** the function logs the error
**And** defaults to `maintenance="false"` (fail open)
**And** the request proceeds to the origin

#### Scenario: KVS key missing
**Given** the `maintenance` key is accidentally deleted from KVS
**When** a CloudFront Function tries to read it
**Then** the read returns `undefined` or similar
**And** the function treats this as `maintenance="false"` (safe default)

### Requirement: Initial KVS Key Population
The CDK deployment SHALL initialize the KeyValueStore with default key-value pairs.

#### Scenario: KVS initialized with maintenance=false on first deploy
**Given** the maintenance mode stack is deployed for the first time
**When** the KeyValueStore resource is created
**Then** a CustomResource or similar mechanism populates initial keys
**And** `maintenance="false"` is set
**And** `ipWhitelist=""` is set

#### Scenario: Subsequent deploys preserve KVS values
**Given** the KVS already contains custom values
**When** the CDK stack is updated and redeployed
**Then** existing KVS key values are not overwritten
**And** manual updates are preserved

### Requirement: KVS Validation for Value Format
The system SHALL provide guidance or validation for proper KVS value formats to prevent operator errors.

#### Scenario: Documentation includes value format examples
**Given** an operator reads the maintenance mode documentation
**When** they reach the KVS update section
**Then** they see clear examples of valid values
**And** examples include: `maintenance="true"`, `ipWhitelist="203.0.113.1,198.51.100.42"`

#### Scenario: Invalid IP format in whitelist
**Given** an operator enters `ipWhitelist="203.0.113.1, 198.51.100.42"` (space after comma)
**When** the CloudFront Function parses the whitelist
**Then** it trims whitespace and succeeds
**Or** it logs a warning but continues

### Requirement: KVS Monitoring and Observability
The system SHALL enable monitoring of KVS read operations and values for operational visibility.

#### Scenario: CloudWatch Logs contain KVS read operations
**Given** CloudFront Functions are logging to CloudWatch
**When** a function reads from KVS
**Then** the read operation is logged (if verbose logging enabled)
**And** includes the key name and returned value

#### Scenario: Metric tracking for maintenance mode activations
**Given** an operator wants to track maintenance mode usage
**When** they query CloudWatch Logs Insights
**Then** they can filter for logs where `maintenance="true"` was read
**And** generate reports on maintenance windows
