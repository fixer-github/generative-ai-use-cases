/**
 * Authorization System Type Definitions
 * 認可システムの型定義
 */

// ============================================================================
// Plan & Subscription Types
// プラン・サブスクリプション型
// ============================================================================

/**
 * Plan tier identifier
 */
export type PlanTier = 'free' | 'pro' | 'enterprise';

/**
 * Subscription status
 */
export type SubscriptionStatus = 'active' | 'inactive' | 'suspended' | 'canceled';

/**
 * Usecase configuration for a plan
 */
export interface UsecaseConfig {
  /** Whether this usecase is enabled */
  enabled: boolean;
  /** Optional description */
  description?: string;
}

/**
 * Model configuration with quotas
 */
export interface ModelConfig {
  /** Whether this model is allowed */
  enabled: boolean;
  /** Daily usage quota */
  daily_quota: number;
  /** Monthly usage quota */
  monthly_quota: number;
  /** Burst limit for short-term spikes */
  burst_limit?: number;
}

/**
 * Resource limits for a plan
 */
export interface ResourceLimits {
  /** Maximum number of conversations to store */
  max_conversations: number;
  /** Maximum document storage in MB */
  max_documents_mb: number;
  /** Maximum file upload size in MB */
  max_file_upload_mb: number;
  /** Number of days to keep conversation history */
  conversation_history_days: number;
}

/**
 * Admin operation permissions
 */
export interface AdminOperationPermissions {
  /** Can invite new users */
  invite_user: boolean;
  /** Can manage existing users */
  manage_users: boolean;
  /** Can view usage statistics */
  view_usage: boolean;
  /** Can export data */
  export_data: boolean;
  /** Can access audit logs */
  view_audit_logs?: boolean;
}

/**
 * Complete plan features definition
 */
export interface PlanFeatures {
  /** Maximum number of users */
  max_users: number;
  /** Usecase permissions */
  usecases: Record<string, UsecaseConfig>;
  /** Model permissions and quotas */
  models: Record<string, ModelConfig>;
  /** Resource limits */
  resources: ResourceLimits;
  /** Admin operation permissions */
  admin_operations: AdminOperationPermissions;
}

/**
 * Complete plan definition
 */
export interface Plan {
  /** Unique plan identifier */
  plan_id: string;
  /** Display name */
  plan_name: string;
  /** Monthly price in USD */
  price_usd_monthly: number;
  /** Plan description */
  description?: string;
  /** Feature configuration */
  features: PlanFeatures;
  /** Stripe price ID for integration */
  stripe_price_id?: string;
  /** Creation timestamp */
  created_at: number;
  /** Last update timestamp */
  updated_at: number;
}

/**
 * Tenant plan assignment
 */
export interface TenantPlan {
  /** Tenant identifier */
  tenant_id: string;
  /** Assigned plan ID */
  plan_id: string;
  /** Plan display name */
  plan_name: string;
  /** Stripe subscription ID */
  stripe_subscription_id?: string;
  /** Stripe customer ID */
  stripe_customer_id?: string;
  /** Subscription start date */
  start_date: number;
  /** Subscription end date (if applicable) */
  end_date?: number;
  /** Current status */
  status: SubscriptionStatus;
}

// ============================================================================
// Authorization Types
// 認可型
// ============================================================================

/**
 * Authorization provider type
 */
export type AuthzProvider = 'openfga' | 'spicedb' | 'both';

/**
 * Resource type for authorization checks
 */
export type ResourceType =
  | 'conversation'
  | 'document'
  | 'usecase'
  | 'model'
  | 'admin_operation'
  | 'tenant';

/**
 * Permission action
 */
export type PermissionAction =
  | 'view'
  | 'edit'
  | 'delete'
  | 'create'
  | 'execute'
  | 'manage';

/**
 * Authorization decision effect
 */
export type AuthzEffect = 'Allow' | 'Deny';

/**
 * Resource information for authorization checks
 */
