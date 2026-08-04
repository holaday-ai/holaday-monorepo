import { describe, expect, it, vi } from 'vitest';
import type { PoolConfig } from './types.js';
import {
  findOrphanProcessIds,
  parsePsProcessList,
  signalProcessOrGroup,
} from './reaper.js';

const config: PoolConfig = {
  maxInstances: 3,
  idleTimeoutMs: 60_000,
  baseDir: '/tmp/holaday-browser-pool',
  cdpPortStart: 9300,
  vncPortStart: 5901,
  wsPortStart: 6080,
  displayStart: 90,
  screenSize: '1280x800x24',
};

describe('browser-pool orphan reaper', () => {
  it('finds macOS task-browser processes from ps output without matching unrelated Chromium', () => {
    const entries = parsePsProcessList(`
  101 /Applications/Google Chrome for Testing --user-data-dir=/tmp/holaday-browser-pool/task_tsk_old
  102 /Applications/Google Chrome for Testing --user-data-dir=/tmp/another-project/task_tsk_other
  103 node dist/index.js
`);

    expect(findOrphanProcessIds(entries, config, 103)).toEqual([101]);
  });

  it('falls back to signalling one process when it is not a process-group leader', () => {
    const kill = vi.fn((pid: number) => {
      if (pid < 0) {
        const error = new Error('missing process group') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        throw error;
      }
    });

    expect(signalProcessOrGroup(101, 'SIGTERM', kill)).toBe(true);
    expect(kill.mock.calls).toEqual([[-101, 'SIGTERM'], [101, 'SIGTERM']]);
  });
});
