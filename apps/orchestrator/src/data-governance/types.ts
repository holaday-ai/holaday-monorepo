export const DATA_CATEGORY_IDS = [
  'account_security',
  'task_execution',
  'cross_task_memory',
  'energy_astrology_profile',
  'stock_preference_profile',
  'feedback_support',
  'external_notifications',
  'extension_site_stats',
  'extension_login_cookies',
  'payments_entitlements',
  'partner_kyc_ledger',
  'media_assets',
  'analytics_logs',
] as const;

export type DataCategoryId = (typeof DATA_CATEGORY_IDS)[number];

export type ProcessorId =
  | 'holaday_internal'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'dashscope'
  | 'fal_ai'
  | 'divineapi'
  | 'firecrawl'
  | 'apify'
  | 'zapier'
  | 'resend'
  | 'sms_gateway'
  | 'paypal'
  | 'china_payment'
  | 'wecom'
  | 'feishu'
  | 'dingtalk'
  | 'custom_webhook'
  | 'vultr'
  | 'cloudflare_r2'
  | 'aliyun';

export type RetentionPolicyId =
  | 'account_purpose_bound'
  | 'task_visibility_unified_unknown'
  | 'memory_entry_lifecycle'
  | 'browser_local_until_clear'
  | 'stock_profile_mixed'
  | 'feedback_purpose_bound'
  | 'notification_config_until_change'
  | 'domain_snapshot_replace'
  | 'cookie_injection_mixed'
  | 'transaction_restricted'
  | 'partner_financial_restricted'
  | 'media_mixed'
  | 'analytics_configured_mixed';

export type LocalRetentionRegimeId = 'task_30d' | 'audit_180d' | 'manual_hold';

export type RightsCapabilityId =
  | 'account_manual_request'
  | 'task_manual_request'
  | 'memory_self_service'
  | 'astrology_local_self_service'
  | 'stock_profile_self_service'
  | 'feedback_manual_request'
  | 'notification_self_service'
  | 'extension_stats_manual_request'
  | 'extension_cookie_mixed'
  | 'payment_restricted_request'
  | 'partner_restricted_request'
  | 'media_mixed_control'
  | 'analytics_manual_request';

export type GovernanceCapabilityStatus =
  | 'implemented'
  | 'manual'
  | 'not_implemented'
  | 'not_applicable';

export type VerificationStatus =
  | 'verified_in_code'
  | 'verified_operationally'
  | 'unknown'
  | 'pending_legal_review';

export interface SourceEvidence {
  readonly kind: 'source_file' | 'exported_symbol' | 'operational_entrypoint';
  readonly path: string;
  readonly symbol?: string;
  readonly fact: string;
}

export interface DataCategoryDefinition {
  readonly id: DataCategoryId;
  readonly displayName: string;
  readonly description: string;
  readonly dataElements: readonly string[];
  readonly sources: readonly string[];
  readonly purposes: readonly string[];
  readonly sensitivity: 'standard' | 'sensitive' | 'highly_sensitive';
  readonly storageLocations: readonly string[];
  readonly processorIds: readonly ProcessorId[];
  readonly retentionPolicyId: RetentionPolicyId;
  readonly rightsCapabilityId: RightsCapabilityId;
  readonly evidence: readonly SourceEvidence[];
}

export interface ProcessorDefinition {
  readonly id: ProcessorId;
  readonly displayName: string;
  readonly purposes: readonly string[];
  readonly categoryIds: readonly DataCategoryId[];
  readonly activation: {
    readonly mode: 'always_internal' | 'feature_conditional' | 'user_configured';
    readonly configKeys?: readonly string[];
    readonly evidence: readonly SourceEvidence[];
  };
  readonly regionStatus: VerificationStatus;
  readonly legalReviewStatus: VerificationStatus;
}

