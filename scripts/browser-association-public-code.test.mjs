import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFirstCutoverRetirementObserver } from './browser-first-cutover-host.mjs';

for (const message of [
  'CUTOVER_CLOUD_OLD_BROWSER_ASSOCIATION_UNPROVEN',
  'PRIVATE-arbitrary-association-detail',
]) {
  for (const sinkThrows of [false, true]) {
    test(`observer retains only fixed association code, sinkThrows=${sinkThrows}, known=${message.startsWith('CUTOVER_')}`, async () => {
      const events = [];
      await assert.rejects(
        createFirstCutoverRetirementObserver(
          { reviews: {}, binding: {}, legacyDigest: 'x' },
          {
            now: () => 1000,
            journal: {
              assertOwnership: async () => ({}),
              readFirstCutoverEffects: async () => {
                throw new Error(message);
              },
            },
            reportRejection: async (event) => {
              events.push(event);
              if (sinkThrows) throw new Error('PRIVATE-SINK');
            },
          },
        ),
        /^Error: CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN$/,
      );
      assert.equal(events[0].code, message.startsWith('CUTOVER_') ? message : 'UNCLASSIFIED');
      assert.equal(JSON.stringify(events).includes('PRIVATE'), false);
      assert.ok(Buffer.byteLength(JSON.stringify(events)) < 65536);
    });
  }
}
