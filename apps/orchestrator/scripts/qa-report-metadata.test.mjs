import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQaReportMetadata } from './qa-report-metadata.mjs';

test('local UI QA report is explicit about fixture-only browser coverage', () => {
  assert.deepEqual(buildQaReportMetadata({ isLocal: true }), {
    scope: 'local-ui-fixture',
    chromeUiVerified: true,
    liveBrowserSessionVerified: false,
    liveEgressVerified: false,
    releaseRequirement: 'Run pnpm --filter @holaday/orchestrator smoke:browser-egress separately.',
  });
});

test('remote UI QA report does not claim a live managed browser session', () => {
  assert.deepEqual(buildQaReportMetadata({ isLocal: false }), {
    scope: 'remote-ui',
    chromeUiVerified: true,
    liveBrowserSessionVerified: false,
    liveEgressVerified: false,
    releaseRequirement: 'Run pnpm --filter @holaday/orchestrator smoke:browser-egress separately.',
  });
});
