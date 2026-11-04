/** Optional explicit local connection; importing this module starts nothing. */
import { stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  type StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { OrangeBenchTaskClient } from './client.js';
import { ClientError, type OrangeBenchRPC, safeError } from './contracts.js';

export interface LocalConnectionConfig {
  enabled: boolean;
  taskId: string;
  pythonExecutable: string;
  serverRoot: string;
  apiUrl: string;
  apiKey: string;
  journalDirectory: string;
  allowLoopbackForTests?: boolean;
}
export function stdioParameters(config: LocalConnectionConfig): StdioServerParameters {
  let url: URL;
  try {
    url = new URL(config.apiUrl);
  } catch {
    throw new ClientError('orangebench_configuration_invalid');
  }
  const production =
    url.protocol === 'https:' &&
    url.hostname === 'orangebench.ai' &&
    (!url.port || url.port === '443') &&
    url.pathname === '/api/v1';
  const fixture =
    config.allowLoopbackForTests === true &&
    process.env.NODE_ENV === 'test' &&
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
    url.pathname === '/v1';
  if (
    !config.enabled ||
    (!production && !fixture) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^obk_[a-f0-9]{32}_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(config.apiKey) ||
    ![config.pythonExecutable, config.serverRoot, config.journalDirectory].every(
      (p) => isAbsolute(p) && !p.includes(config.apiKey),
    ) ||
    !/^python(?:\d+(?:\.\d+)*)?$/.test(basename(config.pythonExecutable))
  )
    throw new ClientError('orangebench_configuration_invalid');
  return {
    command: config.pythonExecutable,
    args: ['-m', 'orangebench_mcp.server'],
    cwd: config.serverRoot,
    env: {
      PATH: '/usr/bin:/bin',
      PYTHONPATH: join(config.serverRoot, 'src'),
      PYTHONUNBUFFERED: '1',
      ORANGEBENCH_API_KEY: config.apiKey,
      ORANGEBENCH_API_URL: config.apiUrl,
    },
    stderr: 'pipe',
    maxBufferSize: 2 * 1024 * 1024,
  };
}
async function verifyPaths(config: LocalConnectionConfig): Promise<void> {
  const interpreter = await stat(config.pythonExecutable);
  const module = await stat(join(config.serverRoot, 'src/orangebench_mcp/server.py'));
  const owners = [0, process.getuid?.()];
  if (
    !interpreter.isFile() ||
    !module.isFile() ||
    !owners.includes(interpreter.uid) ||
    !owners.includes(module.uid) ||
    (interpreter.mode & 0o111) === 0 ||
    (interpreter.mode & 0o022) !== 0 ||
    (module.mode & 0o022) !== 0
  )
    throw new ClientError('orangebench_configuration_invalid');
}
async function connect(config: LocalConnectionConfig): Promise<OrangeBenchRPC> {
  const parameters = stdioParameters(config);
  await verifyPaths(config);
  const transport = new StdioClientTransport(parameters);
  const client = new Client(
    { name: 'HOLA DAY OrangeBench client', version: '0.1.0' },
    { capabilities: {} },
  );
  let stderrBytes = 0;
  transport.stderr?.on('data', (chunk: Buffer) => {
    // Do not retain/forward stderr, which can contain private arguments.
    stderrBytes += chunk.length;
    if (stderrBytes > 65536) void client.close().catch(() => {});
  });
  try {
    await client.connect(transport, { timeout: 10000 });
  } catch (error) {
    await client.close().catch(() => {});
    throw new ClientError(safeError(error));
  }
  return {
    listTools: () => client.listTools({}, { timeout: 20000 }),
    readResource: (args) => client.readResource(args, { timeout: 20000 }),
    callTool: (args, signal) => client.callTool(args, undefined, { timeout: 20000, signal }),
    close: () => client.close(),
  };
}
export async function loadOrangeBenchClient(
  config: LocalConnectionConfig,
): Promise<OrangeBenchTaskClient | null> {
  if (!config.enabled) return null;
  let rpc: OrangeBenchRPC | undefined;
  try {
    rpc = await connect(config);
    return await OrangeBenchTaskClient.open({
      taskId: config.taskId,
      rpc,
      journalDirectory: config.journalDirectory,
    });
  } catch (error) {
    await rpc?.close().catch(() => {});
    throw new ClientError(safeError(error));
  }
}
export function loadOrangeBenchFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  taskId: string,
  journalDirectory: string,
): Promise<OrangeBenchTaskClient | null> {
  if (env.HOLA_ORANGEBENCH_MCP_ENABLED !== 'true') return Promise.resolve(null);
  return loadOrangeBenchClient({
    enabled: true,
    taskId,
    journalDirectory,
    pythonExecutable: env.ORANGEBENCH_MCP_PYTHON ?? '',
    serverRoot: env.ORANGEBENCH_MCP_ROOT ?? '',
    apiUrl: env.ORANGEBENCH_API_URL ?? 'https://orangebench.ai/api/v1',
    apiKey: env.ORANGEBENCH_API_KEY ?? '',
  });
}
