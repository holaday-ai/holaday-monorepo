export type DataCategoryId =
  | 'account_security'
  | 'task_execution'
  | 'cross_task_memory'
  | 'energy_astrology_profile'
  | 'stock_preference_profile'
  | 'feedback_support'
  | 'external_notifications'
  | 'extension_site_stats'
  | 'extension_login_cookies'
  | 'payments_entitlements'
  | 'partner_kyc_ledger'
  | 'media_assets'
  | 'analytics_logs';

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
  kind: 'source_file' | 'exported_symbol' | 'operational_entrypoint';
  path: string;
  symbol?: string;
  fact: string;
}

export interface DataCategoryDefinition {
  id: DataCategoryId;
  displayName: string;
  description: string;
  dataElements: string[];
  sources: string[];
  purposes: string[];
  sensitivity: 'standard' | 'sensitive' | 'highly_sensitive';
  storageLocations: string[];
  processorIds: ProcessorId[];
  retentionPolicyId: RetentionPolicyId;
  rightsCapabilityId: RightsCapabilityId;
  evidence: SourceEvidence[];
}

export interface ProcessorDefinition {
  id: ProcessorId;
  displayName: string;
  purposes: string[];
  categoryIds: DataCategoryId[];
  activation: {
    mode: 'always_internal' | 'feature_conditional' | 'user_configured';
    configKeys?: string[];
    evidence: SourceEvidence[];
  };
  regionStatus: VerificationStatus;
  legalReviewStatus: VerificationStatus;
}

export interface RetentionPolicyDefinition {
  id: RetentionPolicyId;
  trigger: string;
  rule:
    | { kind: 'fixed_days'; days: number }
    | { kind: 'until_user_action'; action: string }
    | { kind: 'purpose_bound'; description: string }
    | { kind: 'mixed'; description: string }
    | { kind: 'unknown'; reason: string };
  automationStatus: GovernanceCapabilityStatus;
  retryStatus: GovernanceCapabilityStatus;
  evidence: SourceEvidence[];
}

export interface CapabilityDefinition {
  status: GovernanceCapabilityStatus;
  handlerRef?: string;
  manualEntrypoint?: string;
  scope: string;
  limitations: string[];
  evidence: SourceEvidence[];
}

export interface RightsCapability {
  id: RightsCapabilityId;
  export: CapabilityDefinition;
  delete: CapabilityDefinition;
  correct: CapabilityDefinition;
  pause: CapabilityDefinition;
  withdraw: CapabilityDefinition;
}

export interface PublicDisclosureDefinition {
  categoryId: DataCategoryId;
  spaLabel: string;
  landingLabel: string;
  requiredBoundaries: string[];
  publiclyDisclosed: boolean;
}

export interface GovernanceRegistryBundle {
  categories: DataCategoryDefinition[];
  processors: ProcessorDefinition[];
  retentionPolicies: RetentionPolicyDefinition[];
  rightsCapabilities: RightsCapability[];
  publicDisclosures: PublicDisclosureDefinition[];
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
