import {
  accessSync,
  constants as fsConstants,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
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
const CAPABILITY_STATUSES = ['implemented', 'manual', 'not_implemented', 'not_applicable'] as const;
const VERIFICATION_STATUSES = [
  'verified_in_code',
  'verified_operationally',
  'unknown',
  'pending_legal_review',
] as const;
const EVIDENCE_KINDS = ['source_file', 'exported_symbol', 'operational_entrypoint'] as const;
const SENSITIVITIES = ['standard', 'sensitive', 'highly_sensitive'] as const;
const ACTIVATION_MODES = ['always_internal', 'feature_conditional', 'user_configured'] as const;
const RETENTION_RULE_KINDS = [
  'fixed_days',
  'until_user_action',
  'purpose_bound',
  'mixed',
  'unknown',
] as const;
const LOCAL_RETENTION_REGIME_IDS = ['task_30d', 'audit_180d', 'manual_hold'] as const;

const SECRET_VALUE =
  /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----|(?:^|[^A-Za-z0-9])(?:sk-|ghp_|xoxb-|xoxp-)[A-Za-z0-9_-]+|Bearer\s+\S+|(?:document\.)?cookie\s*(?:=|:)|set-cookie\s*:|\b(?:password|passwd|api[_-]?key|client[_-]?secret|access[_-]?token|credential)\s*(?:=|:)\s*(?:["'][^"']*|[^\s;,]+)/i;
const PERSONAL_VALUE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d(?:[\s-]?\d){7,}/i;

type AddIssue = (
  severity: AuditIssue['severity'],
  code: AuditIssue['code'],
  registryId: string,
  message: string,
) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordArray<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value.filter(isRecord) as T[]) : [];
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function evidenceArray(value: unknown): readonly SourceEvidence[] {
  return recordArray<SourceEvidence>(value);
}

function oneOf(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === 'string' && allowed.includes(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasModifier(node: ts.Node, kind: ts.ModifierSyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
  );
}

function collectBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, names);
  }
}

function collectVariableRuntimeBindings(
  statement: ts.VariableStatement,
  names: Set<string>,
): boolean {
  const flags = statement.declarationList.flags;
  if ((flags & ts.NodeFlags.Using) !== 0) return false;

  const isConst = (flags & ts.NodeFlags.Const) !== 0;
  for (const declaration of statement.declarationList.declarations) {
    if ((isConst || !ts.isIdentifier(declaration.name)) && !declaration.initializer) return false;
    collectBindingNames(declaration.name, names);
  }
  return true;
}

interface RuntimeBodyAnalysis {
  readonly structurallyValid: boolean;
  readonly emitsCode: boolean;
}

function analyzeModuleDeclaration(statement: ts.ModuleDeclaration): RuntimeBodyAnalysis {
  if (
    hasModifier(statement, ts.SyntaxKind.DeclareKeyword) ||
    !ts.isIdentifier(statement.name) ||
    !statement.body ||
    (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0
  ) {
    return { structurallyValid: true, emitsCode: false };
  }
  return analyzeModuleBody(statement.body);
}

function analyzeModuleBody(body: ts.ModuleBody): RuntimeBodyAnalysis {
  if (ts.isModuleDeclaration(body)) return analyzeModuleDeclaration(body);
  if (!ts.isModuleBlock(body)) return { structurallyValid: true, emitsCode: false };

  let emitsCode = false;
  for (const statement of body.statements) {
    if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      if (!collectVariableRuntimeBindings(statement, new Set<string>())) {
        return { structurallyValid: false, emitsCode: false };
      }
      emitsCode = true;
      continue;
    }
    if (ts.isFunctionDeclaration(statement)) {
      emitsCode ||= Boolean(statement.body);
      continue;
    }
    if (ts.isClassDeclaration(statement)) {
      emitsCode = true;
      continue;
    }
    if (ts.isEnumDeclaration(statement)) {
      emitsCode ||= !hasModifier(statement, ts.SyntaxKind.ConstKeyword);
      continue;
    }
    if (ts.isModuleDeclaration(statement)) {
      const nested = analyzeModuleDeclaration(statement);
      if (!nested.structurallyValid) return nested;
      emitsCode ||= nested.emitsCode;
      continue;
    }
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isImportDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement) ||
      ts.isNamespaceExportDeclaration(statement) ||
      ts.isEmptyStatement(statement) ||
      ts.isNotEmittedStatement(statement)
    ) {
      continue;
    }
    emitsCode = true;
  }
  return { structurallyValid: true, emitsCode };
}

