import { fileURLToPath, pathToFileURL } from 'node:url';
import {
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

function printTextReport(report: AuditReport, io: GovernanceAuditIo): void {
  const { summary } = report;
  io.stdout(`categories: ${summary.categories}`);
  io.stdout(`processors: ${summary.processors}`);
  io.stdout(`retentionPolicies: ${summary.retentionPolicies}`);
  io.stdout(`rightsCapabilities: ${summary.rightsCapabilities}`);
  io.stdout(`unknownOrPendingProcessors: ${summary.unknownOrPendingProcessors}`);
  io.stdout(`manualCapabilities: ${summary.manualCapabilities}`);
  io.stdout(`notImplementedCapabilities: ${summary.notImplementedCapabilities}`);
  io.stdout(`unknownRetentionPolicies: ${summary.unknownRetentionPolicies}`);
  io.stdout(`errors: ${summary.errors}`);
  io.stdout(`gaps: ${summary.gaps}`);
  for (const issue of report.issues) {
    io.stdout(`[governance:${issue.code}] ${issue.registryId}: ${issue.message}`);
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
    io.stdout(JSON.stringify({ summary: report.summary, issues: report.issues }));
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
