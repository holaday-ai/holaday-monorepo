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
      expect(output).toContain('privacy@holaday.ai');
      expect(output).not.toMatch(
        /sk-live-registry-secret-123456|ghp_private-token-123456|Bearer private-token|Cookie: session=private-value|user@example\.test|\+1 415 555 0123|config\/secrets/i,
      );
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