function runtimeDeclarationName(statement: ts.Statement): string | undefined {
  if (ts.isFunctionDeclaration(statement)) {
    return statement.body ? statement.name?.text : undefined;
  }
  if (ts.isClassDeclaration(statement)) return statement.name?.text;
  if (ts.isEnumDeclaration(statement)) {
    return hasModifier(statement, ts.SyntaxKind.ConstKeyword) ? undefined : statement.name.text;
  }
  if (ts.isModuleDeclaration(statement) && analyzeModuleDeclaration(statement).emitsCode) {
    return statement.name.text;
  }
  return undefined;
}

function scriptKindForPath(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function hasExportedSymbol(source: string, symbol: string, filePath: string): boolean {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbol)) return false;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(filePath),
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if ((parseDiagnostics && parseDiagnostics.length > 0) || sourceFile.isDeclarationFile)
    return false;

  const runtimeBindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      if (!collectVariableRuntimeBindings(statement, runtimeBindings)) return false;
      continue;
    }
    if (ts.isModuleDeclaration(statement)) {
      const moduleAnalysis = analyzeModuleDeclaration(statement);
      if (!moduleAnalysis.structurallyValid) return false;
      if (moduleAnalysis.emitsCode && ts.isIdentifier(statement.name)) {
        runtimeBindings.add(statement.name.text);
      }
      continue;
    }
    const runtimeName = runtimeDeclarationName(statement);
    if (runtimeName) runtimeBindings.add(runtimeName);
  }

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || statement.moduleSpecifier || !statement.exportClause) continue;
      if (
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some(
          (element) =>
            !element.isTypeOnly &&
            element.name.text === symbol &&
            runtimeBindings.has((element.propertyName ?? element.name).text),
        )
      ) {
        return true;
      }
      continue;
    }

    if (
      !hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ||
      hasModifier(statement, ts.SyntaxKind.DeclareKeyword)
    ) {
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const exportedBindings = new Set<string>();
      if (!collectVariableRuntimeBindings(statement, exportedBindings)) return false;
      if (exportedBindings.has(symbol)) return true;
      continue;
    }
    if (runtimeDeclarationName(statement) === symbol) return true;
  }
  return false;
}

function isWithinRoot(root: string, target: string): boolean {
  const targetRelative = relative(root, target);
  return (
    targetRelative !== '..' && !targetRelative.startsWith(`..${sep}`) && !isAbsolute(targetRelative)
  );
}

function isRepositoryRelativeHandlerRef(handlerRef: string, repoRoot: string): boolean {
  if (!HANDLER_REF.test(handlerRef)) return false;
  const [path] = handlerRef.split('#', 1);
  return nonEmpty(path) && !isAbsolute(path) && isWithinRoot(repoRoot, resolve(repoRoot, path));
}

