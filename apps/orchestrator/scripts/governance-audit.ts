import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AccountClosureHandler } from '../src/account-closure/handler-contract.js';
import {
  ACCOUNT_CLOSURE_HANDLERS,
  ACCOUNT_CLOSURE_HANDLER_BINDINGS,
  type AccountClosureHandlerBinding,
} from '../src/account-closure/handler-registry.js';
import {
  ACCOUNT_CLOSURE_HANDLER_EXECUTION_EVIDENCE,
  ACCOUNT_CLOSURE_HANDLER_EXECUTION_TEST,
  type AccountClosureHandlerExecutionEvidence,
} from '../src/account-closure/handler-release-evidence.js';
import {
  ACCOUNT_CLOSURE_RETENTION_OUTCOMES,
  ACCOUNT_CLOSURE_PUBLIC_RECEIPT_FIELDS as PUBLIC_RECEIPT_FIELDS,
} from '../src/account-closure/types.js';
import {
  type AuditIssue,
  type AuditReport,
  DATA_CATEGORY_IDS,
  type DataCategoryId,
  type RightsCapability,
  auditGovernanceRegistry,
  governanceRegistry,
} from '../src/data-governance/index.js';

export const ACCOUNT_CLOSURE_PUBLIC_RECEIPT_FIELDS = PUBLIC_RECEIPT_FIELDS;

export interface AccountClosureGovernanceDeclaration {
  readonly categoryId: DataCategoryId;
  readonly handlerRef: string;
  readonly testRef: string;
}

export const ACCOUNT_CLOSURE_GOVERNANCE_DECLARATIONS: readonly AccountClosureGovernanceDeclaration[] =
  ACCOUNT_CLOSURE_HANDLER_EXECUTION_EVIDENCE.map((evidence) => ({
    categoryId: evidence.categoryId,
    handlerRef: evidence.handlerRef,
    testRef: evidence.behaviorTestRef,
  }));

export interface AccountClosureGovernanceAuditInput {
  readonly declarations: readonly AccountClosureGovernanceDeclaration[];
  readonly handlerBindings: readonly AccountClosureHandlerBinding[];
  readonly runtimeHandlers: readonly AccountClosureHandler[];
  readonly executionEvidence: readonly AccountClosureHandlerExecutionEvidence[];
  readonly receiptFields: readonly string[];
  readonly rightsCapabilities: readonly RightsCapability[];
  readonly repoRoot?: string;
}

/** Validates the destructive-flow release contract without reading runtime or user data. */
export function auditAccountClosureGovernance(
  input: AccountClosureGovernanceAuditInput,
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const add = (code: AuditIssue['code'], registryId: string, message: string) =>
    issues.push({ severity: 'error', code, registryId, message });
  const seen = new Set<string>();
  const bindings = new Map(input.handlerBindings.map((binding) => [binding.handlerRef, binding]));
  const runtimeHandlers = new Map(
    input.runtimeHandlers.map((handler) => [handler.categoryId, handler] as const),
  );
  const executionEvidence = new Map(
    input.executionEvidence.map((evidence) => [evidence.categoryId, evidence] as const),
  );
  const root = resolve(input.repoRoot ?? repositoryRoot());

  for (const declaration of input.declarations) {
    const registryId = `account_closure:${declaration.categoryId}`;
    if (seen.has(declaration.categoryId)) {
      add('duplicate_id', registryId, 'Account closure category declaration is duplicated.');
    }
    seen.add(declaration.categoryId);

    const binding = bindings.get(declaration.handlerRef);
    const runtimeHandler = runtimeHandlers.get(declaration.categoryId);
    if (
      !binding ||
      binding.categoryId !== declaration.categoryId ||
      binding.handler.categoryId !== declaration.categoryId ||
      binding.handler.version !== 1 ||
      binding.handler !== runtimeHandler
    ) {
      add(
        'closure_handler_category_mismatch',
        registryId,
        'Account closure handler does not match its governed category.',
      );
    }
    if (
      !binding ||
      binding.handler.retentionOutcomes.length === 0 ||
      binding.handler.retentionOutcomes.some(
        (mode) => !ACCOUNT_CLOSURE_RETENTION_OUTCOMES.includes(mode),
      )
    ) {
      add(
        'closure_retention_missing',
        registryId,
        'Account closure category requires an explicit supported retention outcome.',
      );
    }
    const evidence = executionEvidence.get(declaration.categoryId);
    if (
      !evidence ||
      evidence.handler !== binding?.handler ||
      evidence.handlerRef !== declaration.handlerRef ||
      evidence.behaviorTestRef !== declaration.testRef ||
      !isSafeExistingTestRef(root, declaration.testRef) ||
      !isExecutionTestEvidence(root)
    ) {
      add(
        'closure_test_missing',
        registryId,
        'Account closure category requires repository-owned test evidence.',
      );
    }
  }

  for (const categoryId of DATA_CATEGORY_IDS) {
    if (!seen.has(categoryId)) {
      add(
        'closure_handler_category_mismatch',
        `account_closure:${categoryId}`,
        'Canonical category has no account closure governance declaration.',
      );
    }
  }

  const allowedReceiptFields = new Set(PUBLIC_RECEIPT_FIELDS);
  if (
    input.receiptFields.some((field) => !allowedReceiptFields.has(field as never)) ||
    new Set(input.receiptFields).size !== input.receiptFields.length
  ) {
    add(
      'closure_receipt_raw_content',
      'account_closure:receipt',
      'Public closure receipts may contain only the reviewed aggregate field allowlist.',
    );
  }

  const accountRights = input.rightsCapabilities.find(
    (capability) => capability.id === 'account_manual_request',
  );
  if (
    accountRights?.delete.status !== 'implemented' ||
    accountRights.delete.handlerRef !==
      'apps/orchestrator/src/trpc/routers/account-closure.ts#accountClosureRouter' ||
    accountRights.export.status !== 'not_implemented'
  ) {
    add(
      'closure_public_claim_exceeds_capability',
      'account_closure:public_claim',
      'Public self-service closure claims must match the implemented route while export stays unavailable.',
    );
  }

  return issues;
}

