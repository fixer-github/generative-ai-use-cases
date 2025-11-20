# Spec: Maintenance Page Storage

## ADDED Requirements

### Requirement: Dedicated S3 Bucket for Maintenance Assets
The system SHALL create a separate S3 bucket to store maintenance page HTML and CSS files, isolated from the main application S3 bucket.

#### Scenario: Maintenance S3 bucket created via CDK
**Given** the maintenance mode CDK construct is deployed
**When** the CloudFormation stack is created
**Then** a new S3 bucket is created with a name like `<stack-name>-maintenance-assets-<hash>`
**And** the bucket is private (no public access)
**And** the bucket has versioning enabled

#### Scenario: Maintenance bucket has separate lifecycle from main app
**Given** both maintenance bucket and main application bucket exist
**When** the main application is updated/deployed
**Then** the maintenance bucket contents remain unchanged
**And** maintenance page availability is independent of app deployments

### Requirement: CloudFront Origin Access Identity for Maintenance Bucket
The maintenance S3 bucket SHALL be accessible only via CloudFront using Origin Access Identity (OAI).

#### Scenario: Maintenance bucket policy restricts access to CloudFront OAI
**Given** the maintenance S3 bucket exists
**And** a CloudFront OAI is created for maintenance access
**When** the bucket policy is applied
**Then** only the CloudFront OAI can read objects from the bucket
**And** direct public access to bucket objects is denied

#### Scenario: CloudFront can retrieve maintenance page from bucket
**Given** the maintenance bucket contains `maintenance.html`
**And** CloudFront distribution has OAI configured
**When** CloudFront requests the maintenance page
**Then** the request succeeds
**And** the HTML content is returned

### Requirement: Maintenance HTML File Structure
The maintenance bucket SHALL contain a static HTML file that displays a maintenance message and links to external CSS.

#### Scenario: maintenance.html exists in bucket
**Given** the maintenance mode infrastructure is deployed
**When** the maintenance bucket is examined
**Then** a file named `maintenance.html` exists at the root
**And** the file is a valid HTML5 document

#### Scenario: maintenance.html links to external CSS
**Given** `maintenance.html` is loaded
**When** the HTML is parsed
**Then** it contains a `<link>` tag with `href="/maintenance.css"`
**And** the CSS is loaded from the same CloudFront distribution

#### Scenario: maintenance.html displays clear maintenance message
**Given** a user accesses the maintenance page
**When** the page renders
**Then** it displays a clear message explaining the system is under maintenance
**And** the message is in the application's primary language (English by default)
**And** the page includes GenU branding elements

#### Scenario: maintenance.html is mobile-responsive
**Given** `maintenance.html` is accessed on a mobile device
**When** the page renders
**Then** the layout adapts to the viewport size
**And** text is readable without horizontal scrolling
**And** touch targets meet accessibility standards

### Requirement: Maintenance CSS File
The maintenance bucket SHALL contain a separate CSS file for styling the maintenance page.

#### Scenario: maintenance.css exists in bucket
**Given** the maintenance mode infrastructure is deployed
**When** the maintenance bucket is examined
**Then** a file named `maintenance.css` exists at the root

#### Scenario: maintenance.css applies GenU-consistent styling
**Given** the maintenance page is loaded
**When** `maintenance.css` is applied
**Then** colors match the GenU brand palette
**And** fonts are consistent with the application
**And** the visual style feels cohesive with GenU

#### Scenario: CSS is cacheable for performance
**Given** `maintenance.css` is requested
**When** CloudFront serves the response
**Then** it includes `Cache-Control: public, max-age=3600` header
**And** subsequent requests within 1 hour are served from cache

### Requirement: Maintenance Page Deployment Process
The system SHALL provide a mechanism to update maintenance page content without redeploying infrastructure.

#### Scenario: Upload new maintenance.html via AWS Console
**Given** an administrator wants to update the maintenance message
**When** they upload a new `maintenance.html` to the maintenance S3 bucket via AWS Console
**Then** the file is updated immediately
**And** the next request for the maintenance page shows the new content

