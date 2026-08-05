import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifySmokePollStatus,
  selectSmokeTasks,
} from './supercar-smoke-state.mjs';

test('stops polling for every terminal task status', () => {
  for (const status of ['completed', 'partial_success', 'failed', 'cancelled']) {
    assert.equal(classifySmokePollStatus(status), 'terminal');
  }
});

test('stops polling when the smoke task needs a person or is paused', () => {
  assert.equal(classifySmokePollStatus('awaiting_user'), 'action_required');
  assert.equal(classifySmokePollStatus('paused'), 'action_required');
});

test('keeps polling only active pre-terminal statuses', () => {
  for (const status of ['pending', 'planning', 'queued', 'executing']) {
    assert.equal(classifySmokePollStatus(status), 'continue');
  }
});

test('selects an explicit subset without changing task order', () => {
  const tasks = [{ id: 'T01' }, { id: 'T02' }, { id: 'T03' }];

  assert.deepEqual(selectSmokeTasks(tasks, 'T03, T01'), [tasks[0], tasks[2]]);
});

test('rejects unknown smoke task ids instead of silently skipping them', () => {
  const tasks = [{ id: 'T01' }, { id: 'T02' }];

  assert.throws(() => selectSmokeTasks(tasks, 'T01,T99'), /Unknown smoke task ids: T99/);
});
