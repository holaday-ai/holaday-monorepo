import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type {
  AuditIssue,
  AuditReport,
  CapabilityDefinition,
  GovernanceRegistryBundle,
  SourceEvidence,
} from './types.js';

export interface AuditOptions {
  repoRoot?: string;
  verifyEvidenceFiles?: boolean;
  requirePublicDisclosures?: boolean;
}

const SNAKE_CASE_ID = /^[a-z][a-z0-9_]*$/;
const CONFIG_KEY_NAME = /^[A-Z][A-Z0-9_]+$/;
const HANDLER_REF = /^[^#\s]+#[A-Za-z_$][A-Za-z0-9_$]*$/;
const CAPABILITY_NAMES = ['export', 'delete', 'correct', 'pause', 'withdraw'] as const;

const SECRET_VALUE =
  /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----|(?:^|\s)(?:sk-|ghp_|xoxb-|xoxp-)[A-Za-z0-9_-]+|Bearer\s+\S+|(?:document\.)?cookie\s*=|set-cookie\s*:/i;
const PERSONAL_VALUE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d(?:[\s-]?\d){7,}/i;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExportedSymbol(source: string, symbol: string): boolean {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbol)) return false;
  const name = symbol;
  const declaration = new RegExp(
    `\\bexport\\s+(?:(?:declare\\s+)?(?:async\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${name}\\b)`,
  );
  const namedExport = new RegExp(`\\bexport\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`, 's');
  return declaration.test(source) || namedExport.test(source);
}

