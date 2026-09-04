import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  evaluateQwenGoldResults,
  scanProductionModelImports,
} from './qwen-only-release-contract.mjs';

describe('Qwen-only release contract', () => {
  it('rejects real legacy provider construction outside migration inventory', () => {
    const result = scanProductionModelImports({
      roots: ['src/index.ts'],
      files: [
        { path: 'src/index.ts', text: "import './live.js';" },
        { path: 'src/live.ts', text: 'const client = new Anthropic();' },
      ],
      inventory: { entries: [] },
    });

    assert.deepEqual(result.violations, [
      { path: 'src/live.ts', rule: 'legacy_model_client', pattern: 'new_anthropic' },
    ]);
  });

  it('rejects a production path to the dormant boundary', () => {
    const result = scanProductionModelImports({
      roots: ['src/index.ts'],
      files: [
        { path: 'src/index.ts', text: "import './llm/dormant/legacy.js';" },
        { path: 'src/llm/dormant/legacy.ts', text: 'export const legacy = true;' },
      ],
      inventory: { entries: [] },
    });

    assert.deepEqual(result.violations, [
      { path: 'src/llm/dormant/legacy.ts', rule: 'production_reaches_dormant' },
    ]);
  });

  it('freezes exact legacy counts at an explicitly disabled migration boundary', () => {
    const files = [
      { path: 'src/index.ts', text: 'export const live = true;' },
      { path: 'src/media-boundary.ts', text: 'const client = new OpenAI();' },
    ];
    const matching = scanProductionModelImports({
      roots: ['src/index.ts'],
      files,
      inventory: {
        entries: [
          {
            path: 'src/media-boundary.ts',
            status: 'disabled_by_qwen_top_boundary',
            patterns: { new_openai: 1 },
          },
        ],
      },
    });
    assert.deepEqual(matching.violations, []);

    const increased = scanProductionModelImports({
      roots: ['src/index.ts'],
      files: files.map((file) =>
        file.path === 'src/media-boundary.ts'
          ? { ...file, text: `${file.text}\nconst second = new OpenAI();` }
          : file,
      ),
      inventory: matching.inventory,
    });
    assert.deepEqual(increased.violations, [
      {
        path: 'src/media-boundary.ts',
        rule: 'legacy_inventory_mismatch',
        pattern: 'new_openai',
        expected: 1,
        actual: 2,
      },
    ]);
  });

  it('rejects a production path to an inventoried legacy file', () => {
    const result = scanProductionModelImports({
      roots: ['src/index.ts'],
      files: [
        { path: 'src/index.ts', text: "import './media-boundary.js';" },
        { path: 'src/media-boundary.ts', text: 'const client = new OpenAI();' },
      ],
      inventory: {
        entries: [
          {
            path: 'src/media-boundary.ts',
            status: 'disabled_by_qwen_top_boundary',
            patterns: { new_openai: 1 },
          },
        ],
      },
    });

    assert.deepEqual(result.violations, [
      { path: 'src/media-boundary.ts', rule: 'production_reaches_legacy_inventory' },
    ]);
  });

  it('enforces the fixed verifier quality thresholds', () => {
    assert.equal(
      evaluateQwenGoldResults([
        {
          expected: 'pass',
          actual: 'pass',
          structured: true,
          deterministicBefore: 'pass',
          deterministicAfter: 'pass',
        },
        {
          expected: 'severe',
          actual: 'reject',
          structured: true,
          deterministicBefore: 'fail',
          deterministicAfter: 'fail',
        },
        {
          expected: 'severe',
          actual: 'reject',
          structured: true,
          deterministicBefore: 'fail',
          deterministicAfter: 'fail',
        },
      ]).status,
      'pass',
    );

    assert.equal(
      evaluateQwenGoldResults([
        {
          expected: 'severe',
          actual: 'pass',
          structured: true,
          deterministicBefore: 'fail',
          deterministicAfter: 'pass',
        },
      ]).status,
      'fail',
    );
  });

  it('keeps the committed human-labelled gold set above every release threshold', () => {
    const fixture = JSON.parse(
      readFileSync(new URL('./fixtures/qwen-core-gold.json', import.meta.url), 'utf8'),
    );
    const result = evaluateQwenGoldResults(fixture.cases);

    assert.deepEqual(result, {
      status: 'pass',
      total: 6,
      severeIssueRecall: 1,
      correctAnswerFalseRejectionRate: 0,
      deterministicFailToPass: 0,
      structuredOutputValidity: 1,
    });
  });
});