export interface ResourceInfo {
  /** Resource type */
  type: ResourceType;
  /** Resource identifier */
  id: string;
  /** Requested action */
  action: PermissionAction;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Authorization check parameters
 */
export interface AuthzCheckParams {
  /** User ID requesting access */
  userId: string;
  /** Tenant ID */
  tenantId: string;
  /** Whether user is tenant admin */
  isTenantAdmin: boolean;
  /** Current plan information */
  planInfo: PlanInfo;
  /** Resource information */
  resourceInfo: ResourceInfo;
  /** Additional context */
  context?: Record<string, any>;
}

/**
 * Authorization decision result
 */
export interface AuthzDecision {
  /** Allow or Deny */
  effect: AuthzEffect;
  /** Reason for the decision */
  reason: string;
  /** Check latency in milliseconds */
  latency_ms: number;
  /** Provider that made the decision */
  provider: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Simplified plan info for authorization checks
 */
export interface PlanInfo {
  /** Plan ID */
  plan_id: string;
  /** Plan name */
  plan_name: string;
  /** Plan permissions */
  permissions: {
    usecases: Record<string, boolean>;
    models: Record<string, { allowed: boolean; daily_quota: number }>;
  };
}

// ============================================================================
// Usage Tracking Types
// 使用量追跡型
// ============================================================================

/**
 * Usage event for tracking
 */
export interface UsageEvent {
  /** Tenant ID */
  tenantId: string;
  /** User ID */
  userId: string;
  /** Plan ID */
  planId: string;
  /** Resource type */
  resourceType: string;
  /** Resource ID */
  resourceId: string;
  /** Model used */
  model: string;
  /** Event timestamp */
  timestamp: number;
  /** Event unique ID (for idempotency) */
  event_id?: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Usage counter record
 */
export interface UsageCounter {
  /** Partition key: tenant_id#resource_type */
  pk: string;
  /** Sort key: date#model */
  sk: string;
  /** Tenant ID */
  tenant_id: string;
  /** Model identifier */
  model: string;
  /** Usage count */
  count: number;
  /** Quota limit */
  quota_limit: number;
  /** Date (YYYY-MM-DD) */
  date: string;
  /** Last reset timestamp */
  last_reset: number;
  /** Last update timestamp */
  last_update?: number;
  /** Last user who triggered usage */
  last_user_id?: string;
  /** Plan ID at time of usage */
  plan_id?: string;
  /** TTL for automatic deletion */
  ttl?: number;
}

/**
 * Quota usage summary
 */
export interface QuotaUsage {
  /** Model identifier */
  model: string;
  /** Current usage count */
  current: number;
  /** Quota limit */
  limit: number;
  /** Utilization percentage */
  utilization: number;
  /** Individual date breakdowns */
  dates?: Array<{
    date: string;
    count: number;
  }>;
}

/**
 * Tenant quota summary
 */
export interface TenantQuotaSummary {
  /** Tenant ID */
  tenant_id: string;
  /** Plan ID */
  plan_id: string;
  /** Usage by model */
  usage: Record<string, QuotaUsage>;
  /** Last update timestamp */
  last_update: number;
}

// ============================================================================
// OpenFGA Types
// OpenFGA型
// ============================================================================

/**
 * OpenFGA tuple
 */
export interface OpenFGATuple {
  /** User (subject) */
  user: string;
  /** Relation */
  relation: string;
  /** Object (resource) */
  object: string;
  /** Optional condition */
  condition?: {
    name: string;
    context: Record<string, any>;
  };
}

/**
 * OpenFGA check request
 */
export interface OpenFGACheckRequest {
  /** User to check */
  user: string;
  /** Relation to check */
  relation: string;
  /** Object to check */
  object: string;
  /** Contextual tuples */
  contextual_tuples?: OpenFGATuple[];
  /** Context for conditions */
  context?: Record<string, any>;
}

/**
 * OpenFGA check response
 */
export interface OpenFGACheckResponse {
  /** Whether permission is granted */
  allowed: boolean;
  /** Resolution metadata */
  resolution?: string;
}

/**
 * OpenFGA store configuration
 */
export interface OpenFGAStoreConfig {
  /** Store ID */
  store_id: string;
  /** Store name */
  name: string;
  /** Tenant ID this store belongs to */
  tenant_id: string;
  /** Authorization model ID */
  authorization_model_id: string;
  /** Creation timestamp */
  created_at: number;
}

// ============================================================================
// SpiceDB Types
// SpiceDB型
// ============================================================================

/**
 * SpiceDB relationship
 */
export interface SpiceDBRelationship {
  /** Resource */
  resource: {
    objectType: string;
    objectId: string;
  };
  /** Relation */
  relation: string;
  /** Subject */
  subject: {
    object: {
      objectType: string;
      objectId: string;
    };
    optionalRelation?: string;
  };
}

/**
 * SpiceDB permission check request
 */
export interface SpiceDBCheckRequest {
  /** Resource to check */
  resource: {
    objectType: string;
    objectId: string;
  };
  /** Permission to check */
  permission: string;
  /** Subject requesting permission */
  subject: {
    object: {
      objectType: string;
      objectId: string;
    };
  };
  /** Context for caveats */
  context?: Record<string, any>;
}

/**
 * SpiceDB permissionship result
 */
export type SpiceDBPermissionship =
  | 'PERMISSIONSHIP_UNSPECIFIED'
  | 'PERMISSIONSHIP_NO_PERMISSION'
  | 'PERMISSIONSHIP_HAS_PERMISSION'
  | 'PERMISSIONSHIP_CONDITIONAL_PERMISSION';

/**
 * SpiceDB check response
 */
export interface SpiceDBCheckResponse {
  /** Permissionship status */
  permissionship: SpiceDBPermissionship;
  /** Partial caveat info (if conditional) */
  partialCaveatInfo?: any;
}

/**
 * SpiceDB namespace configuration
 */
export interface SpiceDBNamespaceConfig {
  /** Namespace name */
  namespace: string;
  /** Tenant ID */
  tenant_id: string;
  /** Schema version */
  schema_version: string;
  /** Creation timestamp */
  created_at: number;
}

// ============================================================================
// Lambda Authorizer Types
// Lambda Authorizer型
// ============================================================================

/**
 * Cognito JWT payload
 */
export interface CognitoJWTPayload {
  /** Subject (user ID) */
  sub: string;
  /** Email */
  email?: string;
  /** Tenant ID custom claim */
  'custom:tenant_id': string;
  /** Tenant admin custom claim */
  'custom:tenantAdmin'?: string;
  /** Token use */
  token_use: 'access' | 'id';
  /** Issued at */
  iat: number;
  /** Expiration */
  exp: number;
}

/**
 * Authorizer context passed to backend
 */
export interface AuthorizerContext {
  /** User ID */
  userId: string;
  /** Tenant ID */
  tenantId: string;
  /** Plan ID */
  planId: string;
  /** Resource type */
  resourceType: string;
  /** Resource ID */
  resourceId: string;
  /** Whether user is tenant admin */
  isTenantAdmin?: string;
}

// ============================================================================
// Metrics & Monitoring Types
// メトリクス・モニタリング型
// ============================================================================

/**
 * Authorization metrics
 */
export interface AuthzMetrics {
  /** Metric name */
  metric_name: string;
  /** Metric value */
  value: number;
  /** Unit */
  unit: 'Count' | 'Milliseconds' | 'Percent';
  /** Dimensions */
  dimensions: Array<{
    name: string;
    value: string;
  }>;
  /** Timestamp */
  timestamp: number;
}

/**
 * Quota alert configuration
 */
export interface QuotaAlertConfig {
  /** Tenant ID */
  tenant_id: string;
  /** Model to monitor */
  model: string;
  /** Threshold percentage (0-100) */
  threshold_percent: number;
  /** SNS topic ARN for alerts */
  alert_topic_arn: string;
  /** Whether alert is enabled */
  enabled: boolean;
}

/**
 * Quota alert event
 */
export interface QuotaAlertEvent {
  /** Tenant ID */
  tenant_id: string;
  /** Model */
  model: string;
  /** Current usage */
  current_count: number;
  /** Quota limit */
  quota_limit: number;
  /** Utilization percentage */
  utilization_percent: number;
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Timestamp */
  timestamp: number;
  /** Additional message */
  message?: string;
}

// ============================================================================
// CDK Construct Props
// CDK Construct Props型
// ============================================================================

/**
 * Authorization system construct props
 */
export interface AuthorizationSystemProps {
  /** Cognito User Pool */
  userPool: any; // aws-cdk-lib.aws-cognito.IUserPool
  /** Authorization provider to use */
  authzProvider: AuthzProvider;
  /** Enable OpenFGA */
  enableOpenFGA: boolean;
  /** Enable SpiceDB */
  enableSpiceDB: boolean;
  /** OpenFGA API URL (if using OpenFGA) */
  openFGAApiUrl?: string;
  /** SpiceDB endpoint (if using SpiceDB) */
  spiceDBEndpoint?: string;
  /** VPC for SpiceDB (if using SpiceDB) */
  vpc?: any; // aws-cdk-lib.aws-ec2.IVpc
  /** Environment name */
  environment?: string;
}

/**
 * Plan quota store construct props
 */
export interface PlanQuotaStoreProps {
  /** Enable point-in-time recovery */
  pointInTimeRecovery?: boolean;
  /** Enable DynamoDB Stream */
  stream?: boolean;
  /** TTL attribute name for automatic deletion */
  ttlAttributeName?: string;
}

/**
 * OpenFGA tenant construct props
 */
export interface OpenFGATenantProps {
  /** Tenant ID */
  tenantId: string;
  /** OpenFGA API URL */
  apiUrl: string;
  /** Authorization model */
  authorizationModel?: string;
}

/**
 * Usage tracker construct props
 */
export interface UsageTrackerProps {
  /** DynamoDB usage table */
  usageTable: any; // aws-cdk-lib.aws-dynamodb.ITable
  /** Quota alert topic */
  alertTopic: any; // aws-cdk-lib.aws-sns.ITopic
  /** Enable quota alerts */
  enableAlerts: boolean;
}