function isSafeExistingTestRef(root: string, testRef: string): boolean {
  if (!testRef.endsWith('.test.ts') || isAbsolute(testRef)) return false;
  const target = resolve(root, testRef);
  const targetRelative = relative(root, target);
  return (
    targetRelative !== '..' &&
    !targetRelative.startsWith(`..${sep}`) &&
    !isAbsolute(targetRelative) &&
    existsSync(target)
  );
}

function isExecutionTestEvidence(root: string): boolean {
  if (!isSafeExistingTestRef(root, ACCOUNT_CLOSURE_HANDLER_EXECUTION_TEST)) return false;
  const source = readFileSync(resolve(root, ACCOUNT_CLOSURE_HANDLER_EXECUTION_TEST), 'utf8');
  return (
    source.includes('ACCOUNT_CLOSURE_HANDLER_EXECUTION_EVIDENCE') &&
    source.includes("from './handler-release-evidence.js'") &&
    /for\s*\(\s*const\s+evidence\s+of\s+ACCOUNT_CLOSURE_HANDLER_EXECUTION_EVIDENCE\s*\)\s*\{[\s\S]*?evidence\.execute\s*\(/.test(
      source,
    )
  );
}

export interface GovernanceAuditIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

type OutputFormat = 'text' | 'json';

interface ParsedArguments {
  format: OutputFormat;
  strict: boolean;
}

export interface SanitizedGovernanceAuditReport {
  summary: AuditReport['summary'];
  issues: Array<{
    severity: AuditIssue['severity'];
    code: string;
    registryId: string;
    message: string;
  }>;
}

const APPROVED_PRIVACY_CONTACT = 'privacy@holaday.ai';
const APPROVED_CONTACT_PLACEHOLDER = '__APPROVED_PRIVACY_CONTACT__';
const SAFE_ISSUE_CODE = /^[a-z][a-z0-9_]*$/;
const CONFIG_KEY_NAME = /^[A-Z][A-Z0-9_]+$/;
const SAFE_REGISTRY_ID =
  /^(?:(?:category|processor|public_disclosure|account_closure):[a-z][a-z0-9_]*|rights_capability:[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?|retention_policy:[a-z][a-z0-9_]*(?:\.local_regime:[a-z][a-z0-9_]*)?)$/;
const PRIVATE_KEY_BOUNDARY = ['-----BEGIN', '(?:[A-Z ]+ )?PRIVATE', 'KEY-----'].join(' ');
const PRIVATE_KEY = new RegExp(
  `${PRIVATE_KEY_BOUNDARY}[\\s\\S]*?(?:-----END (?:[A-Z ]+ )?PRIVATE KEY-----|$)`,
  'gi',
);
const TOKEN = /\b(?:sk-|ghp_|xoxb-|xoxp-)[A-Za-z0-9_-]*|\bBearer(?:\s+\S+)?/gi;
const COOKIE = /\b(?:document\.)?(?:set-)?cookie\s*(?:=|:)\s*[^\r\n]*/gi;
const BASIC_AUTHORIZATION = /\bauthorization\s*:\s*basic(?:\s+\S+)?/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const SUSPICIOUS_PATH_START =
  /^[^\\/\s]*(?:secret|token|password|passwd|credential|api[_-]?key|private[_-]?key|cookie)[^\\/\s]*[\\/]/gi;
const SUSPICIOUS_PATH_SEGMENT =
  /([\\/])[^\\/\s]*(?:secret|token|password|passwd|credential|api[_-]?key|private[_-]?key|cookie)[^\\/\s]*(?=$|[\\/\s])/gi;
const SENSITIVE_PATTERNS = [
  PRIVATE_KEY,
  TOKEN,
  COOKIE,
  BASIC_AUTHORIZATION,
  EMAIL,
  PHONE,
  SUSPICIOUS_PATH_START,
  SUSPICIOUS_PATH_SEGMENT,
];

function parseArguments(args: readonly string[]): ParsedArguments | undefined {
  let format: OutputFormat = 'text';
  let formatSpecified = false;
  let strict = false;

  for (const argument of args) {
    if (argument === '--strict' && !strict) {
      strict = true;
      continue;
    }
    if (argument === '--format=text' && !formatSpecified) {
      format = 'text';
      formatSpecified = true;
      continue;
    }
    if (argument === '--format=json' && !formatSpecified) {
      format = 'json';
      formatSpecified = true;
      continue;
    }
    return undefined;
  }

  return { format, strict };
}

function repositoryRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url));
}

