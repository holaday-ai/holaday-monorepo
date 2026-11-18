import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { openRepresentativeChrome } from '../../testing/browser-representative-candidate.js';
import { BrowserControl } from '../supercar/browser-control.js';
import { SelectedChromeClient } from '../supercar/selected-chrome-client.js';
import { runSelectedChromeTask } from '../supercar/selected-chrome-runner.js';

it.runIf(process.env.HOLADAY_TASK_SCREENSHOT_NATIVE === '1')(
  'delivers a masked native task capture with real file bytes and keeps the ordinary tab',
  async () => {
    const artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR;
    if (!artifacts || process.version !== 'v22.23.3')
      throw new Error('Explicit artifacts and Node22.23.3 required');
    await mkdir(artifacts, { recursive: true });
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        req.url === '/frame'
          ? '<body style="margin:0"><input style="width:200px;height:40px;background:red" type="password" value="frame-secret">'
          : `<body style="margin:0;background:white"><div style="position:absolute;left:20px;top:20px;width:80px;height:40px;background:#00ff00">Ready</div><input style="position:absolute;left:20px;top:100px;width:200px;height:40px;background:red" type="password" value="private-password"><div style="position:absolute;left:300px;top:100px;width:200px;height:40px;background:red">private-password</div><input data-hd-human-typed style="position:absolute;left:20px;top:180px;width:200px;height:40px;background:red" value="private-human-value"><div style="position:absolute;left:300px;top:180px;width:200px;height:40px;background:red">private-human-value</div><iframe src="/frame" style="position:absolute;left:20px;top:260px;width:250px;height:80px;border:0"></iframe>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No local address');
    const files = await browserOutputFixture();
    let native: Awaited<ReturnType<typeof openRepresentativeChrome>> | undefined;
    try {
      native = await openRepresentativeChrome(join(artifacts, 'native'));
      const selected = await native.target(`http://127.0.0.1:${address.port}/`);
      await selected.page.frameLocator('iframe').locator('input').waitFor();
      const control = new BrowserControl(Date.now, { collaborationV2: true });
      const client = new SelectedChromeClient({
        userId: 'usr_alice',
        taskId: 'tsk_alice',
        extensionClientId: selected.clientId,
        control,
        routingV2: true,
        collaborationV2: true,
        send: native.send,
      });
      let turn = 0;
      const metadata = { provider: 'anthropic', model: 'scripted-native-capture-fixture' } as const;
      const adapter: MessagesAdapter = {
        metadata,
        async create(request) {
          expect(request.tools?.some((tool) => tool.name === 'browser_screenshot')).toBe(true);
          const tool =
            turn++ === 0
              ? { name: 'browser_screenshot', input: {} }
              : {
                  name: 'browser_finish',
                  input: { summary: '已截图，未提交', evidenceText: 'Ready' },
                };
          return {
            id: `r${turn}`,
            metadata,
            content: [{ type: 'tool_use', id: `t${turn}`, ...tool }],
            stopReason: 'tool_use',
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadInputTokens: null,
              cacheCreationInputTokens: null,
              complete: true,
            },
          };
        },
      };
      const store = vi.fn(
        async (input: { filename: string; buffer: Buffer; sha256: string; mimetype: string }) => {
          const row = await files.service.storeOutput({
            userIdInternal: 7,
            userExternalId: 'usr_alice',
            taskIdInternal: 9,
            filename: input.filename,
            mimetype: input.mimetype,
            buffer: input.buffer,
          });
          return {
            fileId: row.externalId,
            filename: row.filename,
            sizeBytes: row.sizeBytes,
            sha256: input.sha256,
            mimetype: row.mimetype,
            expiresAt: row.expiresAt!.toISOString(),
            downloadUrl: `/api/files/${row.externalId}/download`,
          };
        },
      );
      const outcome = await runSelectedChromeTask({
        taskId: 'tsk_alice',
        intent: '截图，不提交',
        client,
        control,
        target: selected.target,
        messagesAdapter: adapter,
        onBrowserScreenshot: store,
        maxIterations: 3,
        timeoutMs: 60000,
      });
      await writeFile(join(artifacts, 'outcome.json'), JSON.stringify(outcome, null, 2));
      expect(outcome.status).toBe('completed');
      expect(store).toHaveBeenCalledOnce();
      const row = files.records[0]!;
      expect(row).toMatchObject({ userId: 7, taskId: 9, kind: 'output', mimetype: 'image/jpeg' });
      const saved = await files.service.loadForUser(String(row.externalId), 7);
      expect(saved).not.toBeNull();
      expect(await files.service.loadForUser(String(row.externalId), 8)).toBeNull();
      expect(createHash('sha256').update(saved!.buffer).digest('hex')).toBe(
        store.mock.calls[0]![0].sha256,
      );
      await writeFile(join(artifacts, 'delivered.jpg'), saved!.buffer);
      const samples = await native.userPage.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return [
          [60, 45],
          [100, 120],
          [400, 120],
          [100, 200],
          [400, 200],
          [120, 280],
        ].map(([x, y]) => Array.from(ctx.getImageData(x!, y!, 1, 1).data));
      }, saved!.buffer.toString('base64'));
      expect(samples[0]![1]).toBeGreaterThan(200);
      for (const sample of samples.slice(1))
        expect(Math.max(...sample.slice(0, 3))).toBeLessThan(15);
      const focus = await native.normalFocus();
      expect(focus.preserved).toBe(true);
      expect(await native.userPage.locator('#query').inputValue()).toBe(
        'ordinary user input preserved',
      );
      await writeFile(
        join(artifacts, 'verification.json'),
        JSON.stringify(
          {
            samples,
            focus,
            fileId: row.externalId,
            size: saved!.buffer.length,
            sameOwnerReadable: true,
            otherOwnerReadable: false,
            actualFileService: true,
            db: 'in-memory predicate fixture',
            model: metadata,
            externalModelCalls: 0,
          },
          null,
          2,
        ),
      );
    } finally {
      await native?.close();
      await rm(files.root, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  150000,
);
