import { describe, expect, it } from 'vitest';
import type { NeutralMessage, NeutralToolResultBlock } from '../../llm/messages-adapter.js';
import { SelectedChromeModelContext } from './selected-chrome-context.js';

describe('selected Chrome exact observation deduplication', () => {
  const page = (bodyText: string) => ({
    origin: 'https://work.example',
    title: 'Report',
    bodyText,
    ariaSnapshot: bodyText,
    truncated: false,
  });
  const receipt = (id: string, observation: unknown): NeutralMessage => ({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        toolUseId: id,
        content: JSON.stringify({ ok: true, actionOutcome: 'applied', revision: 2, observation }),
      },
    ],
  });
  const tool = (id: string, name = 'browser_act'): NeutralMessage => ({
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id,
        name,
        input: { action: { kind: 'click' } },
      },
    ],
  });

  it('sends an unchanged large page once while retaining the latest revision and every action receipt', () => {
    const context = new SelectedChromeModelContext();
    const body = 'EXACT_PAGE_CONTENT_'.repeat(5000);
    const messages: NeutralMessage[] = [
      { role: 'user', content: 'Read only. Never repeat the export.' },
    ];
    for (let revision = 1; revision <= 10; revision++) {
      messages.push(
        context.observation(page(body), revision),
        tool(`act-${revision}`),
        receipt(`act-${revision}`, page(body)),
      );
    }
    const before = JSON.stringify(messages);
    const projected = context.project(messages);
    const after = JSON.stringify(projected);
    expect(after.length).toBeLessThan(before.length / 8);
    expect(after.match(/EXACT_PAGE_CONTENT_/g)).toHaveLength(10000); // body + accessibility copy, once each
    expect(after).toContain('revision 10');
    expect(after).not.toContain('revision 1).');
    expect(after).toContain('Never repeat the export');
    const results = projected
      .flatMap((m) => (typeof m.content === 'string' ? [] : m.content))
      .filter((b): b is NeutralToolResultBlock => b.type === 'tool_result');
    expect(results).toHaveLength(10);
    expect(results.every((b) => JSON.parse(b.content).actionOutcome === 'applied')).toBe(true);
    expect(JSON.stringify(messages)).toBe(before); // recorder input and earlier requests remain immutable
  });

  it('retains distinct historical pages, intermediate action observations, and file evidence byte for byte', () => {
    const context = new SelectedChromeModelContext();
    const fileResult: NeutralMessage = {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'file',
          content: JSON.stringify({
            ok: true,
            text: 'DO_NOT_DROP_SOURCE',
            observation: page('file data'),
            coverage: { complete: true },
          }),
        },
      ],
    };
    const messages = [
      context.observation(page('old price 12'), 1),
      tool('action'),
      receipt('action', page('intermediate price 13')),
      tool('file', 'read_task_file'),
      fileResult,
      context.observation(page('new price 14'), 2),
    ];
    const projected = context.project(messages);
    const text = JSON.stringify(projected);
    for (const value of [
      'old price 12',
      'intermediate price 13',
      'new price 14',
      'DO_NOT_DROP_SOURCE',
    ])
      expect(text).toContain(value);
    expect(projected).toContainEqual(fileResult);
  });

  it('deduplicates only host-marked identical file reference lists, preserving changed scopes and user text', () => {
    const context = new SelectedChromeModelContext();
    const user: NeutralMessage = { role: 'user', content: 'files A' };
    const projected = context.project([
      user,
      context.fileReferences('files A'),
      context.fileReferences('files B'),
      context.fileReferences('files A'),
    ]);
    expect(projected.filter((m) => m.content === 'files A')).toHaveLength(2);
    expect(projected).toContain(user);
    expect(projected.some((m) => m.content === 'files B')).toBe(true);
  });
});