interface CredentialAssignmentRedaction {
  found: boolean;
  value: string;
}

function redactCredentialAssignments(value: string): CredentialAssignmentRedaction {
  const assignmentStart =
    /\b(password|passwd|api[_-]?key|client[_-]?secret|access[_-]?token|credential)([ \t]*(?:=|:)[ \t]*)/gi;
  const parts: string[] = [];
  let found = false;
  let copiedThrough = 0;
  let match = assignmentStart.exec(value);

  while (match !== null) {
    const valueStart = assignmentStart.lastIndex;
    const key = match[1] ?? '';
    const separator = match[2] ?? '=';
    const redactedMarker = '[redacted-assignment]';
    if (value.startsWith(redactedMarker, valueStart)) {
      assignmentStart.lastIndex = valueStart + redactedMarker.length;
      match = assignmentStart.exec(value);
      continue;
    }
    const quote = value[valueStart];
    let valueEnd = valueStart;

    if (quote === '"' || quote === "'") {
      valueEnd += 1;
      let escaped = false;
      while (valueEnd < value.length) {
        const character = value[valueEnd];
        valueEnd += 1;
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === quote) {
          break;
        }
      }
    } else {
      while (valueEnd < value.length && !/[\s;,]/.test(value[valueEnd] ?? '')) {
        valueEnd += 1;
      }
    }
    if (valueEnd === valueStart) {
      match = assignmentStart.exec(value);
      continue;
    }

    found = true;
    parts.push(
      value.slice(copiedThrough, match.index),
      CONFIG_KEY_NAME.test(key) ? `${key}${separator}${redactedMarker}` : redactedMarker,
    );
    copiedThrough = valueEnd;
    assignmentStart.lastIndex = valueEnd;
    match = assignmentStart.exec(value);
  }

  if (!found) return { found: false, value };
  parts.push(value.slice(copiedThrough));
  return { found: true, value: parts.join('') };
}

