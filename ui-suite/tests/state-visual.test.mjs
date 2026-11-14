import assert from 'node:assert/strict';
import test from 'node:test';
import { pixelDifference, taskStateFindings } from '../lib/checks.mjs';
test('completed generation cannot retain working status or browser failure instructions', () => {
  assert.deepEqual(
    taskStateFindings('正在处理… 浏览器遇到问题', { status: 'completed', mode: 'generate' }).map(
      (x) => x.rule,
    ),
    ['terminal-progress-stale', 'wrong-task-browser-ui'],
  );
  assert.deepEqual(taskStateFindings('任务已完成', { status: 'completed', mode: 'generate' }), []);
  assert.deepEqual(taskStateFindings('连接 Chrome', { status: 'executing', mode: 'browser' }), []);
});
test('visual drift above the declared pixel threshold is flagged and identical images remain green', () => {
  const a = { width: 2, height: 1, data: Uint8Array.of(0, 0, 0, 255, 0, 0, 0, 255) };
  const b = { ...a, data: Uint8Array.of(255, 255, 255, 255, 0, 0, 0, 255) };
  assert.deepEqual(pixelDifference(a, b), { different: true, ratio: 0.5 });
  assert.deepEqual(pixelDifference(a, a), { different: false, ratio: 0 });
});

test('empty visible browser workspace is forbidden on a generation task', () => {
  assert.deepEqual(
    taskStateFindings('', { status: 'completed', mode: 'generate', browserPanelVisible: true }).map(
      (x) => x.rule,
    ),
    ['wrong-task-browser-panel'],
  );
});