export interface LocalRetentionRegimeDefinition {
  readonly id: LocalRetentionRegimeId;
  readonly boundary: string;
  readonly automationStatus: GovernanceCapabilityStatus;
  readonly activation: {
    readonly mode: 'feature_conditional';
    readonly enabledByDefault: false;
    readonly configKeys: readonly string[];
  };
  readonly evidence: readonly SourceEvidence[];
}

export interface RetentionPolicyDefinition {
  readonly id: RetentionPolicyId;
  readonly trigger: string;
  readonly rule:
    | { readonly kind: 'fixed_days'; readonly days: number }
    | { readonly kind: 'until_user_action'; readonly action: string }
    | { readonly kind: 'purpose_bound'; readonly description: string }
    | { readonly kind: 'mixed'; readonly description: string }
    | { readonly kind: 'unknown'; readonly reason: string };
  readonly automationStatus: GovernanceCapabilityStatus;
  readonly retryStatus: GovernanceCapabilityStatus;
  readonly evidence: readonly SourceEvidence[];
  readonly localRegimes?: readonly LocalRetentionRegimeDefinition[];
}

export interface CapabilityDefinition {
  readonly status: GovernanceCapabilityStatus;
  readonly handlerRef?: string;
  readonly manualEntrypoint?: string;
  readonly scope: string;
  readonly limitations: readonly string[];
  readonly evidence: readonly SourceEvidence[];
}

export interface RightsCapability {
  readonly id: RightsCapabilityId;
  readonly export: CapabilityDefinition;
  readonly delete: CapabilityDefinition;
  readonly correct: CapabilityDefinition;
  readonly pause: CapabilityDefinition;
  readonly withdraw: CapabilityDefinition;
}

export interface PublicDisclosureDefinition {
  readonly categoryId: DataCategoryId;
  readonly spaLabel: string;
  readonly landingLabel: string;
  readonly requiredBoundaries: readonly string[];
  readonly publiclyDisclosed: boolean;
}

export interface GovernanceRegistryBundle {
  readonly categories: readonly DataCategoryDefinition[];
  readonly processors: readonly ProcessorDefinition[];
  readonly retentionPolicies: readonly RetentionPolicyDefinition[];
  readonly rightsCapabilities: readonly RightsCapability[];
  readonly publicDisclosures: readonly PublicDisclosureDefinition[];
}

export interface AuditIssue {
  severity: 'error' | 'gap';
  code:
    | 'invalid_id'
    | 'duplicate_id'
    | 'dangling_reference'
    | 'missing_evidence'
    | 'implemented_handler_missing'
    | 'manual_entrypoint_missing'
    | 'not_implemented_handler_present'
    | 'unknown_reason_missing'
    | 'invalid_fixed_days'
    | 'fixed_days_automation_missing'
    | 'processor_category_mismatch'
    | 'source_evidence_missing'
    | 'evidence_symbol_missing'
    | 'public_disclosure_missing'
    | 'public_disclosure_duplicate'
    | 'public_disclosure_unknown_category'
    | 'required_string_missing'
    | 'required_array_empty'
    | 'invalid_enum_value'
    | 'invalid_evidence'
    | 'invalid_public_disclosure'
    | 'handler_source_missing'
    | 'handler_symbol_missing'
    | 'closure_handler_category_mismatch'
    | 'closure_retention_missing'
    | 'closure_test_missing'
    | 'closure_receipt_raw_content'
    | 'closure_public_claim_exceeds_capability'
    | 'suspicious_secret'
    | 'suspicious_personal_data'
    | 'governance_gap';
  registryId: string;
  message: string;
}

export interface AuditReport {
  ok: boolean;
  summary: {
    categories: number;
    processors: number;
    retentionPolicies: number;
    rightsCapabilities: number;
    unknownOrPendingProcessors: number;
    manualCapabilities: number;
    notImplementedCapabilities: number;
    unknownRetentionPolicies: number;
    errors: number;
    gaps: number;
  };
  issues: AuditIssue[];
}
