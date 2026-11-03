#!/usr/bin/env node
// Starts the built server the way it ships and checks what no unit test covers: exit codes,
// the HTTP transport end to end, the runtime package.json read, and a clean SIGTERM.
//
//   node scripts/smoke.mjs dist             # node dist/index.js (after npm run build)
//   node scripts/smoke.mjs docker <image>   # docker run <image>
//
// The arr URLs point at 127.0.0.1:9 (discard), so no real Sonarr/Radarr/Prowlarr/Overseerr is
// ever contacted: tools/list never calls them.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';

const EXPECTED_TOOLS = 92;
const [mode, image] = process.argv.slice(2);
if (mode !== 'dist' && !(mode === 'docker' && image)) {
  console.error('usage: smoke.mjs dist | smoke.mjs docker <image>');
  process.exit(64);
}

const products = Object.fromEntries(
  // SEERR is the Overseerr module's preferred prefix; OVERSEERR_* is covered by test/config.test.ts.
  ['SONARR', 'RADARR', 'PROWLARR', 'SEERR'].flatMap((p) => [
    [`${p}_URL`, 'http://127.0.0.1:9'],
    [`${p}_API_KEY`, 'x'],
  ]),
);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Starts the server with exactly `env` (plus PATH/HOME for dist mode). */
function start(env, port) {
  if (mode === 'dist') {
    const child = spawn(process.execPath, ['dist/index.js'], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SERVARR_MCP_PORT: '3000',
        ...env,
        ...(port && { SERVARR_MCP_PORT: String(port) }),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return { child, stop: () => child.kill('SIGTERM') };
  }
  const name = `servarr-mcp-smoke-${randomBytes(4).toString('hex')}`;
  const args = ['run', '--rm', '--name', name];
  if (port) args.push('-p', `127.0.0.1:${port}:3000`);
  for (const [key, value] of Object.entries(env)) args.push('-e', `${key}=${value}`);
  args.push(image);
  const child = spawn('docker', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return { child, stop: () => spawn('docker', ['stop', '-t', '10', name], { stdio: 'ignore' }) };
}

function exitCode(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no exit within ${timeoutMs} ms`)), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

class CheckFailed extends Error {}

// Throws rather than exiting, so the finally blocks below still stop a running container.
async function check(label, fn) {
  try {
    await fn();
    console.log(`ok   ${label}`);
  } catch (error) {
    console.log(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`);
    throw new CheckFailed(label);
  }
}

/** Runs a server that should exit by itself, stopping it if it doesn't. */
async function expectExit(env, expected) {
  const { child, stop } = start(env);
  try {
    expectEqual(await exitCode(child, startupTimeoutMs), expected, 'exit code');
  } finally {
    if (child.exitCode === null) stop();
  }
}

function expectEqual(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

const startupTimeoutMs = mode === 'docker' ? 30_000 : 10_000;

async function main() {
  await check('exits 2 when no product is configured', () => expectExit({}, 2));

  await check('exits 2 for the http transport without a token', () =>
    expectExit({ ...products, SERVARR_MCP_TRANSPORT: 'http' }, 2),
  );

  const token = randomBytes(20).toString('hex');
  const port = await freePort();
  const server = start(
    { ...products, SERVARR_MCP_TRANSPORT: 'http', SERVARR_MCP_TOKEN: token },
    port,
  );
  let stderr = '';
  server.child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = exitCode(server.child, 120_000);
  exited.catch(() => {});
  const base = `http://127.0.0.1:${port}`;

  try {
    await check('serves /healthz', async () => {
      const deadline = Date.now() + startupTimeoutMs;
      for (;;) {
        try {
          const response = await fetch(`${base}/healthz`);
          if ((await response.text()) === 'ok') return;
        } catch {
          // not listening yet
        }
        if (Date.now() > deadline)
          throw new Error(`no ok from /healthz within ${startupTimeoutMs} ms\n${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    });

    const listTools = (headers) =>
      fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });

    await check('answers /mcp without a token with 401', async () => {
      expectEqual((await listTools({})).status, 401, 'status');
    });

    await check(`lists ${EXPECTED_TOOLS} tools with the token`, async () => {
      const response = await listTools({ Authorization: `Bearer ${token}` });
      expectEqual(response.status, 200, 'status');
      const text = await response.text();
      const json = (response.headers.get('content-type') ?? '').includes('text/event-stream')
        ? text
            .split('\n')
            .find((line) => line.startsWith('data:'))
            ?.slice(5)
        : text;
      const tools = JSON.parse(json ?? 'null')?.result?.tools;
      if (!Array.isArray(tools)) throw new Error(`no result.tools in ${text.slice(0, 300)}`);
      expectEqual(tools.length, EXPECTED_TOOLS, 'tool count');
    });

    await check('exits 0 within 6 s of SIGTERM', async () => {
      const stoppedAt = Date.now();
      server.stop();
      const code = await exited;
      expectEqual(code, 0, 'exit code');
      const took = Date.now() - stoppedAt;
      if (took > 6_000) throw new Error(`took ${took} ms`);
    });
  } finally {
    if (server.child.exitCode === null) server.stop();
  }
}

try {
  await main();
} catch (error) {
  if (!(error instanceof CheckFailed)) console.error(error);
  process.exitCode = 1;
}
