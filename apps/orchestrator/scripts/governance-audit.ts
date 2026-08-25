import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type AuditIssue,
  type AuditReport,
  auditGovernanceRegistry,
  governanceRegistry,
} from '../src/data-governance/index.js';

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
const SAFE_REGISTRY_ID =
  /^(?:category|processor|retention_policy|rights_capability|public_disclosure):[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/;
const PRIVATE_KEY =
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z ]+ )?PRIVATE KEY-----|$)/gi;
const TOKEN = /\b(?:sk-|ghp_|xoxb-|xoxp-)[A-Za-z0-9_-]*|\bBearer(?:\s+\S+)?/gi;
const COOKIE = /\b(?:document\.)?(?:set-)?cookie\s*(?:=|:)\s*[^\r\n]*/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const SUSPICIOUS_PATH_SEGMENT =
  /(^|[\\/])[^\\/\s]*(?:secret|token|password|passwd|credential|api[_-]?key|private[_-]?key|cookie)[^\\/\s]*(?=$|[\\/\s])/gi;

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

function sanitizeMessage(message: string): string {
  return message
    .replace(new RegExp(APPROVED_PRIVACY_CONTACT, 'gi'), APPROVED_CONTACT_PLACEHOLDER)
    .replace(PRIVATE_KEY, '[redacted-private-key]')
    .replace(COOKIE, '[redacted-cookie]')
    .replace(TOKEN, '[redacted-token]')
    .replace(EMAIL, '[redacted-email]')
    .replace(PHONE, '[redacted-phone]')
    .replace(SUSPICIOUS_PATH_SEGMENT, '$1[redacted-path]')
    .replaceAll(APPROVED_CONTACT_PLACEHOLDER, APPROVED_PRIVACY_CONTACT);
}

function sanitizeIssue(issue: AuditIssue): SanitizedGovernanceAuditReport['issues'][number] {
  const registryIdIsSafe = SAFE_REGISTRY_ID.test(issue.registryId);
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

export function runGovernanceAuditCli(args: readonly string[], io: GovernanceAuditIo): 0 | 1 | 2 {
  const parsed = parseArguments(args);
  if (!parsed) {
    io.stderr(
      'Unsupported governance audit arguments. Allowed: --format=text, --format=json, --strict.',
    );
    return 2;
  }

  let report: AuditReport;
  try {
    report = auditGovernanceRegistry(governanceRegistry, {
      repoRoot: repositoryRoot(),
      verifyEvidenceFiles: true,
      requirePublicDisclosures: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown report construction error.';
    io.stderr(`Governance audit could not construct a report: ${message}`);
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
