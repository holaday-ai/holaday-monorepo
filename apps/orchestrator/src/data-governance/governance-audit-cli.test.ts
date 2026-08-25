import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runGovernanceAuditCli } from '../../scripts/governance-audit.js';

function io() {
  return { stdout: vi.fn(), stderr: vi.fn() };
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
    const parsed = JSON.parse(output.stdout.mock.calls[0][0]);
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