/** Audits registry metadata only; it never reads runtime, database, or user data. */
export function auditGovernanceRegistry(
  bundle: GovernanceRegistryBundle,
  options: AuditOptions = {},
): AuditReport {
  const issues: AuditIssue[] = [];
  const gapKeys = new Set<string>();
  const addIssue = (
    severity: AuditIssue['severity'],
    code: AuditIssue['code'],
    registryId: string,
    message: string,
  ) => issues.push({ severity, code, registryId, message });
  const addGap = (registryId: string, status: string) => {
    const key = `${registryId}:${status}`;
    if (!gapKeys.has(key)) {
      gapKeys.add(key);
      addIssue(
        'gap',
        'governance_gap',
        registryId,
        `Governance state requires follow-up: ${status}.`,
      );
    }
  };

  const auditIds = (kind: string, entries: Array<{ id: string }>) => {
    const seen = new Set<string>();
    for (const entry of entries) {
      const registryId = `${kind}:${entry.id}`;
      if (!SNAKE_CASE_ID.test(entry.id)) {
        addIssue('error', 'invalid_id', registryId, `${kind} id must be lowercase snake case.`);
      }
      if (seen.has(entry.id)) {
        addIssue('error', 'duplicate_id', registryId, `${kind} id is duplicated.`);
      }
      seen.add(entry.id);
    }
  };

  auditIds('category', bundle.categories);
  auditIds('processor', bundle.processors);
  auditIds('retention_policy', bundle.retentionPolicies);
  auditIds('rights_capability', bundle.rightsCapabilities);

  const categories = new Map(bundle.categories.map((category) => [category.id, category]));
  const processors = new Map(bundle.processors.map((processor) => [processor.id, processor]));
  const retentionPolicies = new Set(bundle.retentionPolicies.map((policy) => policy.id));
  const rightsCapabilities = new Set(bundle.rightsCapabilities.map((capability) => capability.id));

  for (const category of bundle.categories) {
    const registryId = `category:${category.id}`;
    if (!retentionPolicies.has(category.retentionPolicyId)) {
      addIssue(
        'error',
        'dangling_reference',
        registryId,
        'Retention policy reference does not exist.',
      );
    }
    if (!rightsCapabilities.has(category.rightsCapabilityId)) {
      addIssue(
        'error',
        'dangling_reference',
        registryId,
        'Rights capability reference does not exist.',
      );
    }
    for (const processorId of category.processorIds) {
      const processor = processors.get(processorId);
      if (!processor) {
        addIssue(
          'error',
          'dangling_reference',
          registryId,
          `Processor reference ${processorId} does not exist.`,
        );
      } else if (!processor.categoryIds.includes(category.id)) {
        addIssue(
          'error',
          'processor_category_mismatch',
          registryId,
          `Processor ${processorId} does not reference this category.`,
        );
      }
    }
  }

  for (const processor of bundle.processors) {
    const registryId = `processor:${processor.id}`;
    for (const categoryId of processor.categoryIds) {
      const category = categories.get(categoryId);
      if (!category) {
        addIssue(
          'error',
          'dangling_reference',
          registryId,
          `Category reference ${categoryId} does not exist.`,
        );
      } else if (!category.processorIds.includes(processor.id)) {
        addIssue(
          'error',
          'processor_category_mismatch',
          registryId,
          `Category ${categoryId} does not reference this processor.`,
        );
      }
    }
    for (const status of [processor.regionStatus, processor.legalReviewStatus]) {
      if (status === 'unknown' || status === 'pending_legal_review') addGap(registryId, status);
    }
  }

  let manualCapabilities = 0;
  let notImplementedCapabilities = 0;
  const auditCapability = (registryId: string, capability: CapabilityDefinition) => {
    const { status } = capability;
    if (status === 'implemented') {
      if (!nonEmpty(capability.handlerRef) || !HANDLER_REF.test(capability.handlerRef)) {
        addIssue(
          'error',
          'implemented_handler_missing',
          registryId,
          'Implemented capability requires a repository-relative path#exportedSymbol handlerRef.',
        );
      }
    } else if (nonEmpty(capability.handlerRef)) {
      addIssue(
        'error',
        'not_implemented_handler_present',
        registryId,
        'Only implemented capabilities may declare a handlerRef.',
      );
    }
    if (status === 'manual') {
      manualCapabilities += 1;
      addGap(registryId, status);
      if (
        !nonEmpty(capability.manualEntrypoint) ||
        !nonEmpty(capability.scope) ||
        !Array.isArray(capability.limitations)
      ) {
        addIssue(
          'error',
          'manual_entrypoint_missing',
          registryId,
          'Manual capability requires a public entry point, scope, and limitations array.',
        );
      }
    } else if (status === 'not_implemented') {
      notImplementedCapabilities += 1;
      addGap(registryId, status);
    }
  };

  for (const rightsCapability of bundle.rightsCapabilities) {
    for (const name of CAPABILITY_NAMES) {
      auditCapability(`rights_capability:${rightsCapability.id}.${name}`, rightsCapability[name]);
    }
  }

  let unknownRetentionPolicies = 0;
  for (const policy of bundle.retentionPolicies) {
    const registryId = `retention_policy:${policy.id}`;
    if (policy.rule.kind === 'fixed_days') {
      if (!Number.isInteger(policy.rule.days) || policy.rule.days <= 0) {
        addIssue(
          'error',
          'invalid_fixed_days',
          registryId,
          'Fixed-day retention requires a positive integer number of days.',
        );
      }
      if (policy.automationStatus !== 'implemented') {
        addIssue(
          'error',
          'fixed_days_automation_missing',
          registryId,
          'Fixed-day retention requires implemented automation evidence.',
        );
      }
    }
    if (policy.rule.kind === 'unknown') {
      unknownRetentionPolicies += 1;
      addGap(registryId, 'unknown');
      if (!nonEmpty(policy.rule.reason)) {
        addIssue(
          'error',
          'unknown_reason_missing',
          registryId,
          'Unknown retention requires a non-empty reason.',
        );
      }
    }
    for (const status of [policy.automationStatus, policy.retryStatus]) {
      if (status === 'manual' || status === 'not_implemented') addGap(registryId, status);
    }
  }

  const evidenceGroups: Array<{ registryId: string; evidence: SourceEvidence[] }> = [];
  for (const category of bundle.categories)
    evidenceGroups.push({ registryId: `category:${category.id}`, evidence: category.evidence });
  for (const processor of bundle.processors)
    evidenceGroups.push({
      registryId: `processor:${processor.id}`,
      evidence: processor.activation.evidence,
    });
  for (const policy of bundle.retentionPolicies)
    evidenceGroups.push({ registryId: `retention_policy:${policy.id}`, evidence: policy.evidence });
  for (const rightsCapability of bundle.rightsCapabilities) {
    for (const name of CAPABILITY_NAMES) {
      evidenceGroups.push({
        registryId: `rights_capability:${rightsCapability.id}.${name}`,
        evidence: rightsCapability[name].evidence,
      });
    }
  }
  auditEvidence(evidenceGroups, options, addIssue);

  if (options.requirePublicDisclosures) {
    const disclosureCounts = new Map<string, number>();
    for (const disclosure of bundle.publicDisclosures) {
      const registryId = `public_disclosure:${disclosure.categoryId}`;
      if (!categories.has(disclosure.categoryId)) {
        addIssue(
          'error',
          'public_disclosure_unknown_category',
          registryId,
          'Public disclosure references an unknown category.',
        );
      }
      disclosureCounts.set(
        disclosure.categoryId,
        (disclosureCounts.get(disclosure.categoryId) ?? 0) + 1,
      );
    }
    for (const [categoryId, count] of disclosureCounts) {
      if (count > 1) {
        addIssue(
          'error',
          'public_disclosure_duplicate',
          `public_disclosure:${categoryId}`,
          'Category has more than one public disclosure mapping.',
        );
      }
    }
    for (const category of bundle.categories) {
      const count = disclosureCounts.get(category.id) ?? 0;
      if (count === 0)
        addIssue(
          'error',
          'public_disclosure_missing',
          `category:${category.id}`,
          'Category has no public disclosure mapping.',
        );
    }
  }

  auditSuspiciousValues(bundle, addIssue);

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const gaps = issues.length - errors;
  return {
    ok: errors === 0,
    summary: {
      categories: bundle.categories.length,
      processors: bundle.processors.length,
      retentionPolicies: bundle.retentionPolicies.length,
      rightsCapabilities: bundle.rightsCapabilities.length,
      unknownOrPendingProcessors: bundle.processors.filter(
        (processor) =>
          processor.regionStatus === 'unknown' ||
          processor.regionStatus === 'pending_legal_review' ||
          processor.legalReviewStatus === 'unknown' ||
          processor.legalReviewStatus === 'pending_legal_review',
      ).length,
      manualCapabilities,
      notImplementedCapabilities,
      unknownRetentionPolicies,
      errors,
      gaps,
    },
    issues,
  };
}

