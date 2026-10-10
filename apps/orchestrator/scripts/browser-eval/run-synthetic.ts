import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreSyntheticSuite } from './score.js';

/** Real local Chromium + deterministic fixture calls. Zero online model requests. */
export async function runLocalSynthetic() {
  const index = process.argv.indexOf('--out');
  const output = resolve(
    index >= 0 ? process.argv[index + 1]! : 'scripts/browser-eval/results/pr4-synthetic.json',
  );
  await mkdir(dirname(output), { recursive: true });
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const suite = JSON.parse(await readFile(new URL('./tasks.json', import.meta.url), 'utf8')) as {
    syntheticCases: Array<{ id: string; category: string; name: string }>;
  };
  const raw = output + '.vitest.json';
  const log = output + '.log';
  // No inherited provider credentials, dotenv files, or parallel browser workers.
  const runtimeEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: 'test',
    NODE_OPTIONS: '--max-old-space-size=1536',
    UV_THREADPOOL_SIZE: '1',
    GOMAXPROCS: '1',
  };
  const files = [
    'src/agent/browser-tools/browser-observation-v2.test.ts',
    'src/agent/browser-tools/browser-replay.test.ts',
    'src/agent/browser-tools/browser-observation-runner.test.ts',
    'src/trpc/routers/browser-replay.test.ts',
  ];
  let transcript = '';
  const exit = await new Promise<number>((done) => {
    const child = spawn(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        ...files,
        '--poolOptions.threads.maxThreads=1',
        '--poolOptions.threads.minThreads=1',
        '--reporter=json',
        `--outputFile=${raw}`,
      ],
      { cwd, env: runtimeEnv, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.on('data', (chunk) => {
      transcript += chunk;
    });
    child.stderr.on('data', (chunk) => {
      transcript += chunk;
    });
    child.on('error', () => done(1));
    child.on('close', (code) => done(code ?? 1));
  });
  await writeFile(log, transcript, { mode: 0o600 });
  const report = JSON.parse(await readFile(raw, 'utf8').catch(() => '{}')) as {
    testResults?: Array<{ assertionResults: Array<{ title: string; status: string }> }>;
  };
  const assertions = report.testResults?.flatMap((t) => t.assertionResults) ?? [];
  const results = suite.syntheticCases.map((test) => {
    const result = assertions.find((a) => a.title === test.name);
    return {
      id: test.id,
      category: test.category,
      status:
        result?.status === 'passed'
          ? ('passed' as const)
          : result?.status === 'failed'
            ? ('failed' as const)
            : ('unsupported' as const),
    };
  });
  const summary = scoreSyntheticSuite(suite.syntheticCases, results);
  await writeFile(
    output,
    JSON.stringify(
      { evidence: 'local-synthetic-real-chromium', modelCalls: 0, ...summary, cases: results },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(summary));
  if (exit || summary.failed || summary.unsupported) process.exitCode = 1;
}
