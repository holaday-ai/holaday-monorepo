import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  formatGovernanceAuditText,
  runGovernanceAuditCli,
  sanitizeGovernanceAuditReport,
} from '../../scripts/governance-audit.js';
import type { AuditReport } from './types.js';

function io() {
  return { stdout: vi.fn(), stderr: vi.fn() };
}

function unsafeReport(): AuditReport {
  return {
    ok: false,
    summary: {
      categories: 2,
      processors: 0,
      retentionPolicies: 0,
      rightsCapabilities: 0,
      unknownOrPendingProcessors: 0,
      manualCapabilities: 0,
      notImplementedCapabilities: 0,
      unknownRetentionPolicies: 0,
      errors: 1,
      gaps: 1,
    },
    issues: [
      {
        severity: 'error',
        code: 'source_evidence_missing',
        registryId: 'category:sk-live-registry-secret-123456',
        message:
          'Evidence source does not exist: config/secrets/ghp_private-token-123456; Bearer private-token; Cookie: session=private-value; user@example.test; +1 415 555 0123.',
      },
      {
        severity: 'gap',
        code: 'governance_gap',
        registryId: 'category:account_security',
        message: 'Public entry point is privacy@holaday.ai.',
      },
      {
        severity: 'gap',
        code: 'governance_gap',
        registryId: 'retention_policy:cookie_injection_mixed',
        message: 'Governance state requires follow-up: not_implemented.',
      },
      {
        severity: 'error',
        code: 'source_evidence_missing',
        registryId: 'processor:ghp_abcdefghijklmnopqrstuvwxyz',
        message:
          'Evidence for processor:ghp_abcdefghijklmnopqrstuvwxyz has password=plain-password-value; api_key=api-value-123; api-key:api-value-456; Authorization: Basic basic-token-789; config key OPENAI_API_KEY.',
      },
      {
        severity: 'error',
        code: 'source_evidence_missing',
        registryId: 'category:account_security',
        message:
          'Quoted values: password="double word secret"; api_key=\'single word secret\'; api-key:"escaped \\" quote secret"; password="unclosed tail secret remains until end',
      },
    ],
  };
}

function danglingEscapeReport(): AuditReport {
  return {
    ok: false,
    summary: {
      categories: 1,
      processors: 0,
      retentionPolicies: 0,
      rightsCapabilities: 0,
      unknownOrPendingProcessors: 0,
      manualCapabilities: 0,
      notImplementedCapabilities: 0,
      unknownRetentionPolicies: 0,
      errors: 2,
      gaps: 0,
    },
    issues: [
      {
        severity: 'error',
        code: 'source_evidence_missing',
        registryId: 'category:account_security',
        message: 'Double dangling: password="double word secret\\',
      },
      {
        severity: 'error',
        code: 'source_evidence_missing',
        registryId: 'category:account_security',
        message: "Single dangling: api_key='single word secret\\",
      },
    ],
  };
}

