import { describe, expect, it } from 'vitest';
import { loadOrangeBenchFromEnvironment, stdioParameters } from './stdio.js';
const key = `obk_${'a'.repeat(32)}_${'b'.repeat(32)}_${'c'.repeat(43)}`;
const config = {
  enabled: true,
  taskId: 'host-task',
  pythonExecutable: '/private/client/bin/python',
  serverRoot: '/private/client/package',
  apiUrl: 'https://orangebench.ai/api/v1',
  apiKey: key,
  journalDirectory: '/private/client/state',
};
it('keeps the process disabled unless explicitly enabled by the host', async () => {
  expect(await loadOrangeBenchFromEnvironment({}, 'task', '/private/state')).toBeNull();
});
describe('closed stdio configuration', () => {
  it('passes Key only through minimal environment and never inherits provider keys', () => {
    const parameters = stdioParameters(config);
    expect(parameters.command).toBe(config.pythonExecutable);
    expect(parameters.args).toEqual(['-m', 'orangebench_mcp.server']);
    expect(JSON.stringify([parameters.command, parameters.args, parameters.cwd])).not.toContain(
      key,
    );
    expect(parameters.env).toEqual({
      PATH: '/usr/bin:/bin',
      PYTHONPATH: '/private/client/package/src',
      PYTHONUNBUFFERED: '1',
      ORANGEBENCH_API_KEY: key,
      ORANGEBENCH_API_URL: config.apiUrl,
    });
    expect(parameters.stderr).toBe('pipe');
    expect(parameters.maxBufferSize).toBe(2 * 1024 * 1024);
  });
  it.each([
    'http://orangebench.ai/api/v1',
    'https://evil.example/api/v1',
    'https://user:pass@orangebench.ai/api/v1',
    'https://orangebench.ai/api/v1?secret=bad',
    'http://127.0.0.1:9999/v1',
  ])('rejects unsafe URL %s', (apiUrl) => {
    expect(() => stdioParameters({ ...config, apiUrl })).toThrow(
      'orangebench_configuration_invalid',
    );
  });
  it('allows loopback only for an explicitly configured fixture', () => {
    expect(
      stdioParameters({
        ...config,
        apiUrl: 'http://127.0.0.1:9999/v1',
        allowLoopbackForTests: true,
      }).env?.ORANGEBENCH_API_URL,
    ).toContain('127.0.0.1');
  });
});