function auditEvidence(
  groups: Array<{ registryId: string; evidence: SourceEvidence[] }>,
  options: AuditOptions,
  addIssue: (
    severity: AuditIssue['severity'],
    code: AuditIssue['code'],
    registryId: string,
    message: string,
  ) => void,
): void {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  for (const group of groups) {
    if (!Array.isArray(group.evidence) || group.evidence.length === 0) {
      addIssue(
        'error',
        'missing_evidence',
        group.registryId,
        'Registry entry requires at least one evidence record.',
      );
      continue;
    }
    if (!options.verifyEvidenceFiles) continue;
    for (const evidence of group.evidence) {
      const resolvedPath = resolve(repoRoot, evidence.path);
      const outsideRoot = relative(repoRoot, resolvedPath);
      if (
        outsideRoot === '..' ||
        outsideRoot.startsWith(`..${String.fromCharCode(47)}`) ||
        isAbsolute(outsideRoot)
      ) {
        addIssue(
          'error',
          'source_evidence_missing',
          group.registryId,
          'Evidence path escapes repoRoot.',
        );
        continue;
      }
      if (!existsSync(resolvedPath)) {
        addIssue(
          'error',
          'source_evidence_missing',
          group.registryId,
          `Evidence source does not exist: ${evidence.path}.`,
        );
        continue;
      }
      if (evidence.kind === 'exported_symbol') {
        if (!nonEmpty(evidence.symbol)) {
          addIssue(
            'error',
            'evidence_symbol_missing',
            group.registryId,
            'Exported-symbol evidence requires a symbol name.',
          );
          continue;
        }
        const source = readFileSync(resolvedPath, 'utf8');
        if (!hasExportedSymbol(source, evidence.symbol)) {
          addIssue(
            'error',
            'evidence_symbol_missing',
            group.registryId,
            `Exported symbol ${evidence.symbol} was not found.`,
          );
        }
      }
    }
  }
}

function auditSuspiciousValues(
  bundle: GovernanceRegistryBundle,
  addIssue: (
    severity: AuditIssue['severity'],
    code: AuditIssue['code'],
    registryId: string,
    message: string,
  ) => void,
): void {
  const seen = new WeakSet<object>();
  const inspect = (
    value: unknown,
    registryId: string,
    path: string,
    approvedPublicContact = false,
  ): void => {
    if (typeof value === 'string') {
      if (CONFIG_KEY_NAME.test(value) || approvedPublicContact) return;
      if (SECRET_VALUE.test(value)) {
        addIssue(
          'error',
          'suspicious_secret',
          registryId,
          `Suspicious secret-like value at ${path}.`,
        );
      } else if (PERSONAL_VALUE.test(value)) {
        addIssue(
          'error',
          'suspicious_personal_data',
          registryId,
          `Suspicious personal-data value at ${path}.`,
        );
      }
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => inspect(item, registryId, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      inspect(child, registryId, path ? `${path}.${key}` : key, key === 'manualEntrypoint');
    }
  };
  for (const category of bundle.categories) inspect(category, `category:${category.id}`, '');
  for (const processor of bundle.processors) inspect(processor, `processor:${processor.id}`, '');
  for (const policy of bundle.retentionPolicies)
    inspect(policy, `retention_policy:${policy.id}`, '');
  for (const capability of bundle.rightsCapabilities)
    inspect(capability, `rights_capability:${capability.id}`, '');
  for (const disclosure of bundle.publicDisclosures)
    inspect(disclosure, `public_disclosure:${disclosure.categoryId}`, '');
}