describe('governance audit CLI', () => {
  it('prints aggregate text and explicit gap ids without raw data', () => {
    const output = io();
    const code = runGovernanceAuditCli([], output);
    expect(code).toBe(0);
    const text = output.stdout.mock.calls.flat().join('\n');
    expect(text).toContain('categories: 13');
    expect(text).toContain('not_implemented');
    expect(text).not.toMatch(/cookie=.*|Bearer\s+|sk-[A-Za-z0-9]{12,}/i);
  });

  it('emits valid JSON containing only summaries and issues', () => {
    const output = io();
    expect(runGovernanceAuditCli(['--format=json'], output)).toBe(0);
    const [json] = output.stdout.mock.calls[0] ?? [];
    if (typeof json !== 'string') throw new Error('Expected JSON audit output.');
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty('summary.categories', 13);
    expect(parsed).toHaveProperty('summary.unknownOrPendingProcessors');
    expect(parsed).toHaveProperty('summary.manualCapabilities');
    expect(parsed).toHaveProperty('summary.notImplementedCapabilities');
    expect(parsed).toHaveProperty('summary.unknownRetentionPolicies');
    expect(parsed).toHaveProperty('issues');
    expect(parsed).not.toHaveProperty('categories');
    expect(parsed).not.toHaveProperty('processors');
  });

  it('turns explicit gaps into a strict-mode failure without changing normal mode', () => {
    expect(runGovernanceAuditCli([], io())).toBe(0);
    expect(runGovernanceAuditCli(['--strict'], io())).toBe(1);
  });

  it('returns 2 for unsupported arguments', () => {
    const output = io();
    expect(runGovernanceAuditCli(['--show-secrets'], output)).toBe(2);
    expect(output.stderr).toHaveBeenCalled();
  });

  it('sanitizes unsafe audit issue fields before text and JSON output', () => {
    const report = unsafeReport();
    const json = JSON.stringify(sanitizeGovernanceAuditReport(report));
    const text = formatGovernanceAuditText(report).join('\n');

    for (const output of [json, text]) {
      expect(output).toContain('[redacted-registry-id]');
      expect(output).toContain('category:account_security');
      expect(output).toContain('retention_policy:cookie_injection_mixed');
      expect(output).toContain('privacy@holaday.ai');
      expect(output).toContain('OPENAI_API_KEY');
      expect(output).toContain(
        'Quoted values: [redacted-assignment]; [redacted-assignment]; [redacted-assignment]; [redacted-assignment]',
      );
      expect(output).not.toMatch(
        /sk-live-registry-secret-123456|ghp_private-token-123456|Bearer private-token|Cookie: session=private-value|user@example\.test|\+1 415 555 0123|config\/secrets|ghp_abcdefghijklmnopqrstuvwxyz|password=plain-password-value|api_key=api-value-123|api-key:api-value-456|Authorization: Basic basic-token-789|double word secret|single word secret|escaped \\" quote secret|unclosed tail secret remains until end/i,
      );
    }
  });

  it('redacts dangling escapes at the end of unclosed quoted assignments in JSON and text', () => {
    const report = danglingEscapeReport();
    const json = JSON.stringify(sanitizeGovernanceAuditReport(report));
    const parsed = JSON.parse(json) as ReturnType<typeof sanitizeGovernanceAuditReport>;
    const textLines = formatGovernanceAuditText(report);
    const expectedMessages = [
      'Double dangling: [redacted-assignment]',
      'Single dangling: [redacted-assignment]',
    ];

    expect(parsed.issues.map((issue) => issue.message)).toEqual(expectedMessages);
    expect(textLines.slice(-2)).toEqual([
      '[governance:source_evidence_missing] category:account_security: Double dangling: [redacted-assignment]',
      '[governance:source_evidence_missing] category:account_security: Single dangling: [redacted-assignment]',
    ]);
    expect(json).not.toContain('word secret');
    expect(textLines.join('\n')).not.toContain('word secret');
  });

  it('redacts credential assignments while preserving uppercase configuration key names', () => {
    const secretFragments = [
      'client secret with spaces',
      'access-token-value',
      'sk-credential-token-value',
      'unterminated credential tail',
    ];
    const report: AuditReport = {
      ...unsafeReport(),
      issues: [
        {
          severity: 'error',
          code: 'suspicious_secret',
          registryId: 'category:account_security',
          message:
            'CLIENT_SECRET="client secret with spaces"; ACCESS_TOKEN=access-token-value; credential=sk-credential-token-value; CREDENTIAL="unterminated credential tail',
        },
      ],
    };
    const outputs = [
      JSON.stringify(sanitizeGovernanceAuditReport(report)),
      formatGovernanceAuditText(report).join('\n'),
    ];

    for (const output of outputs) {
      expect(output).toContain('CLIENT_SECRET=[redacted-assignment]');
      expect(output).toContain('ACCESS_TOKEN=[redacted-assignment]');
      expect(output).toContain('CREDENTIAL=[redacted-assignment]');
      for (const fragment of secretFragments) expect(output).not.toContain(fragment);
    }
  });

  it('sanitizes report-construction exception messages before writing stderr', () => {
    const output = io();
    const code = runGovernanceAuditCli([], output, {
      buildReport: () => {
        throw new Error(
          'failed with CLIENT_SECRET="stderr client secret" and credential=sk-stderr-token',
        );
      },
    });

    expect(code).toBe(2);
    const stderr = output.stderr.mock.calls.flat().join('\n');
    expect(stderr).toContain('CLIENT_SECRET=[redacted-assignment]');
    expect(stderr).not.toMatch(/stderr client secret|sk-stderr-token/);
  });

  it('redacts PEM private keys from JSON and text while retaining safe registry ids', () => {
    const pemHeader = '-----BEGIN RSA PRIVATE KEY-----';
    const pemBody = 'synthetic-private-key-body-fragment';
    const pemFooter = '-----END RSA PRIVATE KEY-----';
    const report: AuditReport = {
      ...unsafeReport(),
      issues: [
        {
          severity: 'error',
          code: 'source_evidence_missing',
          registryId: 'category:account_security',
          message: `Captured credential:\n${pemHeader}\n${pemBody}\n${pemFooter}`,
        },
      ],
    };
    const json = JSON.stringify(sanitizeGovernanceAuditReport(report));
    const text = formatGovernanceAuditText(report).join('\n');

    for (const output of [json, text]) {
      expect(output).toContain('category:account_security');
      expect(output).toContain('[redacted-private-key]');
      expect(output).not.toContain(pemHeader);
      expect(output).not.toContain(pemBody);
      expect(output).not.toContain(pemFooter);
    }
  });

  it('runs directly with console-compatible output handlers', () => {
    const scriptPath = fileURLToPath(new URL('../../scripts/governance-audit.ts', import.meta.url));
    const orchestratorRoot = fileURLToPath(new URL('../../', import.meta.url));
    const result = spawnSync(process.execPath, ['--import', 'tsx', scriptPath], {
      cwd: orchestratorRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('categories: 13');
    expect(result.stderr).toBe('');
  });
});