/** Audits registry metadata only; it never reads runtime, database, or user data. */
export function auditGovernanceRegistry(
  bundle: GovernanceRegistryBundle,
  options: AuditOptions = {},
): AuditReport {
  const issues: AuditIssue[] = [];
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const gapKeys = new Set<string>();
  const addIssue: AddIssue = (severity, code, registryId, message) =>
    issues.push({ severity, code, registryId, message });
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

  const rawBundle: Record<string, unknown> = isRecord(bundle) ? bundle : {};
  const categories = recordArray<GovernanceRegistryBundle['categories'][number]>(
    rawBundle.categories,
  );
  const processorEntries = recordArray<GovernanceRegistryBundle['processors'][number]>(
    rawBundle.processors,
  );
  const policyEntries = recordArray<GovernanceRegistryBundle['retentionPolicies'][number]>(
    rawBundle.retentionPolicies,
  );
  const rightsEntries = recordArray<GovernanceRegistryBundle['rightsCapabilities'][number]>(
    rawBundle.rightsCapabilities,
  );
  const disclosureEntries = recordArray<GovernanceRegistryBundle['publicDisclosures'][number]>(
    rawBundle.publicDisclosures,
  );

  validateGovernanceRegistryStructure(rawBundle, addIssue);

  const auditIds = (kind: string, entries: readonly { readonly id: string }[]) => {
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

  auditIds('category', categories);
  auditIds('processor', processorEntries);
  auditIds('retention_policy', policyEntries);
  auditIds('rights_capability', rightsEntries);

  const categoryMap = new Map<string, (typeof categories)[number]>(
    categories.map((category) => [category.id, category]),
  );
  const processors = new Map<string, (typeof processorEntries)[number]>(
    processorEntries.map((processor) => [processor.id, processor]),
  );
  const retentionPolicies = new Set<string>(policyEntries.map((policy) => policy.id));
  const rightsCapabilities = new Set<string>(rightsEntries.map((capability) => capability.id));

  for (const category of categories) {
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
    for (const processorId of stringArray(category.processorIds)) {
      const processor = processors.get(processorId);
      if (!processor) {
        addIssue(
          'error',
          'dangling_reference',
          registryId,
          `Processor reference ${processorId} does not exist.`,
        );
      } else if (!stringArray(processor.categoryIds).includes(category.id)) {
        addIssue(
          'error',
          'processor_category_mismatch',
          registryId,
          `Processor ${processorId} does not reference this category.`,
        );
      }
    }
  }

  for (const processor of processorEntries) {
    const registryId = `processor:${processor.id}`;
    for (const categoryId of stringArray(processor.categoryIds)) {
      const category = categoryMap.get(categoryId);
      if (!category) {
        addIssue(
          'error',
          'dangling_reference',
          registryId,
          `Category reference ${categoryId} does not exist.`,
        );
      } else if (!stringArray(category.processorIds).includes(processor.id)) {
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
      if (
        !nonEmpty(capability.handlerRef) ||
        !isRepositoryRelativeHandlerRef(capability.handlerRef, repoRoot)
      ) {
        addIssue(
          'error',
          'implemented_handler_missing',
          registryId,
          'Implemented capability requires a repository-relative path#exportedSymbol handlerRef.',
        );
      } else if (options.verifyEvidenceFiles) {
        auditHandlerRef(capability.handlerRef, registryId, repoRoot, addIssue);
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

  for (const rightsCapability of rightsEntries) {
    for (const name of CAPABILITY_NAMES) {
      const capability = rightsCapability[name];
      if (isRecord(capability)) {
        auditCapability(
          `rights_capability:${rightsCapability.id}.${name}`,
          capability as unknown as CapabilityDefinition,
        );
      }
    }
  }

  let unknownRetentionPolicies = 0;
  for (const policy of policyEntries) {
    const registryId = `retention_policy:${policy.id}`;
    const rule: Record<string, unknown> = isRecord(policy.rule) ? policy.rule : {};
    if (rule.kind === 'fixed_days') {
      if (!Number.isInteger(rule.days) || (rule.days as number) <= 0) {
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
    if (rule.kind === 'unknown') {
      unknownRetentionPolicies += 1;
      addGap(registryId, 'unknown');
      if (!nonEmpty(rule.reason)) {
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
    for (const regime of recordArray<NonNullable<typeof policy.localRegimes>[number]>(
      policy.localRegimes,
    )) {
      if (regime.automationStatus === 'manual' || regime.automationStatus === 'not_implemented') {
        addGap(`${registryId}.local_regime:${regime.id}`, regime.automationStatus);
      }
    }
  }

  const evidenceGroups: Array<{ registryId: string; evidence: readonly SourceEvidence[] }> = [];
  for (const category of categories)
    evidenceGroups.push({
      registryId: `category:${category.id}`,
      evidence: evidenceArray(category.evidence),
    });
  for (const processor of processorEntries)
    evidenceGroups.push({
      registryId: `processor:${processor.id}`,
      evidence: evidenceArray(isRecord(processor.activation) ? processor.activation.evidence : []),
    });
  for (const policy of policyEntries) {
    evidenceGroups.push({
      registryId: `retention_policy:${policy.id}`,
      evidence: evidenceArray(policy.evidence),
    });
    for (const regime of recordArray<NonNullable<typeof policy.localRegimes>[number]>(
      policy.localRegimes,
    )) {
      evidenceGroups.push({
        registryId: `retention_policy:${policy.id}.local_regime:${regime.id}`,
        evidence: evidenceArray(regime.evidence),
      });
    }
  }
  for (const rightsCapability of rightsEntries) {
    for (const name of CAPABILITY_NAMES) {
      const capability = rightsCapability[name];
      evidenceGroups.push({
        registryId: `rights_capability:${rightsCapability.id}.${name}`,
        evidence: evidenceArray(isRecord(capability) ? capability.evidence : []),
      });
    }
  }
  auditEvidence(evidenceGroups, options, addIssue);

  if (options.requirePublicDisclosures) {
    const disclosureCounts = new Map<string, number>();
    for (const disclosure of disclosureEntries) {
      const registryId = `public_disclosure:${disclosure.categoryId}`;
      if (!categoryMap.has(disclosure.categoryId)) {
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
    for (const category of categories) {
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

  auditSuspiciousValues(
    {
      categories,
      processors: processorEntries,
      retentionPolicies: policyEntries,
      rightsCapabilities: rightsEntries,
      publicDisclosures: disclosureEntries,
    },
    addIssue,
  );

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const gaps = issues.length - errors;
  return {
    ok: errors === 0,
    summary: {
      categories: categories.length,
      processors: processorEntries.length,
      retentionPolicies: policyEntries.length,
      rightsCapabilities: rightsEntries.length,
      unknownOrPendingProcessors: processorEntries.filter(
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

function validateGovernanceRegistryStructure(
  bundle: Record<string, unknown>,
  addIssue: AddIssue,
): void {
  const seenLocalRegimeIds = new Set<string>();
  const requireTopLevelEntries = (key: string): readonly Record<string, unknown>[] => {
    const value = bundle[key];
    if (!Array.isArray(value) || value.length === 0) {
      addIssue(
        'error',
        'required_array_empty',
        `registry:${key}`,
        `${key} must be a non-empty array.`,
      );
      return [];
    }
    const entries = value.filter(isRecord);
    if (entries.length !== value.length) {
      addIssue(
        'error',
        'required_array_empty',
        `registry:${key}`,
        `${key} must contain registry objects only.`,
      );
    }
    return entries;
  };
  const requireString = (entry: Record<string, unknown>, key: string, registryId: string): void => {
    if (!nonEmpty(entry[key])) {
      addIssue(
        'error',
        'required_string_missing',
        registryId,
        `${key} must be a non-empty string.`,
      );
    }
  };
  const requireStringList = (
    entry: Record<string, unknown>,
    key: string,
    registryId: string,
    allowEmpty = false,
  ): void => {
    const value = entry[key];
    if (
      !Array.isArray(value) ||
      (!allowEmpty && value.length === 0) ||
      value.some((item) => !nonEmpty(item))
    ) {
      addIssue(
        'error',
        'required_array_empty',
        registryId,
        `${key} must be ${allowEmpty ? 'an explicit' : 'a non-empty'} array of non-empty strings.`,
      );
    }
  };
  const requireEnum = (
    entry: Record<string, unknown>,
    key: string,
    allowed: readonly string[],
    registryId: string,
  ): void => {
    if (!oneOf(entry[key], allowed)) {
      addIssue(
        'error',
        'invalid_enum_value',
        registryId,
        `${key} must use an approved enum value.`,
      );
    }
  };
  const validateEvidence = (value: unknown, registryId: string): void => {
    if (!Array.isArray(value) || value.length === 0) return;
    for (const item of value) {
      if (!isRecord(item)) {
        addIssue('error', 'invalid_evidence', registryId, 'Evidence must be an object.');
        continue;
      }
      if (!oneOf(item.kind, EVIDENCE_KINDS)) {
        addIssue(
          'error',
          'invalid_evidence',
          registryId,
          'Evidence kind must use an approved enum value.',
        );
      }
      if (!nonEmpty(item.path) || !nonEmpty(item.fact)) {
        addIssue(
          'error',
          'invalid_evidence',
          registryId,
          'Evidence path and fact must be non-empty strings.',
        );
      }
      if (item.kind === 'exported_symbol' && !nonEmpty(item.symbol)) {
        addIssue(
          'error',
          'invalid_evidence',
          registryId,
          'Exported-symbol evidence requires a non-empty symbol.',
        );
      }
    }
  };
  const validateCapability = (value: unknown, registryId: string): void => {
    if (!isRecord(value)) {
      addIssue(
        'error',
        'invalid_enum_value',
        registryId,
        'Capability definition must be an object with an approved status.',
      );
      return;
    }
    requireEnum(value, 'status', CAPABILITY_STATUSES, registryId);
    requireString(value, 'scope', registryId);
    requireStringList(value, 'limitations', registryId, true);
    validateEvidence(value.evidence, registryId);
  };

  for (const category of requireTopLevelEntries('categories')) {
    const registryId = `category:${nonEmpty(category.id) ? category.id : 'unknown'}`;
    for (const key of [
      'id',
      'displayName',
      'description',
      'retentionPolicyId',
      'rightsCapabilityId',
    ]) {
      requireString(category, key, registryId);
    }
    for (const key of ['dataElements', 'sources', 'purposes', 'storageLocations', 'processorIds']) {
      requireStringList(category, key, registryId);
    }
    requireEnum(category, 'sensitivity', SENSITIVITIES, registryId);
    validateEvidence(category.evidence, registryId);
  }

  for (const processor of requireTopLevelEntries('processors')) {
    const registryId = `processor:${nonEmpty(processor.id) ? processor.id : 'unknown'}`;
    requireString(processor, 'id', registryId);
    requireString(processor, 'displayName', registryId);
    requireStringList(processor, 'purposes', registryId);
    requireStringList(processor, 'categoryIds', registryId);
    requireEnum(processor, 'regionStatus', VERIFICATION_STATUSES, registryId);
    requireEnum(processor, 'legalReviewStatus', VERIFICATION_STATUSES, registryId);
    if (!isRecord(processor.activation)) {
      addIssue(
        'error',
        'invalid_enum_value',
        registryId,
        'activation must be an object with an approved mode.',
      );
      continue;
    }
    requireEnum(processor.activation, 'mode', ACTIVATION_MODES, registryId);
    if (processor.activation.configKeys !== undefined) {
      requireStringList(processor.activation, 'configKeys', registryId);
      for (const key of stringArray(processor.activation.configKeys)) {
        if (!CONFIG_KEY_NAME.test(key)) {
          addIssue(
            'error',
            'invalid_enum_value',
            registryId,
            'Processor configKeys must contain uppercase configuration key names only.',
          );
        }
      }
    }
    validateEvidence(processor.activation.evidence, registryId);
  }

  for (const policy of requireTopLevelEntries('retentionPolicies')) {
    const registryId = `retention_policy:${nonEmpty(policy.id) ? policy.id : 'unknown'}`;
    requireString(policy, 'id', registryId);
    requireString(policy, 'trigger', registryId);
    requireEnum(policy, 'automationStatus', CAPABILITY_STATUSES, registryId);
    requireEnum(policy, 'retryStatus', CAPABILITY_STATUSES, registryId);
    if (!isRecord(policy.rule)) {
      addIssue('error', 'invalid_enum_value', registryId, 'Retention rule must be an object.');
    } else {
      requireEnum(policy.rule, 'kind', RETENTION_RULE_KINDS, registryId);
      if (policy.rule.kind === 'until_user_action') {
        requireString(policy.rule, 'action', registryId);
      } else if (policy.rule.kind === 'purpose_bound' || policy.rule.kind === 'mixed') {
        requireString(policy.rule, 'description', registryId);
      } else if (policy.rule.kind === 'unknown') {
        requireString(policy.rule, 'reason', registryId);
      }
    }
    validateEvidence(policy.evidence, registryId);
    if (policy.localRegimes !== undefined) {
      if (!Array.isArray(policy.localRegimes) || policy.localRegimes.length === 0) {
        addIssue(
          'error',
          'required_array_empty',
          registryId,
          'localRegimes must be a non-empty array when present.',
        );
        continue;
      }
      for (const [index, value] of policy.localRegimes.entries()) {
        if (!isRecord(value)) {
          addIssue(
            'error',
            'invalid_enum_value',
            `${registryId}.local_regime:index_${index}`,
            'Local retention regime must be an object.',
          );
          continue;
        }
        const regime = value;
        const regimeId = `${registryId}.local_regime:${nonEmpty(regime.id) ? regime.id : 'unknown'}`;
        requireEnum(regime, 'id', LOCAL_RETENTION_REGIME_IDS, regimeId);
        if (nonEmpty(regime.id)) {
          if (seenLocalRegimeIds.has(regime.id)) {
            addIssue('error', 'duplicate_id', regimeId, 'Local retention regime id is duplicated.');
          }
          seenLocalRegimeIds.add(regime.id);
        }
        requireString(regime, 'boundary', regimeId);
        requireEnum(regime, 'automationStatus', CAPABILITY_STATUSES, regimeId);
        if (!isRecord(regime.activation)) {
          addIssue('error', 'invalid_enum_value', regimeId, 'Local activation must be an object.');
        } else {
          if (regime.activation.mode !== 'feature_conditional') {
            addIssue(
              'error',
              'invalid_enum_value',
              regimeId,
              'Local retention activation must be feature_conditional.',
            );
          }
          if (regime.activation.enabledByDefault !== false) {
            addIssue(
              'error',
              'invalid_enum_value',
              regimeId,
              'Local retention activation must record the default-off boundary.',
            );
          }
          requireStringList(regime.activation, 'configKeys', regimeId);
          for (const key of stringArray(regime.activation.configKeys)) {
            if (!CONFIG_KEY_NAME.test(key)) {
              addIssue(
                'error',
                'invalid_enum_value',
                regimeId,
                'Local retention configKeys must contain uppercase configuration key names only.',
              );
            }
          }
        }
        validateEvidence(regime.evidence, regimeId);
      }
    }
  }

  for (const rights of requireTopLevelEntries('rightsCapabilities')) {
    const registryId = `rights_capability:${nonEmpty(rights.id) ? rights.id : 'unknown'}`;
    requireString(rights, 'id', registryId);
    for (const name of CAPABILITY_NAMES) {
      validateCapability(rights[name], `${registryId}.${name}`);
    }
  }

  for (const disclosure of requireTopLevelEntries('publicDisclosures')) {
    const registryId = `public_disclosure:${nonEmpty(disclosure.categoryId) ? disclosure.categoryId : 'unknown'}`;
    const invalidStrings = ['categoryId', 'spaLabel', 'landingLabel'].some(
      (key) => !nonEmpty(disclosure[key]),
    );
    const invalidBoundaries =
      !Array.isArray(disclosure.requiredBoundaries) ||
      disclosure.requiredBoundaries.length === 0 ||
      disclosure.requiredBoundaries.some((item) => !nonEmpty(item));
    if (invalidStrings || invalidBoundaries || disclosure.publiclyDisclosed !== true) {
      addIssue(
        'error',
        'invalid_public_disclosure',
        registryId,
        'Current public categories require labels, boundaries, and publiclyDisclosed true.',
      );
    }
  }
}

function auditHandlerRef(
  handlerRef: string,
  registryId: string,
  repoRoot: string,
  addIssue: AddIssue,
): void {
  const separator = handlerRef.lastIndexOf('#');
  const relativePath = handlerRef.slice(0, separator);
  const symbol = handlerRef.slice(separator + 1);
  let canonicalRoot: string;
  let canonicalPath: string;
  try {
    canonicalRoot = realpathSync(repoRoot);
    canonicalPath = realpathSync(resolve(repoRoot, relativePath));
    if (!isWithinRoot(canonicalRoot, canonicalPath)) throw new Error('outside root');
    const stat = statSync(canonicalPath);
    if (!stat.isFile()) throw new Error('not a regular file');
    accessSync(canonicalPath, fsConstants.R_OK);
  } catch {
    addIssue(
      'error',
      'handler_source_missing',
      registryId,
      'Implemented capability handler must resolve to a readable repository file.',
    );
    return;
  }

  try {
    const source = readFileSync(canonicalPath, 'utf8');
    if (!hasExportedSymbol(source, symbol, canonicalPath)) {
      addIssue(
        'error',
        'handler_symbol_missing',
        registryId,
        `Implemented capability handler export ${symbol} was not found.`,
      );
    }
  } catch {
    addIssue(
      'error',
      'handler_source_missing',
      registryId,
      'Implemented capability handler source could not be read.',
    );
  }
}

function auditEvidence(
  groups: readonly { readonly registryId: string; readonly evidence: readonly SourceEvidence[] }[],
  options: AuditOptions,
  addIssue: AddIssue,
): void {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  let canonicalRepoRoot: string | undefined;
  if (options.verifyEvidenceFiles) {
    try {
      canonicalRepoRoot = realpathSync(repoRoot);
      if (!statSync(canonicalRepoRoot).isDirectory()) canonicalRepoRoot = undefined;
    } catch {
      canonicalRepoRoot = undefined;
    }
  }
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
    if (!canonicalRepoRoot) {
      addIssue(
        'error',
        'source_evidence_missing',
        group.registryId,
        'Evidence repoRoot does not exist or cannot be resolved.',
      );
      continue;
    }
    for (const evidence of group.evidence) {
      if (!isRecord(evidence) || !nonEmpty(evidence.path)) continue;
      const resolvedPath = resolve(repoRoot, evidence.path);
      if (!isWithinRoot(repoRoot, resolvedPath)) {
        addIssue(
          'error',
          'source_evidence_missing',
          group.registryId,
          'Evidence path escapes repoRoot.',
        );
        continue;
      }
      let canonicalPath: string;
      try {
        canonicalPath = realpathSync(resolvedPath);
        if (!isWithinRoot(canonicalRepoRoot, canonicalPath)) throw new Error('outside root');
        const stat = statSync(canonicalPath);
        if (!stat.isFile()) throw new Error('not a regular file');
        accessSync(canonicalPath, fsConstants.R_OK);
      } catch {
        addIssue(
          'error',
          'source_evidence_missing',
          group.registryId,
          'Evidence source must resolve to a readable regular repository file.',
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
        try {
          const source = readFileSync(canonicalPath, 'utf8');
          if (hasExportedSymbol(source, evidence.symbol, canonicalPath)) continue;
          addIssue(
            'error',
            'evidence_symbol_missing',
            group.registryId,
            'The exact exported evidence symbol was not found.',
          );
        } catch {
          addIssue(
            'error',
            'source_evidence_missing',
            group.registryId,
            'Evidence source could not be read.',
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
      if (CONFIG_KEY_NAME.test(value)) return;
      if (SECRET_VALUE.test(value)) {
        addIssue(
          'error',
          'suspicious_secret',
          registryId,
          `Suspicious secret-like value at ${path}.`,
        );
      } else if (!approvedPublicContact && PERSONAL_VALUE.test(value)) {
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