#### Scenario: Upload new maintenance.css via CLI
**Given** an administrator wants to update styling
**When** they run `aws s3 cp maintenance.css s3://<maintenance-bucket>/maintenance.css`
**Then** the CSS file is updated
**And** CloudFront cache expires after 1 hour
**And** new requests after cache expiry show the new styles

#### Scenario: CloudFront cache invalidation for immediate updates
**Given** the maintenance page or CSS has been updated
**When** an administrator runs `aws cloudfront create-invalidation --paths /maintenance.html /maintenance.css`
**Then** CloudFront cache is immediately invalidated
**And** the next request shows updated content

### Requirement: CloudFront Origin Configuration for Maintenance Bucket
The CloudFront distribution SHALL include the maintenance S3 bucket as an additional origin.

#### Scenario: Maintenance bucket added as CloudFront origin
**Given** the maintenance mode infrastructure is deployed
**When** the CloudFront distribution configuration is examined
**Then** it contains an origin pointing to the maintenance S3 bucket
**And** the origin uses the CloudFront OAI for authentication

#### Scenario: Maintenance origin serves specific paths
**Given** a request is made for `/maintenance.html`
**When** the ViewerRequest function processes the request
**Then** the request is routed to the maintenance bucket origin
**And** not the main application origin

### Requirement: Maintenance Page Cache Behavior
The maintenance page HTML SHALL have appropriate cache headers to ensure freshness during maintenance events.

#### Scenario: maintenance.html has no-cache directive
**Given** `maintenance.html` is requested
**When** CloudFront serves the response
**Then** it includes `Cache-Control: no-cache, no-store, must-revalidate` header
**And** it includes `Pragma: no-cache` header (for HTTP/1.0 compatibility)
**And** users always see the current maintenance status

### Requirement: Maintenance Page Accessibility
The maintenance page SHALL meet basic web accessibility standards.

#### Scenario: maintenance.html has semantic HTML structure
**Given** the maintenance page HTML is analyzed
**When** checked against HTML5 semantic standards
**Then** it uses appropriate semantic elements (`<main>`, `<h1>`, etc.)
**And** it includes a valid `<title>` element

#### Scenario: maintenance page has sufficient color contrast
**Given** the maintenance page is rendered with CSS
**When** color contrast is measured
**Then** text-to-background contrast meets WCAG AA standards (4.5:1 minimum)

#### Scenario: maintenance page includes meta viewport for mobile
**Given** `maintenance.html` is examined
**When** the `<head>` section is parsed
**Then** it includes `<meta name="viewport" content="width=device-width, initial-scale=1">`

### Requirement: Error Handling for Missing Assets
The system SHALL handle cases where maintenance assets fail to load.

#### Scenario: maintenance.html missing from bucket
**Given** the maintenance mode is enabled
**And** `maintenance.html` is accidentally deleted from the bucket
**When** a non-whitelisted user requests a path
**Then** CloudFront returns a 404 error
**And** the error is logged in CloudWatch

#### Scenario: maintenance.css missing but HTML loads
**Given** `maintenance.html` exists but `maintenance.css` is missing
**When** a user loads the maintenance page
**Then** the HTML loads successfully
**And** basic unstyled content is visible (HTML-only fallback)

### Requirement: S3 Bucket Encryption
The maintenance S3 bucket SHALL have encryption at rest enabled.

#### Scenario: Bucket encryption configured during creation
**Given** the maintenance mode CDK construct is deployed
**When** the S3 bucket is created
**Then** server-side encryption with AES-256 is enabled by default
**And** all objects stored in the bucket are encrypted at rest

### Requirement: CDK Output for Maintenance Bucket
The CDK stack SHALL export the maintenance bucket name for operational reference.

#### Scenario: Maintenance bucket name exported as CloudFormation output
**Given** the maintenance mode infrastructure is deployed
**When** the CloudFormation outputs are examined
**Then** an output named `MaintenanceBucketName` exists
**And** its value is the S3 bucket name
**And** operators can easily identify which bucket to update