function hasSensitiveContent(value: string): boolean {
  if (redactCredentialAssignments(value).found) return true;
  return SENSITIVE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function sanitizeMessage(message: string): string {
  const contactProtected = message.replace(
    new RegExp(APPROVED_PRIVACY_CONTACT, 'gi'),
    APPROVED_CONTACT_PLACEHOLDER,
  );
  const sanitized = redactCredentialAssignments(contactProtected)
    .value.replace(PRIVATE_KEY, '[redacted-private-key]')
    .replace(COOKIE, '[redacted-cookie]')
    .replace(TOKEN, '[redacted-token]')
    .replace(BASIC_AUTHORIZATION, '[redacted-authorization]')
    .replace(EMAIL, '[redacted-email]')
    .replace(PHONE, '[redacted-phone]')
    .replace(SUSPICIOUS_PATH_START, '[redacted-path]/')
    .replace(SUSPICIOUS_PATH_SEGMENT, '$1[redacted-path]');
  return hasSensitiveContent(sanitized)
    ? '[redacted-sensitive-message]'
    : sanitized.replaceAll(APPROVED_CONTACT_PLACEHOLDER, APPROVED_PRIVACY_CONTACT);
}

function sanitizeIssue(issue: AuditIssue): SanitizedGovernanceAuditReport['issues'][number] {
  const registryIdIsSafe =
    SAFE_REGISTRY_ID.test(issue.registryId) && !hasSensitiveContent(issue.registryId);
  const message = registryIdIsSafe
    ? issue.message
    : issue.message.replaceAll(issue.registryId, '[redacted-registry-id]');
  return {
    severity: issue.severity,
    code: SAFE_ISSUE_CODE.test(issue.code) ? issue.code : 'invalid_issue_code',
    registryId: registryIdIsSafe ? issue.registryId : '[redacted-registry-id]',
    message: sanitizeMessage(message),
  };
}

export function sanitizeGovernanceAuditReport(report: AuditReport): SanitizedGovernanceAuditReport {
  return {
    summary: { ...report.summary },
    issues: report.issues.map(sanitizeIssue),
  };
}

export function formatGovernanceAuditText(report: AuditReport): string[] {
  const sanitized = sanitizeGovernanceAuditReport(report);
  const { summary } = sanitized;
  return [
    `categories: ${summary.categories}`,
    `processors: ${summary.processors}`,
    `retentionPolicies: ${summary.retentionPolicies}`,
    `rightsCapabilities: ${summary.rightsCapabilities}`,
    `unknownOrPendingProcessors: ${summary.unknownOrPendingProcessors}`,
    `manualCapabilities: ${summary.manualCapabilities}`,
    `notImplementedCapabilities: ${summary.notImplementedCapabilities}`,
    `unknownRetentionPolicies: ${summary.unknownRetentionPolicies}`,
    `errors: ${summary.errors}`,
    `gaps: ${summary.gaps}`,
    ...sanitized.issues.map(
      (issue) => `[governance:${issue.code}] ${issue.registryId}: ${issue.message}`,
    ),
  ];
}

function printTextReport(report: AuditReport, io: GovernanceAuditIo): void {
  for (const line of formatGovernanceAuditText(report)) {
    io.stdout(line);
  }
}

export interface GovernanceAuditDependencies {
  readonly buildReport?: () => AuditReport;
}

export function buildGovernanceAuditReport(): AuditReport {
  const base = auditGovernanceRegistry(governanceRegistry, {
    repoRoot: repositoryRoot(),
    verifyEvidenceFiles: true,
    requirePublicDisclosures: true,
  });
  const closureIssues = auditAccountClosureGovernance({
    declarations: ACCOUNT_CLOSURE_GOVERNANCE_DECLARATIONS,
    handlerBindings: ACCOUNT_CLOSURE_HANDLER_BINDINGS,
    runtimeHandlers: ACCOUNT_CLOSURE_HANDLERS,
    executionEvidence: ACCOUNT_CLOSURE_HANDLER_EXECUTION_EVIDENCE,
    receiptFields: PUBLIC_RECEIPT_FIELDS,
    rightsCapabilities: governanceRegistry.rightsCapabilities,
    repoRoot: repositoryRoot(),
  });
  const errors = base.summary.errors + closureIssues.length;
  return {
    ...base,
    ok: errors === 0,
    summary: { ...base.summary, errors },
    issues: [...base.issues, ...closureIssues],
  };
}

export function runGovernanceAuditCli(
  args: readonly string[],
  io: GovernanceAuditIo,
  dependencies: GovernanceAuditDependencies = {},
): 0 | 1 | 2 {
  const parsed = parseArguments(args);
  if (!parsed) {
    io.stderr(
      'Unsupported governance audit arguments. Allowed: --format=text, --format=json, --strict.',
    );
    return 2;
  }

  let report: AuditReport;
  try {
    report = dependencies.buildReport?.() ?? buildGovernanceAuditReport();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown report construction error.';
    io.stderr(`Governance audit could not construct a report: ${sanitizeMessage(message)}`);
    return 2;
  }

  if (parsed.format === 'json') {
    io.stdout(JSON.stringify(sanitizeGovernanceAuditReport(report)));
  } else {
    printTextReport(report, io);
  }

  if (report.summary.errors > 0 || (parsed.strict && report.summary.gaps > 0)) return 1;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runGovernanceAuditCli(process.argv.slice(2), {
    stdout: (message) => console.log(message),
    stderr: (message) => console.error(message),
  });
}
