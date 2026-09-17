# servarr-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that exposes Sonarr, Radarr, and Prowlarr to an LLM client over both stdio and authenticated HTTP.

**Architecture:** One npm package. A shared `fetch`-based HTTP client handles auth headers and error mapping for all three products. Each product gets an isolated module (`types.ts`, `client.ts`, `shape.ts`, `tools.ts`) that depends only on the shared HTTP layer. An MCP layer registers whichever products are configured and serves them over stdio, HTTP, or both.

**Tech Stack:** TypeScript 5 (strict, ESM), Node 20+, `@modelcontextprotocol/sdk` ^1.30.0, `zod` ^4.6.5, `express` ^5, `vitest` ^4.1.11, `msw` ^2.15.0, ESLint, Prettier.

> vitest is pinned to the 4.x line deliberately: vitest 5 requires Node
> `^22.12 || ^24 || >=26` and peers on `@types/node` >= 22, both of which
> conflict with this project's Node 20 floor. vitest 4.1.11 supports
> `^20 || ^22 || >=24`. Do not install with `--legacy-peer-deps`.

**Spec:** `docs/superpowers/specs/2026-09-17-servarr-mcp-design.md`

## Global Constraints

- **Node:** >= 20. `package.json` sets `"engines": { "node": ">=20" }`.
- **Module system:** ESM only. `"type": "module"` in `package.json`. All relative imports in `src/` and `test/` carry an explicit `.js` extension (e.g. `import { loadConfig } from './config.js'`) — this is required by Node's ESM resolver even though the source files are `.ts`.
- **TypeScript:** `strict: true`. No `any` in committed code; use `unknown` and narrow.
- **API versions:** Sonarr and Radarr use `/api/v3`. Prowlarr uses `/api/v1`. These are the *API* versions and do not change with the app version.
- **Auth header:** all three products authenticate with the `X-Api-Key` header.
- **Tool naming:** `<product>_<snake_case_action>`, e.g. `sonarr_list_series`. Never camelCase.
- **Secrets:** API keys and the bearer token must never appear in an error message, log line, or tool response.
- **Commits:** Conventional Commits (`feat:`, `test:`, `chore:`, `docs:`). Commit at the end of every task.
- **Test command:** `npm test` runs `vitest run`. Every task must leave it green.

---

### Task 1: Project scaffolding and configuration

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `.env.example`
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  ```ts
  export interface InstanceConfig { baseUrl: string; apiKey: string }
  export type TransportMode = 'stdio' | 'http' | 'both'
  export interface ServarrConfig {
    sonarr?: InstanceConfig
    radarr?: InstanceConfig
    prowlarr?: InstanceConfig
    transport: TransportMode
    port: number
    token?: string
  }
  export class ConfigError extends Error {}
  export function loadConfig(env?: NodeJS.ProcessEnv): ServarrConfig
  ```

- [ ] **Step 1: Initialise the package**

```bash
cd /home/jfms7s/git/servarr-mcp
npm init -y
npm pkg set name="servarr-mcp" version="0.1.0" type="module" license="MIT"
npm pkg set description="MCP server for Sonarr, Radarr and Prowlarr"
npm pkg set engines.node=">=20"
npm pkg set main="dist/index.js"
npm pkg set bin.servarr-mcp="dist/index.js"
npm pkg set scripts.build="tsc"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.lint="eslint src test"
npm pkg set scripts.typecheck="tsc --noEmit"
npm install @modelcontextprotocol/sdk@^1.30.0 zod@^4.6.5 express@^5
npm install -D typescript@^5 vitest@^4.1.11 msw@^2.15.0 @types/node@^20 \
  eslint@^9 typescript-eslint@^8 prettier@^3 @types/express@^5
```

Install without `--legacy-peer-deps`; these versions resolve cleanly. Do not
add `vite` as a direct dependency — vitest pulls it in transitively.

- [ ] **Step 2: Write the config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

`eslint.config.js`:

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  { ignores: ['dist/**'] },
);
```

`.prettierrc`:

```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```

`.gitignore`:

```
node_modules/
dist/
.env
*.log
```

`.env.example`:

```
SONARR_URL=http://localhost:8989
SONARR_API_KEY=
RADARR_URL=http://localhost:7878
RADARR_API_KEY=
PROWLARR_URL=http://localhost:9696
PROWLARR_API_KEY=
SERVARR_MCP_TRANSPORT=stdio
SERVARR_MCP_PORT=3000
SERVARR_MCP_TOKEN=
```

- [ ] **Step 3: Write the failing config tests**

`test/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const base = {
  SONARR_URL: 'http://localhost:8989',
  SONARR_API_KEY: 'sonarr-key',
};

describe('loadConfig', () => {
  it('enables a product when both url and key are present', () => {
    const config = loadConfig({ ...base });
    expect(config.sonarr).toEqual({ baseUrl: 'http://localhost:8989', apiKey: 'sonarr-key' });
    expect(config.radarr).toBeUndefined();
    expect(config.prowlarr).toBeUndefined();
  });

  it('strips a trailing slash from the base url', () => {
    const config = loadConfig({ ...base, SONARR_URL: 'http://localhost:8989/' });
    expect(config.sonarr?.baseUrl).toBe('http://localhost:8989');
  });

  it('throws when a product has a url but no key', () => {
    expect(() => loadConfig({ SONARR_URL: 'http://localhost:8989' })).toThrow(ConfigError);
  });

  it('throws when a product has a key but no url', () => {
    expect(() => loadConfig({ SONARR_API_KEY: 'k' })).toThrow(ConfigError);
  });

  it('throws when no product is configured at all', () => {
    expect(() => loadConfig({})).toThrow(/at least one/i);
  });

  it('throws when the url is not parseable', () => {
    expect(() => loadConfig({ SONARR_URL: 'not a url', SONARR_API_KEY: 'k' })).toThrow(ConfigError);
  });

  it('defaults to stdio transport on port 3000', () => {
    const config = loadConfig({ ...base });
    expect(config.transport).toBe('stdio');
    expect(config.port).toBe(3000);
  });

  it('rejects an unknown transport', () => {
    expect(() => loadConfig({ ...base, SERVARR_MCP_TRANSPORT: 'carrier-pigeon' })).toThrow(
      ConfigError,
    );
  });

  it('requires a token when the http transport is enabled', () => {
    expect(() => loadConfig({ ...base, SERVARR_MCP_TRANSPORT: 'http' })).toThrow(/token/i);
    expect(() => loadConfig({ ...base, SERVARR_MCP_TRANSPORT: 'both' })).toThrow(/token/i);
  });

  it('accepts the http transport when a token is set', () => {
    const config = loadConfig({
      ...base,
      SERVARR_MCP_TRANSPORT: 'http',
      SERVARR_MCP_TOKEN: 'secret',
      SERVARR_MCP_PORT: '8080',
    });
    expect(config.transport).toBe('http');
    expect(config.token).toBe('secret');
    expect(config.port).toBe(8080);
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadConfig({ ...base, SERVARR_MCP_PORT: 'eighty' })).toThrow(ConfigError);
  });

  it('loads all three products together', () => {
    const config = loadConfig({
      ...base,
      RADARR_URL: 'http://localhost:7878',
      RADARR_API_KEY: 'radarr-key',
      PROWLARR_URL: 'http://localhost:9696',
      PROWLARR_API_KEY: 'prowlarr-key',
    });
    expect(config.radarr?.apiKey).toBe('radarr-key');
    expect(config.prowlarr?.baseUrl).toBe('http://localhost:9696');
  });
});
```

- [ ] **Step 4: Run the tests and verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/config.js'`.

- [ ] **Step 5: Implement `src/config.ts`**

```ts
export interface InstanceConfig {
  baseUrl: string;
  apiKey: string;
}

export type TransportMode = 'stdio' | 'http' | 'both';

export interface ServarrConfig {
  sonarr?: InstanceConfig;
  radarr?: InstanceConfig;
  prowlarr?: InstanceConfig;
  transport: TransportMode;
  port: number;
  token?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const TRANSPORTS: readonly TransportMode[] = ['stdio', 'http', 'both'];

function readInstance(
  env: NodeJS.ProcessEnv,
  product: string,
  prefix: string,
): InstanceConfig | undefined {
  const rawUrl = env[`${prefix}_URL`]?.trim();
  const apiKey = env[`${prefix}_API_KEY`]?.trim();

  if (!rawUrl && !apiKey) return undefined;
  if (!rawUrl) throw new ConfigError(`${product}: ${prefix}_API_KEY is set but ${prefix}_URL is not`);
  if (!apiKey) throw new ConfigError(`${product}: ${prefix}_URL is set but ${prefix}_API_KEY is not`);

  try {
    new URL(rawUrl);
  } catch {
    throw new ConfigError(`${product}: ${prefix}_URL is not a valid URL: ${rawUrl}`);
  }

  return { baseUrl: rawUrl.replace(/\/+$/, ''), apiKey };
}

function readTransport(env: NodeJS.ProcessEnv): TransportMode {
  const raw = env.SERVARR_MCP_TRANSPORT?.trim();
  if (!raw) return 'stdio';
  if (!TRANSPORTS.includes(raw as TransportMode)) {
    throw new ConfigError(
      `SERVARR_MCP_TRANSPORT must be one of ${TRANSPORTS.join(', ')} (got: ${raw})`,
    );
  }
  return raw as TransportMode;
}

function readPort(env: NodeJS.ProcessEnv): number {
  const raw = env.SERVARR_MCP_PORT?.trim();
  if (!raw) return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`SERVARR_MCP_PORT must be an integer between 1 and 65535 (got: ${raw})`);
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServarrConfig {
  const sonarr = readInstance(env, 'Sonarr', 'SONARR');
  const radarr = readInstance(env, 'Radarr', 'RADARR');
  const prowlarr = readInstance(env, 'Prowlarr', 'PROWLARR');

  if (!sonarr && !radarr && !prowlarr) {
    throw new ConfigError(
      'No products configured. Set at least one of SONARR_URL/SONARR_API_KEY, ' +
        'RADARR_URL/RADARR_API_KEY, PROWLARR_URL/PROWLARR_API_KEY.',
    );
  }

  const transport = readTransport(env);
  const token = env.SERVARR_MCP_TOKEN?.trim() || undefined;

  if ((transport === 'http' || transport === 'both') && !token) {
    throw new ConfigError(
      `SERVARR_MCP_TOKEN is required when SERVARR_MCP_TRANSPORT is "${transport}"`,
    );
  }

  return { sonarr, radarr, prowlarr, transport, port: readPort(env), token };
}
```

- [ ] **Step 6: Run the tests and verify they pass**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold project and add environment configuration"
```

---

### Task 2: Shared HTTP client and error mapping

**Files:**
- Create: `src/http/errors.ts`, `src/http/client.ts`
- Test: `test/http/errors.test.ts`, `test/http/client.test.ts`

**Interfaces:**
- Consumes: `InstanceConfig` from `src/config.js`.
- Produces:
  ```ts
  // src/http/errors.ts
  export interface ArrApiErrorOptions {
    product: string; method: string; path: string; status?: number; detail: string;
  }
  export class ArrApiError extends Error {
    readonly product: string; readonly method: string; readonly path: string;
    readonly status?: number; readonly detail: string;
    constructor(options: ArrApiErrorOptions);
  }
  export function describeError(error: unknown): string

  // src/http/client.ts
  export type QueryValue = string | number | boolean | undefined | null | Array<string | number>
  export type QueryParams = Record<string, QueryValue>
  export interface ArrHttpClient {
    get<T>(path: string, query?: QueryParams): Promise<T>
    post<T>(path: string, body?: unknown, query?: QueryParams): Promise<T>
    put<T>(path: string, body?: unknown, query?: QueryParams): Promise<T>
    del<T>(path: string, query?: QueryParams): Promise<T>
  }
  export interface ArrClientOptions {
    product: string; baseUrl: string; apiKey: string; apiBase: string;
  }
  export function createArrClient(options: ArrClientOptions): ArrHttpClient
  ```

The method is named `del`, not `delete`, to avoid shadowing the reserved word at call sites.

- [ ] **Step 1: Write the failing error tests**

`test/http/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ArrApiError, describeError } from '../../src/http/errors.js';

describe('ArrApiError', () => {
  it('formats a message with status, method and path', () => {
    const error = new ArrApiError({
      product: 'Sonarr',
      method: 'GET',
      path: '/api/v3/series/42',
      status: 404,
      detail: 'series not found',
    });
    expect(error.message).toBe('Sonarr returned 404 for GET /api/v3/series/42: series not found');
    expect(error.name).toBe('ArrApiError');
    expect(error.status).toBe(404);
  });

  it('formats a message without a status as unreachable', () => {
    const error = new ArrApiError({
      product: 'Radarr',
      method: 'GET',
      path: '/api/v3/movie',
      detail: 'connect ECONNREFUSED 127.0.0.1:7878',
    });
    expect(error.message).toBe(
      'Cannot reach Radarr for GET /api/v3/movie: connect ECONNREFUSED 127.0.0.1:7878',
    );
  });
});

describe('describeError', () => {
  it('returns the message of an ArrApiError', () => {
    const error = new ArrApiError({
      product: 'Sonarr',
      method: 'GET',
      path: '/api/v3/health',
      status: 401,
      detail: 'Sonarr rejected the API key',
    });
    expect(describeError(error)).toBe(error.message);
  });

  it('returns the message of a plain Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error value', () => {
    expect(describeError('kaboom')).toBe('kaboom');
    expect(describeError(42)).toBe('42');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run test/http/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/http/errors.ts`**

```ts
export interface ArrApiErrorOptions {
  product: string;
  method: string;
  path: string;
  status?: number;
  detail: string;
}

export class ArrApiError extends Error {
  readonly product: string;
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  readonly detail: string;

  constructor(options: ArrApiErrorOptions) {
    const { product, method, path, status, detail } = options;
    const message =
      status === undefined
        ? `Cannot reach ${product} for ${method} ${path}: ${detail}`
        : `${product} returned ${status} for ${method} ${path}: ${detail}`;
    super(message);
    this.name = 'ArrApiError';
    this.product = product;
    this.method = method;
    this.path = path;
    this.status = status;
    this.detail = detail;
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
```

- [ ] **Step 4: Write the failing client tests**

`test/http/client.test.ts`:

```ts
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createArrClient } from '../../src/http/client.js';
import { ArrApiError } from '../../src/http/errors.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = createArrClient({
  product: 'Sonarr',
  baseUrl: 'http://sonarr.test:8989',
  apiKey: 'test-key',
  apiBase: '/api/v3',
});

describe('createArrClient', () => {
  it('sends the api key header and resolves the path against the api base', async () => {
    let seenKey: string | null = null;
    server.use(
      http.get('http://sonarr.test:8989/api/v3/series', ({ request }) => {
        seenKey = request.headers.get('X-Api-Key');
        return HttpResponse.json([{ id: 1 }]);
      }),
    );

    await expect(client.get('/series')).resolves.toEqual([{ id: 1 }]);
    expect(seenKey).toBe('test-key');
  });

  it('serialises query parameters and drops undefined and null values', async () => {
    let url: URL | undefined;
    server.use(
      http.get('http://sonarr.test:8989/api/v3/episode', ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json([]);
      }),
    );

    await client.get('/episode', { seriesId: 5, monitored: true, season: undefined, tag: null });

    expect(url?.searchParams.get('seriesId')).toBe('5');
    expect(url?.searchParams.get('monitored')).toBe('true');
    expect(url?.searchParams.has('season')).toBe(false);
    expect(url?.searchParams.has('tag')).toBe(false);
  });

  it('repeats array query parameters', async () => {
    let url: URL | undefined;
    server.use(
      http.get('http://sonarr.test:8989/api/v3/queue', ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ records: [] });
      }),
    );

    await client.get('/queue', { status: ['queued', 'paused'] });

    expect(url?.searchParams.getAll('status')).toEqual(['queued', 'paused']);
  });

  it('posts a json body', async () => {
    let body: unknown;
    server.use(
      http.post('http://sonarr.test:8989/api/v3/series', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 7 }, { status: 201 });
      }),
    );

    await expect(client.post('/series', { title: 'Andor' })).resolves.toEqual({ id: 7 });
    expect(body).toEqual({ title: 'Andor' });
  });

  it('returns undefined for a 204 with no body', async () => {
    server.use(
      http.delete('http://sonarr.test:8989/api/v3/series/9', () => new HttpResponse(null, { status: 204 })),
    );

    await expect(client.del('/series/9')).resolves.toBeUndefined();
  });

  it('maps a 404 with a json message to an ArrApiError', async () => {
    server.use(
      http.get('http://sonarr.test:8989/api/v3/series/42', () =>
        HttpResponse.json({ message: 'series not found' }, { status: 404 }),
      ),
    );

    await expect(client.get('/series/42')).rejects.toThrow(
      'Sonarr returned 404 for GET /api/v3/series/42: series not found',
    );
  });

  it('flattens arr validation errors', async () => {
    server.use(
      http.post('http://sonarr.test:8989/api/v3/series', () =>
        HttpResponse.json(
          [
            { propertyName: 'rootFolderPath', errorMessage: 'is required' },
            { propertyName: 'qualityProfileId', errorMessage: 'must be greater than 0' },
          ],
          { status: 400 },
        ),
      ),
    );

    await expect(client.post('/series', {})).rejects.toThrow(
      'rootFolderPath is required; qualityProfileId must be greater than 0',
    );
  });

  it('gives a dedicated message for an auth failure and never echoes the key', async () => {
    server.use(
      http.get('http://sonarr.test:8989/api/v3/health', () => new HttpResponse(null, { status: 401 })),
    );

    const error = await client.get('/health').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArrApiError);
    expect((error as ArrApiError).message).toContain('rejected the API key');
    expect((error as ArrApiError).message).not.toContain('test-key');
  });

  it('truncates a long unparseable error body', async () => {
    server.use(
      http.get('http://sonarr.test:8989/api/v3/health', () =>
        new HttpResponse('x'.repeat(1000), { status: 500 }),
      ),
    );

    const error = (await client.get('/health').catch((e: unknown) => e)) as ArrApiError;
    expect(error.detail.length).toBeLessThanOrEqual(203);
    expect(error.detail.endsWith('...')).toBe(true);
  });

  it('wraps a network failure as an unreachable ArrApiError', async () => {
    server.use(http.get('http://sonarr.test:8989/api/v3/health', () => HttpResponse.error()));

    const error = (await client.get('/health').catch((e: unknown) => e)) as ArrApiError;
    expect(error).toBeInstanceOf(ArrApiError);
    expect(error.status).toBeUndefined();
    expect(error.message).toContain('Cannot reach Sonarr');
  });
});
```

- [ ] **Step 5: Run and verify failure**

Run: `npx vitest run test/http/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement `src/http/client.ts`**

```ts
import { ArrApiError } from './errors.js';

export type QueryValue = string | number | boolean | undefined | null | Array<string | number>;
export type QueryParams = Record<string, QueryValue>;

export interface ArrHttpClient {
  get<T>(path: string, query?: QueryParams): Promise<T>;
  post<T>(path: string, body?: unknown, query?: QueryParams): Promise<T>;
  put<T>(path: string, body?: unknown, query?: QueryParams): Promise<T>;
  del<T>(path: string, query?: QueryParams): Promise<T>;
}

export interface ArrClientOptions {
  product: string;
  baseUrl: string;
  apiKey: string;
  apiBase: string;
}

const MAX_DETAIL = 200;

function truncate(text: string): string {
  const clean = text.trim();
  return clean.length > MAX_DETAIL ? `${clean.slice(0, MAX_DETAIL)}...` : clean;
}

function buildQuery(query: QueryParams | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

interface ArrValidationFailure {
  propertyName?: string;
  errorMessage?: string;
}

function extractDetail(status: number, product: string, raw: string): string {
  if (status === 401 || status === 403) return `${product} rejected the API key`;
  if (!raw.trim()) return status >= 500 ? 'server error with no response body' : 'no response body';

  try {
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      const messages = (parsed as ArrValidationFailure[])
        .map((item) => [item.propertyName, item.errorMessage].filter(Boolean).join(' '))
        .filter((text) => text.length > 0);
      if (messages.length > 0) return truncate(messages.join('; '));
    }

    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const message = record.message ?? record.error ?? record.title;
      if (typeof message === 'string' && message.length > 0) return truncate(message);
    }
  } catch {
    // fall through to the raw body
  }

  return truncate(raw);
}

export function createArrClient(options: ArrClientOptions): ArrHttpClient {
  const { product, baseUrl, apiKey, apiBase } = options;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: QueryParams,
  ): Promise<T> {
    const apiPath = `${apiBase}${path}`;
    const url = `${baseUrl}${apiPath}${buildQuery(query)}`;

    const headers: Record<string, string> = { 'X-Api-Key': apiKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new ArrApiError({ product, method, path: apiPath, detail });
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw new ArrApiError({
        product,
        method,
        path: apiPath,
        status: response.status,
        detail: extractDetail(response.status, product, raw),
      });
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (!text.trim()) return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ArrApiError({
        product,
        method,
        path: apiPath,
        status: response.status,
        detail: `response was not valid JSON: ${truncate(text)}`,
      });
    }
  }

  return {
    get: (path, query) => request('GET', path, undefined, query),
    post: (path, body, query) => request('POST', path, body, query),
    put: (path, body, query) => request('PUT', path, body, query),
    del: (path, query) => request('DELETE', path, undefined, query),
  };
}
```

- [ ] **Step 7: Run all tests**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add shared arr http client with error mapping"
```

---

### Task 3: MCP tool definitions and server registration

**Files:**
- Create: `src/mcp/types.ts`, `src/mcp/server.ts`
- Test: `test/mcp/server.test.ts`

**Interfaces:**
- Consumes: `describeError` from `src/http/errors.js`.
- Produces:
  ```ts
  // src/mcp/types.ts
  import type { ZodRawShape, z } from 'zod'
  export interface ToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
    name: string
    description: string
    inputSchema: Shape
    handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>
  }
  export function defineTool<Shape extends ZodRawShape>(
    definition: ToolDefinition<Shape>,
  ): ToolDefinition

  // src/mcp/server.ts
  export function createServer(tools: ToolDefinition[]): McpServer
  export function toolResult(value: unknown): { content: Array<{ type: 'text'; text: string }> }
  ```

`defineTool` exists purely so each product module gets argument-type inference at the definition site while still producing a uniformly-typed `ToolDefinition` for the registry.

- [ ] **Step 1: Write the failing tests**

`test/mcp/server.test.ts`:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArrApiError } from '../../src/http/errors.js';
import { createServer } from '../../src/mcp/server.js';
import { defineTool } from '../../src/mcp/types.js';

async function connect(tools: Parameters<typeof createServer>[0]) {
  const server = createServer(tools);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

const echoTool = defineTool({
  name: 'sonarr_echo',
  description: 'Echo a series id back',
  inputSchema: { seriesId: z.number().int().describe('Series id') },
  handler: async ({ seriesId }) => ({ seriesId }),
});

describe('createServer', () => {
  it('lists registered tools with their descriptions', async () => {
    const client = await connect([echoTool]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['sonarr_echo']);
    expect(tools[0]?.description).toBe('Echo a series id back');
  });

  it('returns the handler result as pretty-printed json text', async () => {
    const client = await connect([echoTool]);
    const result = await client.callTool({ name: 'sonarr_echo', arguments: { seriesId: 3 } });
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ seriesId: 3 }, null, 2) }]);
    expect(result.isError).toBeFalsy();
  });

  it('reports an undefined result as a success message', async () => {
    const client = await connect([
      defineTool({
        name: 'sonarr_void',
        description: 'Returns nothing',
        inputSchema: {},
        handler: async () => undefined,
      }),
    ]);
    const result = await client.callTool({ name: 'sonarr_void', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: 'Success.' }]);
  });

  it('converts a thrown ArrApiError into a tool error rather than a transport failure', async () => {
    const client = await connect([
      defineTool({
        name: 'sonarr_boom',
        description: 'Always fails',
        inputSchema: {},
        handler: async () => {
          throw new ArrApiError({
            product: 'Sonarr',
            method: 'GET',
            path: '/api/v3/series/1',
            status: 404,
            detail: 'series not found',
          });
        },
      }),
    ]);

    const result = await client.callTool({ name: 'sonarr_boom', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'Sonarr returned 404 for GET /api/v3/series/1: series not found' },
    ]);
  });

  it('rejects arguments that do not match the input schema', async () => {
    const client = await connect([echoTool]);
    const result = await client.callTool({ name: 'sonarr_echo', arguments: { seriesId: 'three' } });
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run test/mcp/server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/mcp/types.ts`**

```ts
import type { z, ZodRawShape } from 'zod';

export interface ToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>;
}

export function defineTool<Shape extends ZodRawShape>(
  definition: ToolDefinition<Shape>,
): ToolDefinition {
  return definition as unknown as ToolDefinition;
}
```

- [ ] **Step 4: Implement `src/mcp/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describeError } from '../http/errors.js';
import type { ToolDefinition } from './types.js';

export function toolResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  const text = value === undefined ? 'Success.' : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function createServer(tools: ToolDefinition[]): McpServer {
  const server = new McpServer({ name: 'servarr-mcp', version: '0.1.0' });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        try {
          return toolResult(await tool.handler(args));
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: describeError(error) }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}
```

If the installed SDK's `registerTool` signature differs from the above, check
`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` and adapt the
call — the surrounding contract (`createServer(tools): McpServer`) must not change.

- [ ] **Step 5: Run and verify the tests pass**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add mcp tool definition contract and server registration"
```

---

### Task 4: Transports and bearer authentication

**Files:**
- Create: `src/mcp/auth.ts`, `src/mcp/transport.ts`
- Test: `test/mcp/auth.test.ts`

**Interfaces:**
- Consumes: `createServer` from `src/mcp/server.js`.
- Produces:
  ```ts
  // src/mcp/auth.ts
  export function isAuthorized(authHeader: string | undefined, expected: string): boolean
  export function bearerAuth(expected: string): RequestHandler

  // src/mcp/transport.ts
  export async function startStdio(server: McpServer): Promise<void>
  export interface HttpHandle { close(): Promise<void> }
  export async function startHttp(
    createMcpServer: () => McpServer,
    options: { port: number; token: string },
  ): Promise<HttpHandle>
  ```

`startHttp` takes a **factory**, not a server instance. The SDK's stateless
`StreamableHTTPServerTransport` throws `Stateless transport cannot be reused
across requests` on its second request, and `Server.connect` overwrites the
server's single `_transport` (clearing it to `undefined` on close), so one
shared server plus one shared transport serves exactly one request per
process. Each request gets its own server and transport, both closed when the
response closes.

`isAuthorized` must compare in constant time via `node:crypto`'s `timingSafeEqual`, guarding against the length mismatch that makes `timingSafeEqual` throw.

- [ ] **Step 1: Write the failing auth tests**

`test/mcp/auth.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { bearerAuth, isAuthorized } from '../../src/mcp/auth.js';

describe('isAuthorized', () => {
  it('accepts the exact bearer token', () => {
    expect(isAuthorized('Bearer s3cret', 's3cret')).toBe(true);
  });

  it('rejects a wrong token of the same length', () => {
    expect(isAuthorized('Bearer s3cres', 's3cret')).toBe(false);
  });

  it('rejects a token of a different length without throwing', () => {
    expect(isAuthorized('Bearer short', 'a-much-longer-secret')).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(isAuthorized(undefined, 's3cret')).toBe(false);
  });

  it('rejects a header without the Bearer scheme', () => {
    expect(isAuthorized('s3cret', 's3cret')).toBe(false);
    expect(isAuthorized('Basic s3cret', 's3cret')).toBe(false);
  });

  it('accepts a case-insensitive scheme', () => {
    expect(isAuthorized('bearer s3cret', 's3cret')).toBe(true);
  });
});

describe('bearerAuth', () => {
  function invoke(header: string | undefined) {
    const middleware = bearerAuth('s3cret');
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const next = vi.fn();
    middleware({ headers: { authorization: header } } as never, { status } as never, next);
    return { status, json, next };
  }

  it('calls next for a valid token', () => {
    const { next, status } = invoke('Bearer s3cret');
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('responds 401 for an invalid token and does not call next', () => {
    const { next, status, json } = invoke('Bearer wrong');
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalled();
  });

  it('never includes the expected token in the response body', () => {
    const { json } = invoke(undefined);
    expect(JSON.stringify(json.mock.calls)).not.toContain('s3cret');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run test/mcp/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/mcp/auth.ts`**

```ts
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function isAuthorized(authHeader: string | undefined, expected: string): boolean {
  if (!authHeader) return false;

  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match?.[1]) return false;

  const provided = Buffer.from(match[1]);
  const reference = Buffer.from(expected);
  if (provided.length !== reference.length) return false;

  return timingSafeEqual(provided, reference);
}

export function bearerAuth(expected: string): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (isAuthorized(request.headers.authorization, expected)) {
      next();
      return;
    }
    response.status(401).json({ error: 'unauthorized' });
  };
}
```

- [ ] **Step 4: Implement `src/mcp/transport.ts`**

```ts
import express from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { bearerAuth } from './auth.js';

export async function startStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}

export interface HttpHandle {
  close(): Promise<void>;
}

export async function startHttp(
  createMcpServer: () => McpServer,
  options: { port: number; token: string },
): Promise<HttpHandle> {
  const app = express();

  app.all('/mcp', bearerAuth(options.token), express.json(), (request, response) => {
    void (async () => {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    })().catch(() => {
      if (!response.headersSent) response.status(500).json({ error: 'internal error' });
    });
  });

  const listener = app.listen(options.port);
  await new Promise<void>((resolve, reject) => {
    listener.once('listening', resolve);
    listener.once('error', reject);
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        listener.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
```

`express` and the transport classes ship inside `@modelcontextprotocol/sdk`'s
dependency tree, so no extra runtime dependency is needed. If
`StreamableHTTPServerTransport`'s constructor options differ in the installed
version, check
`node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts`
and adapt — keep the exported `startHttp` signature unchanged.

- [ ] **Step 5: Run the tests**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add stdio and authenticated http transports"
```

---

### Task 5: Sonarr types and client

**Files:**
- Create: `src/sonarr/types.ts`, `src/sonarr/client.ts`
- Test: `test/sonarr/client.test.ts`

**Interfaces:**
- Consumes: `createArrClient`, `QueryParams` from `src/http/client.js`; `InstanceConfig` from `src/config.js`.
- Produces: `SonarrClient` and `createSonarrClient(config: InstanceConfig): SonarrClient`, plus all types below.

All paths are relative to the `/api/v3` base, which `createArrClient` prepends.

| Method | HTTP | Path | Query / body |
| --- | --- | --- | --- |
| `listSeries()` | GET | `/series` | — |
| `getSeries(id)` | GET | `/series/{id}` | — |
| `lookupSeries(term)` | GET | `/series/lookup` | `term` |
| `addSeries(payload)` | POST | `/series` | body = `AddSeriesPayload` |
| `updateSeries(id, payload)` | PUT | `/series/{id}` | body = `Series` |
| `deleteSeries(id, opts)` | DELETE | `/series/{id}` | `deleteFiles`, `addImportListExclusion` |
| `listEpisodes(seriesId, seasonNumber?)` | GET | `/episode` | `seriesId`, `seasonNumber` |
| `getEpisode(id)` | GET | `/episode/{id}` | — |
| `monitorEpisodes(episodeIds, monitored)` | PUT | `/episode/monitor` | body = `{ episodeIds, monitored }` |
| `listEpisodeFiles(seriesId)` | GET | `/episodefile` | `seriesId` |
| `deleteEpisodeFile(id)` | DELETE | `/episodefile/{id}` | — |
| `getCalendar(opts)` | GET | `/calendar` | `start`, `end`, `includeSeries` |
| `getQueue(opts)` | GET | `/queue` | `page`, `pageSize`, `includeSeries`, `includeEpisode` |
| `deleteQueueItem(id, opts)` | DELETE | `/queue/{id}` | `removeFromClient`, `blocklist` |
| `getHistory(opts)` | GET | `/history` | `page`, `pageSize`, `eventType` |
| `getWantedMissing(opts)` | GET | `/wanted/missing` | `page`, `pageSize`, `includeSeries` |
| `getBlocklist(opts)` | GET | `/blocklist` | `page`, `pageSize` |
| `deleteBlocklistItem(id)` | DELETE | `/blocklist/{id}` | — |
| `runCommand(payload)` | POST | `/command` | body = `CommandPayload` |
| `getCommand(id)` | GET | `/command/{id}` | — |
| `listQualityProfiles()` | GET | `/qualityprofile` | — |
| `listRootFolders()` | GET | `/rootfolder` | — |
| `listTags()` | GET | `/tag` | — |
| `getSystemStatus()` | GET | `/system/status` | — |
| `getHealth()` | GET | `/health` | — |
| `getDiskSpace()` | GET | `/diskspace` | — |

- [ ] **Step 1: Write `src/sonarr/types.ts`**

Types cover only the fields the tools use; arr responses carry many more and
extra fields are simply ignored.

```ts
export interface PagedResponse<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}

export interface Season {
  seasonNumber: number;
  monitored: boolean;
  statistics?: { episodeFileCount: number; episodeCount: number; percentOfEpisodes: number };
}

export interface Series {
  id: number;
  title: string;
  sortTitle?: string;
  status: string;
  overview?: string;
  network?: string;
  year: number;
  seasonCount?: number;
  monitored: boolean;
  qualityProfileId: number;
  rootFolderPath?: string;
  path?: string;
  tvdbId: number;
  imdbId?: string;
  tags: number[];
  seasons: Season[];
  statistics?: { episodeFileCount: number; episodeCount: number; sizeOnDisk: number };
  added?: string;
  ended?: boolean;
}

export interface AddSeriesPayload {
  title: string;
  tvdbId: number;
  qualityProfileId: number;
  rootFolderPath: string;
  monitored?: boolean;
  seasonFolder?: boolean;
  languageProfileId?: number;
  tags?: number[];
  seriesType?: string;
  addOptions?: { monitor?: string; searchForMissingEpisodes?: boolean };
}

export interface Episode {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDateUtc?: string;
  overview?: string;
  hasFile: boolean;
  monitored: boolean;
  episodeFileId?: number;
  series?: Series;
}

export interface EpisodeFile {
  id: number;
  seriesId: number;
  seasonNumber: number;
  relativePath: string;
  path: string;
  size: number;
  dateAdded: string;
  quality?: { quality: { id: number; name: string } };
}

export interface QueueRecord {
  id: number;
  seriesId?: number;
  episodeId?: number;
  title: string;
  status: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  errorMessage?: string;
  downloadClient?: string;
  indexer?: string;
  statusMessages?: Array<{ title?: string; messages: string[] }>;
}

export interface HistoryRecord {
  id: number;
  episodeId: number;
  seriesId: number;
  sourceTitle: string;
  eventType: string;
  date: string;
  data?: Record<string, string>;
}

export interface BlocklistRecord {
  id: number;
  seriesId: number;
  sourceTitle: string;
  date: string;
  protocol?: string;
  indexer?: string;
}

export interface CommandPayload {
  name: string;
  seriesId?: number;
  seriesIds?: number[];
  episodeIds?: number[];
  seasonNumber?: number;
}

export interface CommandResource {
  id: number;
  name: string;
  status: string;
  queued?: string;
  started?: string;
  ended?: string;
  message?: string;
}

export interface QualityProfile {
  id: number;
  name: string;
  upgradeAllowed: boolean;
  cutoff: number;
}

export interface RootFolder {
  id: number;
  path: string;
  accessible: boolean;
  freeSpace?: number;
}

export interface Tag {
  id: number;
  label: string;
}

export interface SystemStatus {
  appName: string;
  version: string;
  buildTime?: string;
  osName?: string;
  isDocker?: boolean;
  startTime?: string;
}

export interface HealthCheck {
  source: string;
  type: string;
  message: string;
  wikiUrl?: string;
}

export interface DiskSpace {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

export interface PageParams {
  page?: number;
  pageSize?: number;
}
```

- [ ] **Step 2: Write the failing client tests**

`test/sonarr/client.test.ts`:

```ts
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSonarrClient } from '../../src/sonarr/client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = createSonarrClient({ baseUrl: 'http://sonarr.test:8989', apiKey: 'k' });
const url = (path: string) => `http://sonarr.test:8989/api/v3${path}`;

describe('SonarrClient', () => {
  it('lists series', async () => {
    server.use(http.get(url('/series'), () => HttpResponse.json([{ id: 1, title: 'Andor' }])));
    await expect(client.listSeries()).resolves.toEqual([{ id: 1, title: 'Andor' }]);
  });

  it('gets one series by id', async () => {
    server.use(http.get(url('/series/7'), () => HttpResponse.json({ id: 7, title: 'Severance' })));
    await expect(client.getSeries(7)).resolves.toMatchObject({ id: 7 });
  });

  it('looks up series by term', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/series/lookup'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('term');
        return HttpResponse.json([]);
      }),
    );
    await client.lookupSeries('the expanse');
    expect(seen).toBe('the expanse');
  });

  it('adds a series', async () => {
    let body: unknown;
    server.use(
      http.post(url('/series'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 12 }, { status: 201 });
      }),
    );
    await client.addSeries({
      title: 'Andor',
      tvdbId: 404,
      qualityProfileId: 1,
      rootFolderPath: '/tv',
    });
    expect(body).toMatchObject({ tvdbId: 404, rootFolderPath: '/tv' });
  });

  it('deletes a series and forwards the delete options as query params', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.delete(url('/series/3'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await client.deleteSeries(3, { deleteFiles: true, addImportListExclusion: false });
    expect(params?.get('deleteFiles')).toBe('true');
    expect(params?.get('addImportListExclusion')).toBe('false');
  });

  it('lists episodes filtered by series and season', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get(url('/episode'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );
    await client.listEpisodes(5, 2);
    expect(params?.get('seriesId')).toBe('5');
    expect(params?.get('seasonNumber')).toBe('2');
  });

  it('monitors episodes with a put body', async () => {
    let body: unknown;
    server.use(
      http.put(url('/episode/monitor'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([]);
      }),
    );
    await client.monitorEpisodes([1, 2], true);
    expect(body).toEqual({ episodeIds: [1, 2], monitored: true });
  });

  it('gets the queue as a paged response', async () => {
    server.use(
      http.get(url('/queue'), () =>
        HttpResponse.json({ page: 1, pageSize: 20, totalRecords: 1, records: [{ id: 9 }] }),
      ),
    );
    const queue = await client.getQueue({ page: 1 });
    expect(queue.records).toHaveLength(1);
    expect(queue.totalRecords).toBe(1);
  });

  it('deletes a queue item with removal options', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.delete(url('/queue/4'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await client.deleteQueueItem(4, { removeFromClient: true, blocklist: true });
    expect(params?.get('removeFromClient')).toBe('true');
    expect(params?.get('blocklist')).toBe('true');
  });

  it('runs a command', async () => {
    let body: unknown;
    server.use(
      http.post(url('/command'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 1, name: 'SeriesSearch', status: 'queued' }, { status: 201 });
      }),
    );
    const command = await client.runCommand({ name: 'SeriesSearch', seriesId: 3 });
    expect(body).toEqual({ name: 'SeriesSearch', seriesId: 3 });
    expect(command.status).toBe('queued');
  });

  it('reads system status, health and disk space', async () => {
    server.use(
      http.get(url('/system/status'), () => HttpResponse.json({ appName: 'Sonarr', version: '4.0' })),
      http.get(url('/health'), () => HttpResponse.json([{ source: 'x', type: 'warning', message: 'm' }])),
      http.get(url('/diskspace'), () => HttpResponse.json([{ path: '/tv', freeSpace: 1 }])),
    );
    await expect(client.getSystemStatus()).resolves.toMatchObject({ appName: 'Sonarr' });
    await expect(client.getHealth()).resolves.toHaveLength(1);
    await expect(client.getDiskSpace()).resolves.toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run and verify failure**

Run: `npx vitest run test/sonarr/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/sonarr/client.ts`**

Every method is a one-line delegation to the shared client following the
endpoint table above. The full interface and the first methods are given
below; write the remaining methods against the table in exactly this style.

```ts
import type { InstanceConfig } from '../config.js';
import { createArrClient } from '../http/client.js';
import type {
  AddSeriesPayload,
  BlocklistRecord,
  CommandPayload,
  CommandResource,
  DiskSpace,
  Episode,
  EpisodeFile,
  HealthCheck,
  HistoryRecord,
  PageParams,
  PagedResponse,
  QualityProfile,
  QueueRecord,
  RootFolder,
  Series,
  SystemStatus,
  Tag,
} from './types.js';

export interface DeleteSeriesOptions {
  deleteFiles?: boolean;
  addImportListExclusion?: boolean;
}

export interface CalendarOptions {
  start?: string;
  end?: string;
  includeSeries?: boolean;
}

export interface QueueOptions extends PageParams {
  includeSeries?: boolean;
  includeEpisode?: boolean;
}

export interface DeleteQueueItemOptions {
  removeFromClient?: boolean;
  blocklist?: boolean;
}

export interface HistoryOptions extends PageParams {
  eventType?: number;
}

export interface WantedOptions extends PageParams {
  includeSeries?: boolean;
}

export interface SonarrClient {
  listSeries(): Promise<Series[]>;
  getSeries(id: number): Promise<Series>;
  lookupSeries(term: string): Promise<Series[]>;
  addSeries(payload: AddSeriesPayload): Promise<Series>;
  updateSeries(id: number, payload: Series): Promise<Series>;
  deleteSeries(id: number, options?: DeleteSeriesOptions): Promise<void>;
  listEpisodes(seriesId: number, seasonNumber?: number): Promise<Episode[]>;
  getEpisode(id: number): Promise<Episode>;
  monitorEpisodes(episodeIds: number[], monitored: boolean): Promise<Episode[]>;
  listEpisodeFiles(seriesId: number): Promise<EpisodeFile[]>;
  deleteEpisodeFile(id: number): Promise<void>;
  getCalendar(options?: CalendarOptions): Promise<Episode[]>;
  getQueue(options?: QueueOptions): Promise<PagedResponse<QueueRecord>>;
  deleteQueueItem(id: number, options?: DeleteQueueItemOptions): Promise<void>;
  getHistory(options?: HistoryOptions): Promise<PagedResponse<HistoryRecord>>;
  getWantedMissing(options?: WantedOptions): Promise<PagedResponse<Episode>>;
  getBlocklist(options?: PageParams): Promise<PagedResponse<BlocklistRecord>>;
  deleteBlocklistItem(id: number): Promise<void>;
  runCommand(payload: CommandPayload): Promise<CommandResource>;
  getCommand(id: number): Promise<CommandResource>;
  listQualityProfiles(): Promise<QualityProfile[]>;
  listRootFolders(): Promise<RootFolder[]>;
  listTags(): Promise<Tag[]>;
  getSystemStatus(): Promise<SystemStatus>;
  getHealth(): Promise<HealthCheck[]>;
  getDiskSpace(): Promise<DiskSpace[]>;
}

export function createSonarrClient(config: InstanceConfig): SonarrClient {
  const http = createArrClient({
    product: 'Sonarr',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    apiBase: '/api/v3',
  });

  return {
    listSeries: () => http.get('/series'),
    getSeries: (id) => http.get(`/series/${id}`),
    lookupSeries: (term) => http.get('/series/lookup', { term }),
    addSeries: (payload) => http.post('/series', payload),
    updateSeries: (id, payload) => http.put(`/series/${id}`, payload),
    deleteSeries: (id, options) => http.del(`/series/${id}`, { ...options }),
    listEpisodes: (seriesId, seasonNumber) => http.get('/episode', { seriesId, seasonNumber }),
    getEpisode: (id) => http.get(`/episode/${id}`),
    monitorEpisodes: (episodeIds, monitored) =>
      http.put('/episode/monitor', { episodeIds, monitored }),
    listEpisodeFiles: (seriesId) => http.get('/episodefile', { seriesId }),
    deleteEpisodeFile: (id) => http.del(`/episodefile/${id}`),
    getCalendar: (options) => http.get('/calendar', { ...options }),
    getQueue: (options) => http.get('/queue', { ...options }),
    deleteQueueItem: (id, options) => http.del(`/queue/${id}`, { ...options }),
    getHistory: (options) => http.get('/history', { ...options }),
    getWantedMissing: (options) => http.get('/wanted/missing', { ...options }),
    getBlocklist: (options) => http.get('/blocklist', { ...options }),
    deleteBlocklistItem: (id) => http.del(`/blocklist/${id}`),
    runCommand: (payload) => http.post('/command', payload),
    getCommand: (id) => http.get(`/command/${id}`),
    listQualityProfiles: () => http.get('/qualityprofile'),
    listRootFolders: () => http.get('/rootfolder'),
    listTags: () => http.get('/tag'),
    getSystemStatus: () => http.get('/system/status'),
    getHealth: () => http.get('/health'),
    getDiskSpace: () => http.get('/diskspace'),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add sonarr api client"
```

---

### Task 6: Sonarr response shaping and tools

**Files:**
- Create: `src/sonarr/shape.ts`, `src/sonarr/tools.ts`
- Test: `test/sonarr/shape.test.ts`, `test/sonarr/tools.test.ts`

**Interfaces:**
- Consumes: `SonarrClient` from `src/sonarr/client.js`; `defineTool`, `ToolDefinition` from `src/mcp/types.js`.
- Produces:
  ```ts
  // src/sonarr/shape.ts
  export function summarizeSeries(series: Series): SeriesSummary
  export function summarizeEpisode(episode: Episode): EpisodeSummary
  export function summarizeQueueRecord(record: QueueRecord): QueueSummary

  // src/sonarr/tools.ts
  export function createSonarrTools(client: SonarrClient): ToolDefinition[]
  ```

Shaping exists so a `list_series` call over a large library does not flood the
context window. List tools return summaries; `get`-by-id tools return the full
record untouched.

- [ ] **Step 1: Write the failing shape tests**

`test/sonarr/shape.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summarizeEpisode, summarizeQueueRecord, summarizeSeries } from '../../src/sonarr/shape.js';
import type { Episode, QueueRecord, Series } from '../../src/sonarr/types.js';

const series = {
  id: 1,
  title: 'Andor',
  status: 'continuing',
  year: 2022,
  monitored: true,
  qualityProfileId: 4,
  tvdbId: 371980,
  tags: [2],
  path: '/tv/Andor',
  overview: 'A'.repeat(500),
  seasons: [
    { seasonNumber: 1, monitored: true },
    { seasonNumber: 2, monitored: false },
  ],
  statistics: { episodeFileCount: 12, episodeCount: 24, sizeOnDisk: 1024 },
  images: [{ coverType: 'poster', url: 'http://example/poster.jpg' }],
} as unknown as Series;

describe('summarizeSeries', () => {
  it('keeps the identifying and actionable fields', () => {
    const summary = summarizeSeries(series);
    expect(summary).toMatchObject({
      id: 1,
      title: 'Andor',
      year: 2022,
      status: 'continuing',
      monitored: true,
      qualityProfileId: 4,
      tvdbId: 371980,
      path: '/tv/Andor',
      seasonCount: 2,
      episodeFileCount: 12,
      episodeCount: 24,
    });
  });

  it('drops image blobs and truncates a long overview', () => {
    const summary = summarizeSeries(series);
    expect(summary).not.toHaveProperty('images');
    expect(summary.overview?.length).toBeLessThanOrEqual(303);
  });
});

describe('summarizeEpisode', () => {
  it('projects the episode down to identity, air date and file state', () => {
    const episode = {
      id: 10,
      seriesId: 1,
      seasonNumber: 1,
      episodeNumber: 3,
      title: 'Reckoning',
      airDateUtc: '2022-09-21T00:00:00Z',
      hasFile: true,
      monitored: true,
      overview: 'B'.repeat(500),
    } as Episode;

    const summary = summarizeEpisode(episode);
    expect(summary).toMatchObject({
      id: 10,
      seriesId: 1,
      seasonNumber: 1,
      episodeNumber: 3,
      title: 'Reckoning',
      hasFile: true,
      monitored: true,
    });
    expect(summary.overview?.length).toBeLessThanOrEqual(303);
  });
});

describe('summarizeQueueRecord', () => {
  it('reports progress and surfaces status messages', () => {
    const record = {
      id: 5,
      title: 'Andor.S01E03',
      status: 'downloading',
      size: 100,
      sizeleft: 25,
      timeleft: '00:10:00',
      trackedDownloadState: 'downloading',
      indexer: 'nzbgeek',
      statusMessages: [{ title: 'warn', messages: ['slow'] }],
    } as QueueRecord;

    const summary = summarizeQueueRecord(record);
    expect(summary).toMatchObject({
      id: 5,
      title: 'Andor.S01E03',
      status: 'downloading',
      timeleft: '00:10:00',
      indexer: 'nzbgeek',
      percentComplete: 75,
    });
    expect(summary.statusMessages).toEqual(['slow']);
  });

  it('reports 0 percent complete when size is unknown', () => {
    const summary = summarizeQueueRecord({ id: 1, title: 't', status: 's', size: 0, sizeleft: 0 } as QueueRecord);
    expect(summary.percentComplete).toBe(0);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run test/sonarr/shape.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/sonarr/shape.ts`**

```ts
import type { Episode, QueueRecord, Series } from './types.js';

const MAX_OVERVIEW = 300;

function truncateOverview(overview: string | undefined): string | undefined {
  if (!overview) return undefined;
  return overview.length > MAX_OVERVIEW ? `${overview.slice(0, MAX_OVERVIEW)}...` : overview;
}

export interface SeriesSummary {
  id: number;
  title: string;
  year: number;
  status: string;
  network?: string;
  monitored: boolean;
  qualityProfileId: number;
  tvdbId: number;
  path?: string;
  tags: number[];
  seasonCount: number;
  episodeFileCount?: number;
  episodeCount?: number;
  sizeOnDisk?: number;
  overview?: string;
}

export function summarizeSeries(series: Series): SeriesSummary {
  return {
    id: series.id,
    title: series.title,
    year: series.year,
    status: series.status,
    network: series.network,
    monitored: series.monitored,
    qualityProfileId: series.qualityProfileId,
    tvdbId: series.tvdbId,
    path: series.path,
    tags: series.tags ?? [],
    seasonCount: series.seasons?.length ?? 0,
    episodeFileCount: series.statistics?.episodeFileCount,
    episodeCount: series.statistics?.episodeCount,
    sizeOnDisk: series.statistics?.sizeOnDisk,
    overview: truncateOverview(series.overview),
  };
}

export interface EpisodeSummary {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDateUtc?: string;
  hasFile: boolean;
  monitored: boolean;
  seriesTitle?: string;
  overview?: string;
}

export function summarizeEpisode(episode: Episode): EpisodeSummary {
  return {
    id: episode.id,
    seriesId: episode.seriesId,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    airDateUtc: episode.airDateUtc,
    hasFile: episode.hasFile,
    monitored: episode.monitored,
    seriesTitle: episode.series?.title,
    overview: truncateOverview(episode.overview),
  };
}

export interface QueueSummary {
  id: number;
  title: string;
  status: string;
  trackedDownloadState?: string;
  percentComplete: number;
  timeleft?: string;
  indexer?: string;
  downloadClient?: string;
  errorMessage?: string;
  statusMessages?: string[];
}

export function summarizeQueueRecord(record: QueueRecord): QueueSummary {
  const percentComplete =
    record.size > 0 ? Math.round(((record.size - record.sizeleft) / record.size) * 100) : 0;

  const statusMessages = record.statusMessages?.flatMap((entry) => entry.messages);

  return {
    id: record.id,
    title: record.title,
    status: record.status,
    trackedDownloadState: record.trackedDownloadState,
    percentComplete,
    timeleft: record.timeleft,
    indexer: record.indexer,
    downloadClient: record.downloadClient,
    errorMessage: record.errorMessage,
    statusMessages: statusMessages?.length ? statusMessages : undefined,
  };
}
```

- [ ] **Step 4: Write the failing tools tests**

`test/sonarr/tools.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { SonarrClient } from '../../src/sonarr/client.js';
import { createSonarrTools } from '../../src/sonarr/tools.js';

function toolsFor(overrides: Partial<SonarrClient>) {
  const client = overrides as SonarrClient;
  const tools = createSonarrTools(client);
  return (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  };
}

describe('createSonarrTools', () => {
  it('registers all 26 tools with unique sonarr_ prefixed names', () => {
    const names = createSonarrTools({} as SonarrClient).map((t) => t.name);
    expect(names).toHaveLength(26);
    expect(names.every((n) => n.startsWith('sonarr_'))).toBe(true);
    expect(new Set(names).size).toBe(26);
  });

  it('gives every tool a non-empty description', () => {
    for (const tool of createSonarrTools({} as SonarrClient)) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it('summarises the series list', async () => {
    const listSeries = vi.fn().mockResolvedValue([
      { id: 1, title: 'Andor', year: 2022, status: 'continuing', monitored: true, qualityProfileId: 1, tvdbId: 9, tags: [], seasons: [] },
    ]);
    const get = toolsFor({ listSeries });
    const result = (await get('sonarr_list_series').handler({})) as unknown[];
    expect(result).toEqual([expect.objectContaining({ id: 1, title: 'Andor', seasonCount: 0 })]);
  });

  it('returns the full record from get_series', async () => {
    const getSeries = vi.fn().mockResolvedValue({ id: 7, title: 'Severance', path: '/tv' });
    const get = toolsFor({ getSeries });
    await expect(get('sonarr_get_series').handler({ seriesId: 7 })).resolves.toMatchObject({ id: 7 });
    expect(getSeries).toHaveBeenCalledWith(7);
  });

  it('passes the add_series arguments straight through', async () => {
    const addSeries = vi.fn().mockResolvedValue({ id: 3, title: 'Andor', year: 2022, status: 'continuing', monitored: true, qualityProfileId: 1, tvdbId: 9, tags: [], seasons: [] });
    const get = toolsFor({ addSeries });
    await get('sonarr_add_series').handler({
      title: 'Andor',
      tvdbId: 9,
      qualityProfileId: 1,
      rootFolderPath: '/tv',
      searchForMissingEpisodes: true,
    });
    expect(addSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        tvdbId: 9,
        rootFolderPath: '/tv',
        addOptions: expect.objectContaining({ searchForMissingEpisodes: true }),
      }),
    );
  });

  it('defaults delete_series to keeping files', async () => {
    const deleteSeries = vi.fn().mockResolvedValue(undefined);
    const get = toolsFor({ deleteSeries });
    await get('sonarr_delete_series').handler({ seriesId: 4 });
    expect(deleteSeries).toHaveBeenCalledWith(4, { deleteFiles: false, addImportListExclusion: false });
  });

  it('summarises queue records', async () => {
    const getQueue = vi.fn().mockResolvedValue({
      page: 1,
      pageSize: 20,
      totalRecords: 1,
      records: [{ id: 1, title: 'x', status: 'downloading', size: 100, sizeleft: 50 }],
    });
    const get = toolsFor({ getQueue });
    const result = (await get('sonarr_get_queue').handler({})) as { records: unknown[] };
    expect(result.records).toEqual([expect.objectContaining({ percentComplete: 50 })]);
  });

  it('restricts run_command to the supported command names', async () => {
    const tool = createSonarrTools({} as SonarrClient).find((t) => t.name === 'sonarr_run_command');
    const shape = tool?.inputSchema as { name: { parse: (v: unknown) => unknown } };
    expect(() => shape.name.parse('SeriesSearch')).not.toThrow();
    expect(() => shape.name.parse('DropDatabase')).toThrow();
  });

  it('propagates client errors out of the handler', async () => {
    const listSeries = vi.fn().mockRejectedValue(new Error('down'));
    const get = toolsFor({ listSeries });
    await expect(get('sonarr_list_series').handler({})).rejects.toThrow('down');
  });
});
```

- [ ] **Step 5: Run and verify failure**

Run: `npx vitest run test/sonarr/tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement `src/sonarr/tools.ts`**

Register exactly the 26 tools named in the spec. The representative
implementations below establish the pattern; write the remainder as direct
delegations to the matching client method named in the Task 5 endpoint table,
summarising in list tools and returning raw records in `get`-by-id tools.

```ts
import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { SonarrClient } from './client.js';
import { summarizeEpisode, summarizeQueueRecord, summarizeSeries } from './shape.js';

const COMMAND_NAMES = [
  'SeriesSearch',
  'EpisodeSearch',
  'SeasonSearch',
  'MissingEpisodeSearch',
  'RefreshSeries',
  'RescanSeries',
  'RenameFiles',
  'DownloadedEpisodesScan',
] as const;

const page = {
  page: z.number().int().min(1).optional().describe('Page number, starting at 1'),
  pageSize: z.number().int().min(1).max(200).optional().describe('Records per page (default 20)'),
};

export function createSonarrTools(client: SonarrClient): ToolDefinition[] {
  return [
    defineTool({
      name: 'sonarr_list_series',
      description:
        'List all TV series in the Sonarr library, summarised. Returns id, title, year, ' +
        'monitored state and episode counts. Use sonarr_get_series for the full record.',
      inputSchema: {},
      handler: async () => (await client.listSeries()).map(summarizeSeries),
    }),

    defineTool({
      name: 'sonarr_get_series',
      description: 'Get the full Sonarr record for one series, including every season.',
      inputSchema: { seriesId: z.number().int().describe('Sonarr series id') },
      handler: ({ seriesId }) => client.getSeries(seriesId),
    }),

    defineTool({
      name: 'sonarr_lookup_series',
      description:
        'Search TheTVDB for series matching a search term. Use this to find the tvdbId ' +
        'needed by sonarr_add_series. Does not modify the library.',
      inputSchema: { term: z.string().min(1).describe('Series title to search for') },
      handler: async ({ term }) => (await client.lookupSeries(term)).map(summarizeSeries),
    }),

    defineTool({
      name: 'sonarr_add_series',
      description:
        'Add a new series to Sonarr. Get tvdbId from sonarr_lookup_series, qualityProfileId ' +
        'from sonarr_list_quality_profiles, and rootFolderPath from sonarr_list_root_folders.',
      inputSchema: {
        title: z.string().describe('Series title'),
        tvdbId: z.number().int().describe('TheTVDB id, from sonarr_lookup_series'),
        qualityProfileId: z.number().int().describe('From sonarr_list_quality_profiles'),
        rootFolderPath: z.string().describe('From sonarr_list_root_folders'),
        monitored: z.boolean().optional().describe('Monitor the series (default true)'),
        seasonFolder: z.boolean().optional().describe('Use season folders (default true)'),
        searchForMissingEpisodes: z
          .boolean()
          .optional()
          .describe('Start searching for episodes immediately (default false)'),
        tags: z.array(z.number().int()).optional().describe('Tag ids from sonarr_list_tags'),
      },
      handler: async (args) => {
        const series = await client.addSeries({
          title: args.title,
          tvdbId: args.tvdbId,
          qualityProfileId: args.qualityProfileId,
          rootFolderPath: args.rootFolderPath,
          monitored: args.monitored ?? true,
          seasonFolder: args.seasonFolder ?? true,
          tags: args.tags,
          addOptions: {
            monitor: 'all',
            searchForMissingEpisodes: args.searchForMissingEpisodes ?? false,
          },
        });
        return summarizeSeries(series);
      },
    }),

    defineTool({
      name: 'sonarr_delete_series',
      description:
        'Remove a series from Sonarr. Destructive: set deleteFiles to true only when the ' +
        'user has explicitly asked for the files on disk to be deleted too.',
      inputSchema: {
        seriesId: z.number().int().describe('Sonarr series id'),
        deleteFiles: z.boolean().optional().describe('Also delete episode files (default false)'),
        addImportListExclusion: z
          .boolean()
          .optional()
          .describe('Prevent import lists re-adding it (default false)'),
      },
      handler: async ({ seriesId, deleteFiles, addImportListExclusion }) => {
        await client.deleteSeries(seriesId, {
          deleteFiles: deleteFiles ?? false,
          addImportListExclusion: addImportListExclusion ?? false,
        });
        return undefined;
      },
    }),

    defineTool({
      name: 'sonarr_get_queue',
      description:
        'List items currently downloading or awaiting import, with percent complete and any ' +
        'error messages. Use this to diagnose stuck or failed downloads.',
      inputSchema: { ...page },
      handler: async (args) => {
        const queue = await client.getQueue(args);
        return { ...queue, records: queue.records.map(summarizeQueueRecord) };
      },
    }),

    defineTool({
      name: 'sonarr_run_command',
      description:
        'Trigger a Sonarr background command, for example searching for a series or ' +
        'rescanning its folder. Returns a command id; poll it with sonarr_get_command.',
      inputSchema: {
        name: z.enum(COMMAND_NAMES).describe('Command to run'),
        seriesId: z.number().int().optional().describe('Target series, for series-scoped commands'),
        seasonNumber: z.number().int().optional().describe('Target season, for SeasonSearch'),
        episodeIds: z
          .array(z.number().int())
          .optional()
          .describe('Target episodes, for EpisodeSearch'),
      },
      handler: (args) => client.runCommand(args),
    }),

    defineTool({
      name: 'sonarr_get_calendar',
      description: 'List episodes airing in a date range, defaulting to the next week.',
      inputSchema: {
        start: z.string().optional().describe('ISO date, inclusive'),
        end: z.string().optional().describe('ISO date, exclusive'),
      },
      handler: async ({ start, end }) =>
        (await client.getCalendar({ start, end, includeSeries: true })).map(summarizeEpisode),
    }),

    // Remaining tools, each delegating to the client method from the Task 5
    // table: sonarr_update_series, sonarr_list_episodes, sonarr_get_episode,
    // sonarr_monitor_episodes, sonarr_list_episode_files,
    // sonarr_delete_episode_file, sonarr_delete_queue_item, sonarr_get_history,
    // sonarr_get_wanted_missing, sonarr_get_blocklist,
    // sonarr_delete_blocklist_item, sonarr_get_command,
    // sonarr_list_quality_profiles, sonarr_list_root_folders, sonarr_list_tags,
    // sonarr_get_system_status, sonarr_get_health, sonarr_get_disk_space.
  ];
}
```

Replace the trailing comment with the real definitions before committing —
`createSonarrTools` must return all 26 tools, and add a test asserting
`createSonarrTools({} as SonarrClient)` has length 26.

- [ ] **Step 7: Run the tests**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add sonarr mcp tools with response shaping"
```

---

### Task 7: Radarr types and client

**Files:**
- Create: `src/radarr/types.ts`, `src/radarr/client.ts`
- Test: `test/radarr/client.test.ts`

**Interfaces:**
- Consumes: `createArrClient` from `src/http/client.js`; `InstanceConfig` from `src/config.js`.
- Produces: `RadarrClient` and `createRadarrClient(config: InstanceConfig): RadarrClient`.

Radarr's API is structurally identical to Sonarr's with movies in place of
series and episodes. Do not import anything from `src/sonarr/` — the products
stay independent even where their shapes coincide, so one can change without
breaking the other.

| Method | HTTP | Path | Query / body |
| --- | --- | --- | --- |
| `listMovies()` | GET | `/movie` | — |
| `getMovie(id)` | GET | `/movie/{id}` | — |
| `lookupMovie(term)` | GET | `/movie/lookup` | `term` |
| `lookupMovieByTmdbId(tmdbId)` | GET | `/movie/lookup/tmdb` | `tmdbId` |
| `addMovie(payload)` | POST | `/movie` | body = `AddMoviePayload` |
| `updateMovie(id, payload)` | PUT | `/movie/{id}` | body = `Movie` |
| `deleteMovie(id, opts)` | DELETE | `/movie/{id}` | `deleteFiles`, `addImportExclusion` |
| `listMovieFiles(movieId)` | GET | `/moviefile` | `movieId` |
| `deleteMovieFile(id)` | DELETE | `/moviefile/{id}` | — |
| `getCalendar(opts)` | GET | `/calendar` | `start`, `end`, `unmonitored` |
| `getQueue(opts)` | GET | `/queue` | `page`, `pageSize`, `includeMovie` |
| `deleteQueueItem(id, opts)` | DELETE | `/queue/{id}` | `removeFromClient`, `blocklist` |
| `getHistory(opts)` | GET | `/history` | `page`, `pageSize`, `eventType` |
| `getWantedMissing(opts)` | GET | `/wanted/missing` | `page`, `pageSize` |
| `getBlocklist(opts)` | GET | `/blocklist` | `page`, `pageSize` |
| `deleteBlocklistItem(id)` | DELETE | `/blocklist/{id}` | — |
| `listCollections()` | GET | `/collection` | — |
| `runCommand(payload)` | POST | `/command` | body = `CommandPayload` |
| `getCommand(id)` | GET | `/command/{id}` | — |
| `listQualityProfiles()` | GET | `/qualityprofile` | — |
| `listRootFolders()` | GET | `/rootfolder` | — |
| `listTags()` | GET | `/tag` | — |
| `getSystemStatus()` | GET | `/system/status` | — |
| `getHealth()` | GET | `/health` | — |
| `getDiskSpace()` | GET | `/diskspace` | — |

Note Radarr spells the delete-exclusion query parameter `addImportExclusion`,
not Sonarr's `addImportListExclusion`.

- [ ] **Step 1: Write `src/radarr/types.ts`**

```ts
export interface PagedResponse<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}

export interface Movie {
  id: number;
  title: string;
  originalTitle?: string;
  sortTitle?: string;
  status: string;
  overview?: string;
  year: number;
  runtime?: number;
  monitored: boolean;
  qualityProfileId: number;
  rootFolderPath?: string;
  path?: string;
  tmdbId: number;
  imdbId?: string;
  tags: number[];
  hasFile: boolean;
  isAvailable?: boolean;
  minimumAvailability?: string;
  sizeOnDisk?: number;
  added?: string;
  collection?: { title?: string; tmdbId?: number };
  ratings?: Record<string, { value?: number; votes?: number }>;
}

export interface AddMoviePayload {
  title: string;
  tmdbId: number;
  qualityProfileId: number;
  rootFolderPath: string;
  monitored?: boolean;
  minimumAvailability?: string;
  tags?: number[];
  addOptions?: { searchForMovie?: boolean };
}

export interface MovieFile {
  id: number;
  movieId: number;
  relativePath: string;
  path: string;
  size: number;
  dateAdded: string;
  quality?: { quality: { id: number; name: string } };
}

export interface QueueRecord {
  id: number;
  movieId?: number;
  title: string;
  status: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  errorMessage?: string;
  downloadClient?: string;
  indexer?: string;
  statusMessages?: Array<{ title?: string; messages: string[] }>;
}

export interface HistoryRecord {
  id: number;
  movieId: number;
  sourceTitle: string;
  eventType: string;
  date: string;
  data?: Record<string, string>;
}

export interface BlocklistRecord {
  id: number;
  movieId: number;
  sourceTitle: string;
  date: string;
  protocol?: string;
  indexer?: string;
}

export interface Collection {
  id: number;
  title: string;
  tmdbId: number;
  monitored: boolean;
  qualityProfileId?: number;
  rootFolderPath?: string;
  movies?: Array<{ tmdbId: number; title: string; monitored?: boolean }>;
}

export interface CommandPayload {
  name: string;
  movieId?: number;
  movieIds?: number[];
}

export interface CommandResource {
  id: number;
  name: string;
  status: string;
  queued?: string;
  started?: string;
  ended?: string;
  message?: string;
}

export interface QualityProfile {
  id: number;
  name: string;
  upgradeAllowed: boolean;
  cutoff: number;
}

export interface RootFolder {
  id: number;
  path: string;
  accessible: boolean;
  freeSpace?: number;
}

export interface Tag {
  id: number;
  label: string;
}

export interface SystemStatus {
  appName: string;
  version: string;
  buildTime?: string;
  osName?: string;
  isDocker?: boolean;
  startTime?: string;
}

export interface HealthCheck {
  source: string;
  type: string;
  message: string;
  wikiUrl?: string;
}

export interface DiskSpace {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

export interface PageParams {
  page?: number;
  pageSize?: number;
}
```

- [ ] **Step 2: Write the failing client tests**

`test/radarr/client.test.ts`:

```ts
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRadarrClient } from '../../src/radarr/client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = createRadarrClient({ baseUrl: 'http://radarr.test:7878', apiKey: 'k' });
const url = (path: string) => `http://radarr.test:7878/api/v3${path}`;

describe('RadarrClient', () => {
  it('lists movies', async () => {
    server.use(http.get(url('/movie'), () => HttpResponse.json([{ id: 1, title: 'Dune' }])));
    await expect(client.listMovies()).resolves.toEqual([{ id: 1, title: 'Dune' }]);
  });

  it('gets one movie by id', async () => {
    server.use(http.get(url('/movie/4'), () => HttpResponse.json({ id: 4, title: 'Arrival' })));
    await expect(client.getMovie(4)).resolves.toMatchObject({ id: 4 });
  });

  it('looks up movies by term', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/movie/lookup'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('term');
        return HttpResponse.json([]);
      }),
    );
    await client.lookupMovie('dune');
    expect(seen).toBe('dune');
  });

  it('looks up a movie by tmdb id', async () => {
    let seen: string | null = null;
    server.use(
      http.get(url('/movie/lookup/tmdb'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('tmdbId');
        return HttpResponse.json({ tmdbId: 438631 });
      }),
    );
    await client.lookupMovieByTmdbId(438631);
    expect(seen).toBe('438631');
  });

  it('adds a movie', async () => {
    let body: unknown;
    server.use(
      http.post(url('/movie'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 2 }, { status: 201 });
      }),
    );
    await client.addMovie({ title: 'Dune', tmdbId: 438631, qualityProfileId: 1, rootFolderPath: '/movies' });
    expect(body).toMatchObject({ tmdbId: 438631, rootFolderPath: '/movies' });
  });

  it('deletes a movie using radarr addImportExclusion spelling', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.delete(url('/movie/3'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await client.deleteMovie(3, { deleteFiles: true, addImportExclusion: true });
    expect(params?.get('deleteFiles')).toBe('true');
    expect(params?.get('addImportExclusion')).toBe('true');
  });

  it('gets the queue as a paged response', async () => {
    server.use(
      http.get(url('/queue'), () =>
        HttpResponse.json({ page: 1, pageSize: 20, totalRecords: 1, records: [{ id: 3 }] }),
      ),
    );
    await expect(client.getQueue({ page: 1 })).resolves.toMatchObject({ totalRecords: 1 });
  });

  it('lists collections', async () => {
    server.use(http.get(url('/collection'), () => HttpResponse.json([{ id: 1, title: 'Dune Collection' }])));
    await expect(client.listCollections()).resolves.toHaveLength(1);
  });

  it('runs a command', async () => {
    let body: unknown;
    server.use(
      http.post(url('/command'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 1, name: 'MoviesSearch', status: 'queued' }, { status: 201 });
      }),
    );
    await client.runCommand({ name: 'MoviesSearch', movieIds: [3] });
    expect(body).toEqual({ name: 'MoviesSearch', movieIds: [3] });
  });

  it('reads system status, health and disk space', async () => {
    server.use(
      http.get(url('/system/status'), () => HttpResponse.json({ appName: 'Radarr', version: '5.0' })),
      http.get(url('/health'), () => HttpResponse.json([])),
      http.get(url('/diskspace'), () => HttpResponse.json([])),
    );
    await expect(client.getSystemStatus()).resolves.toMatchObject({ appName: 'Radarr' });
    await expect(client.getHealth()).resolves.toEqual([]);
    await expect(client.getDiskSpace()).resolves.toEqual([]);
  });
});
```

- [ ] **Step 3: Run and verify failure**

Run: `npx vitest run test/radarr/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/radarr/client.ts`**

```ts
import type { InstanceConfig } from '../config.js';
import { createArrClient } from '../http/client.js';
import type {
  AddMoviePayload,
  BlocklistRecord,
  Collection,
  CommandPayload,
  CommandResource,
  DiskSpace,
  HealthCheck,
  HistoryRecord,
  Movie,
  MovieFile,
  PageParams,
  PagedResponse,
  QualityProfile,
  QueueRecord,
  RootFolder,
  SystemStatus,
  Tag,
} from './types.js';

export interface DeleteMovieOptions {
  deleteFiles?: boolean;
  addImportExclusion?: boolean;
}

export interface CalendarOptions {
  start?: string;
  end?: string;
  unmonitored?: boolean;
}

export interface QueueOptions extends PageParams {
  includeMovie?: boolean;
}

export interface DeleteQueueItemOptions {
  removeFromClient?: boolean;
  blocklist?: boolean;
}

export interface HistoryOptions extends PageParams {
  eventType?: number;
}

export interface RadarrClient {
  listMovies(): Promise<Movie[]>;
  getMovie(id: number): Promise<Movie>;
  lookupMovie(term: string): Promise<Movie[]>;
  lookupMovieByTmdbId(tmdbId: number): Promise<Movie>;
  addMovie(payload: AddMoviePayload): Promise<Movie>;
  updateMovie(id: number, payload: Movie): Promise<Movie>;
  deleteMovie(id: number, options?: DeleteMovieOptions): Promise<void>;
  listMovieFiles(movieId: number): Promise<MovieFile[]>;
  deleteMovieFile(id: number): Promise<void>;
  getCalendar(options?: CalendarOptions): Promise<Movie[]>;
  getQueue(options?: QueueOptions): Promise<PagedResponse<QueueRecord>>;
  deleteQueueItem(id: number, options?: DeleteQueueItemOptions): Promise<void>;
  getHistory(options?: HistoryOptions): Promise<PagedResponse<HistoryRecord>>;
  getWantedMissing(options?: PageParams): Promise<PagedResponse<Movie>>;
  getBlocklist(options?: PageParams): Promise<PagedResponse<BlocklistRecord>>;
  deleteBlocklistItem(id: number): Promise<void>;
  listCollections(): Promise<Collection[]>;
  runCommand(payload: CommandPayload): Promise<CommandResource>;
  getCommand(id: number): Promise<CommandResource>;
  listQualityProfiles(): Promise<QualityProfile[]>;
  listRootFolders(): Promise<RootFolder[]>;
  listTags(): Promise<Tag[]>;
  getSystemStatus(): Promise<SystemStatus>;
  getHealth(): Promise<HealthCheck[]>;
  getDiskSpace(): Promise<DiskSpace[]>;
}

export function createRadarrClient(config: InstanceConfig): RadarrClient {
  const http = createArrClient({
    product: 'Radarr',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    apiBase: '/api/v3',
  });

  return {
    listMovies: () => http.get('/movie'),
    getMovie: (id) => http.get(`/movie/${id}`),
    lookupMovie: (term) => http.get('/movie/lookup', { term }),
    lookupMovieByTmdbId: (tmdbId) => http.get('/movie/lookup/tmdb', { tmdbId }),
    addMovie: (payload) => http.post('/movie', payload),
    updateMovie: (id, payload) => http.put(`/movie/${id}`, payload),
    deleteMovie: (id, options) => http.del(`/movie/${id}`, { ...options }),
    listMovieFiles: (movieId) => http.get('/moviefile', { movieId }),
    deleteMovieFile: (id) => http.del(`/moviefile/${id}`),
    getCalendar: (options) => http.get('/calendar', { ...options }),
    getQueue: (options) => http.get('/queue', { ...options }),
    deleteQueueItem: (id, options) => http.del(`/queue/${id}`, { ...options }),
    getHistory: (options) => http.get('/history', { ...options }),
    getWantedMissing: (options) => http.get('/wanted/missing', { ...options }),
    getBlocklist: (options) => http.get('/blocklist', { ...options }),
    deleteBlocklistItem: (id) => http.del(`/blocklist/${id}`),
    listCollections: () => http.get('/collection'),
    runCommand: (payload) => http.post('/command', payload),
    getCommand: (id) => http.get(`/command/${id}`),
    listQualityProfiles: () => http.get('/qualityprofile'),
    listRootFolders: () => http.get('/rootfolder'),
    listTags: () => http.get('/tag'),
    getSystemStatus: () => http.get('/system/status'),
    getHealth: () => http.get('/health'),
    getDiskSpace: () => http.get('/diskspace'),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add radarr api client"
```

---

### Task 8: Radarr response shaping and tools

**Files:**
- Create: `src/radarr/shape.ts`, `src/radarr/tools.ts`
- Test: `test/radarr/shape.test.ts`, `test/radarr/tools.test.ts`

**Interfaces:**
- Consumes: `RadarrClient` from `src/radarr/client.js`; `defineTool`, `ToolDefinition` from `src/mcp/types.js`.
- Produces:
  ```ts
  export function summarizeMovie(movie: Movie): MovieSummary
  export function summarizeQueueRecord(record: QueueRecord): QueueSummary
  export function createRadarrTools(client: RadarrClient): ToolDefinition[]
  ```

The 24 tools are: `radarr_list_movies`, `radarr_get_movie`,
`radarr_lookup_movie`, `radarr_add_movie`, `radarr_update_movie`,
`radarr_delete_movie`, `radarr_list_movie_files`, `radarr_delete_movie_file`,
`radarr_get_calendar`, `radarr_get_queue`, `radarr_delete_queue_item`,
`radarr_get_history`, `radarr_get_wanted_missing`, `radarr_get_blocklist`,
`radarr_delete_blocklist_item`, `radarr_list_collections`,
`radarr_run_command`, `radarr_get_command`, `radarr_list_quality_profiles`,
`radarr_list_root_folders`, `radarr_list_tags`, `radarr_get_system_status`,
`radarr_get_health`, `radarr_get_disk_space`.

- [ ] **Step 1: Write the failing shape test**

`test/radarr/shape.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summarizeMovie, summarizeQueueRecord } from '../../src/radarr/shape.js';
import type { Movie, QueueRecord } from '../../src/radarr/types.js';

const movie = {
  id: 1,
  title: 'Dune',
  year: 2021,
  status: 'released',
  monitored: true,
  qualityProfileId: 3,
  tmdbId: 438631,
  imdbId: 'tt1160419',
  tags: [],
  hasFile: true,
  sizeOnDisk: 2048,
  path: '/movies/Dune',
  runtime: 155,
  overview: 'C'.repeat(500),
  ratings: { tmdb: { value: 7.8 } },
  images: [{ coverType: 'poster', url: 'http://example/p.jpg' }],
} as unknown as Movie;

describe('summarizeMovie', () => {
  it('keeps identifying and actionable fields', () => {
    expect(summarizeMovie(movie)).toMatchObject({
      id: 1,
      title: 'Dune',
      year: 2021,
      status: 'released',
      monitored: true,
      hasFile: true,
      qualityProfileId: 3,
      tmdbId: 438631,
      imdbId: 'tt1160419',
      path: '/movies/Dune',
      runtime: 155,
      sizeOnDisk: 2048,
    });
  });

  it('drops image blobs and truncates a long overview', () => {
    const summary = summarizeMovie(movie);
    expect(summary).not.toHaveProperty('images');
    expect(summary.overview?.length).toBeLessThanOrEqual(303);
  });
});

describe('summarizeQueueRecord', () => {
  it('computes percent complete', () => {
    const summary = summarizeQueueRecord({
      id: 1,
      title: 'Dune.2021',
      status: 'downloading',
      size: 200,
      sizeleft: 50,
    } as QueueRecord);
    expect(summary.percentComplete).toBe(75);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run test/radarr/shape.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/radarr/shape.ts`**

```ts
import type { Movie, QueueRecord } from './types.js';

const MAX_OVERVIEW = 300;

function truncateOverview(overview: string | undefined): string | undefined {
  if (!overview) return undefined;
  return overview.length > MAX_OVERVIEW ? `${overview.slice(0, MAX_OVERVIEW)}...` : overview;
}

export interface MovieSummary {
  id: number;
  title: string;
  year: number;
  status: string;
  monitored: boolean;
  hasFile: boolean;
  qualityProfileId: number;
  tmdbId: number;
  imdbId?: string;
  path?: string;
  runtime?: number;
  sizeOnDisk?: number;
  tags: number[];
  overview?: string;
}

export function summarizeMovie(movie: Movie): MovieSummary {
  return {
    id: movie.id,
    title: movie.title,
    year: movie.year,
    status: movie.status,
    monitored: movie.monitored,
    hasFile: movie.hasFile,
    qualityProfileId: movie.qualityProfileId,
    tmdbId: movie.tmdbId,
    imdbId: movie.imdbId,
    path: movie.path,
    runtime: movie.runtime,
    sizeOnDisk: movie.sizeOnDisk,
    tags: movie.tags ?? [],
    overview: truncateOverview(movie.overview),
  };
}

export interface QueueSummary {
  id: number;
  title: string;
  status: string;
  trackedDownloadState?: string;
  percentComplete: number;
  timeleft?: string;
  indexer?: string;
  downloadClient?: string;
  errorMessage?: string;
  statusMessages?: string[];
}

export function summarizeQueueRecord(record: QueueRecord): QueueSummary {
  const percentComplete =
    record.size > 0 ? Math.round(((record.size - record.sizeleft) / record.size) * 100) : 0;
  const statusMessages = record.statusMessages?.flatMap((entry) => entry.messages);

  return {
    id: record.id,
    title: record.title,
    status: record.status,
    trackedDownloadState: record.trackedDownloadState,
    percentComplete,
    timeleft: record.timeleft,
    indexer: record.indexer,
    downloadClient: record.downloadClient,
    errorMessage: record.errorMessage,
    statusMessages: statusMessages?.length ? statusMessages : undefined,
  };
}
```

- [ ] **Step 4: Write the failing tools test**

`test/radarr/tools.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { RadarrClient } from '../../src/radarr/client.js';
import { createRadarrTools } from '../../src/radarr/tools.js';

function toolsFor(overrides: Partial<RadarrClient>) {
  const tools = createRadarrTools(overrides as RadarrClient);
  return (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  };
}

const movie = {
  id: 1,
  title: 'Dune',
  year: 2021,
  status: 'released',
  monitored: true,
  hasFile: false,
  qualityProfileId: 1,
  tmdbId: 438631,
  tags: [],
};

describe('createRadarrTools', () => {
  it('registers all 24 tools with unique radarr_ prefixed names', () => {
    const names = createRadarrTools({} as RadarrClient).map((t) => t.name);
    expect(names).toHaveLength(24);
    expect(names.every((n) => n.startsWith('radarr_'))).toBe(true);
    expect(new Set(names).size).toBe(24);
  });

  it('summarises the movie list', async () => {
    const get = toolsFor({ listMovies: vi.fn().mockResolvedValue([movie]) });
    const result = (await get('radarr_list_movies').handler({})) as unknown[];
    expect(result).toEqual([expect.objectContaining({ id: 1, title: 'Dune' })]);
  });

  it('returns the full record from get_movie', async () => {
    const getMovie = vi.fn().mockResolvedValue({ id: 4, title: 'Arrival', path: '/movies' });
    const get = toolsFor({ getMovie });
    await expect(get('radarr_get_movie').handler({ movieId: 4 })).resolves.toMatchObject({ id: 4 });
    expect(getMovie).toHaveBeenCalledWith(4);
  });

  it('maps searchForMovie into addOptions', async () => {
    const addMovie = vi.fn().mockResolvedValue(movie);
    const get = toolsFor({ addMovie });
    await get('radarr_add_movie').handler({
      title: 'Dune',
      tmdbId: 438631,
      qualityProfileId: 1,
      rootFolderPath: '/movies',
      searchForMovie: true,
    });
    expect(addMovie).toHaveBeenCalledWith(
      expect.objectContaining({ addOptions: { searchForMovie: true } }),
    );
  });

  it('defaults delete_movie to keeping files', async () => {
    const deleteMovie = vi.fn().mockResolvedValue(undefined);
    const get = toolsFor({ deleteMovie });
    await get('radarr_delete_movie').handler({ movieId: 2 });
    expect(deleteMovie).toHaveBeenCalledWith(2, { deleteFiles: false, addImportExclusion: false });
  });

  it('restricts run_command to supported command names', () => {
    const tool = createRadarrTools({} as RadarrClient).find((t) => t.name === 'radarr_run_command');
    const shape = tool?.inputSchema as { name: { parse: (v: unknown) => unknown } };
    expect(() => shape.name.parse('MoviesSearch')).not.toThrow();
    expect(() => shape.name.parse('Nope')).toThrow();
  });

  it('propagates client errors', async () => {
    const get = toolsFor({ listMovies: vi.fn().mockRejectedValue(new Error('down')) });
    await expect(get('radarr_list_movies').handler({})).rejects.toThrow('down');
  });
});
```

- [ ] **Step 5: Run and verify failure**

Run: `npx vitest run test/radarr/tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement `src/radarr/tools.ts`**

The representative tools below establish the pattern; write the rest of the 24
as direct delegations to the client method from the Task 7 table, summarising
in list tools and returning raw records from `get`-by-id tools.

```ts
import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { RadarrClient } from './client.js';
import { summarizeMovie, summarizeQueueRecord } from './shape.js';

const COMMAND_NAMES = [
  'MoviesSearch',
  'MissingMoviesSearch',
  'RefreshMovie',
  'RescanMovie',
  'RenameFiles',
  'DownloadedMoviesScan',
] as const;

const page = {
  page: z.number().int().min(1).optional().describe('Page number, starting at 1'),
  pageSize: z.number().int().min(1).max(200).optional().describe('Records per page (default 20)'),
};

export function createRadarrTools(client: RadarrClient): ToolDefinition[] {
  return [
    defineTool({
      name: 'radarr_list_movies',
      description:
        'List all movies in the Radarr library, summarised. Returns id, title, year, ' +
        'monitored state and whether a file exists. Use radarr_get_movie for the full record.',
      inputSchema: {},
      handler: async () => (await client.listMovies()).map(summarizeMovie),
    }),

    defineTool({
      name: 'radarr_get_movie',
      description: 'Get the full Radarr record for one movie.',
      inputSchema: { movieId: z.number().int().describe('Radarr movie id') },
      handler: ({ movieId }) => client.getMovie(movieId),
    }),

    defineTool({
      name: 'radarr_lookup_movie',
      description:
        'Search TMDB for movies matching a search term. Use this to find the tmdbId needed ' +
        'by radarr_add_movie. Does not modify the library.',
      inputSchema: { term: z.string().min(1).describe('Movie title to search for') },
      handler: async ({ term }) => (await client.lookupMovie(term)).map(summarizeMovie),
    }),

    defineTool({
      name: 'radarr_add_movie',
      description:
        'Add a new movie to Radarr. Get tmdbId from radarr_lookup_movie, qualityProfileId ' +
        'from radarr_list_quality_profiles, and rootFolderPath from radarr_list_root_folders.',
      inputSchema: {
        title: z.string().describe('Movie title'),
        tmdbId: z.number().int().describe('TMDB id, from radarr_lookup_movie'),
        qualityProfileId: z.number().int().describe('From radarr_list_quality_profiles'),
        rootFolderPath: z.string().describe('From radarr_list_root_folders'),
        monitored: z.boolean().optional().describe('Monitor the movie (default true)'),
        minimumAvailability: z
          .enum(['tba', 'announced', 'inCinemas', 'released'])
          .optional()
          .describe('When Radarr may start searching (default released)'),
        searchForMovie: z.boolean().optional().describe('Search immediately (default false)'),
        tags: z.array(z.number().int()).optional().describe('Tag ids from radarr_list_tags'),
      },
      handler: async (args) => {
        const added = await client.addMovie({
          title: args.title,
          tmdbId: args.tmdbId,
          qualityProfileId: args.qualityProfileId,
          rootFolderPath: args.rootFolderPath,
          monitored: args.monitored ?? true,
          minimumAvailability: args.minimumAvailability ?? 'released',
          tags: args.tags,
          addOptions: { searchForMovie: args.searchForMovie ?? false },
        });
        return summarizeMovie(added);
      },
    }),

    defineTool({
      name: 'radarr_delete_movie',
      description:
        'Remove a movie from Radarr. Destructive: set deleteFiles to true only when the user ' +
        'has explicitly asked for the file on disk to be deleted too.',
      inputSchema: {
        movieId: z.number().int().describe('Radarr movie id'),
        deleteFiles: z.boolean().optional().describe('Also delete the movie file (default false)'),
        addImportExclusion: z
          .boolean()
          .optional()
          .describe('Prevent lists re-adding it (default false)'),
      },
      handler: async ({ movieId, deleteFiles, addImportExclusion }) => {
        await client.deleteMovie(movieId, {
          deleteFiles: deleteFiles ?? false,
          addImportExclusion: addImportExclusion ?? false,
        });
        return undefined;
      },
    }),

    defineTool({
      name: 'radarr_get_queue',
      description:
        'List items currently downloading or awaiting import, with percent complete and any ' +
        'error messages. Use this to diagnose stuck or failed downloads.',
      inputSchema: { ...page },
      handler: async (args) => {
        const queue = await client.getQueue(args);
        return { ...queue, records: queue.records.map(summarizeQueueRecord) };
      },
    }),

    defineTool({
      name: 'radarr_run_command',
      description:
        'Trigger a Radarr background command, for example searching for a movie or rescanning ' +
        'its folder. Returns a command id; poll it with radarr_get_command.',
      inputSchema: {
        name: z.enum(COMMAND_NAMES).describe('Command to run'),
        movieIds: z.array(z.number().int()).optional().describe('Target movie ids'),
      },
      handler: (args) => client.runCommand(args),
    }),

    // Remaining tools, each delegating to the client method from the Task 7
    // table: radarr_update_movie, radarr_list_movie_files,
    // radarr_delete_movie_file, radarr_get_calendar, radarr_delete_queue_item,
    // radarr_get_history, radarr_get_wanted_missing, radarr_get_blocklist,
    // radarr_delete_blocklist_item, radarr_list_collections,
    // radarr_get_command, radarr_list_quality_profiles,
    // radarr_list_root_folders, radarr_list_tags, radarr_get_system_status,
    // radarr_get_health, radarr_get_disk_space.
  ];
}
```

Replace the trailing comment with the real definitions before committing — the
length assertion in the test requires all 24.

- [ ] **Step 7: Run the tests**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add radarr mcp tools with response shaping"
```

---

### Task 9: Prowlarr client and tools

**Files:**
- Create: `src/prowlarr/types.ts`, `src/prowlarr/client.ts`, `src/prowlarr/shape.ts`, `src/prowlarr/tools.ts`
- Test: `test/prowlarr/client.test.ts`, `test/prowlarr/tools.test.ts`

**Interfaces:**
- Consumes: `createArrClient` from `src/http/client.js`; `defineTool`, `ToolDefinition` from `src/mcp/types.js`.
- Produces:
  ```ts
  export function createProwlarrClient(config: InstanceConfig): ProwlarrClient
  export function summarizeRelease(release: Release): ReleaseSummary
  export function createProwlarrTools(client: ProwlarrClient): ToolDefinition[]
  ```

Prowlarr uses `/api/v1`, not `/api/v3`. Client and tools land in one task
because the surface is roughly half the size of the media products'.

| Method | HTTP | Path | Query / body |
| --- | --- | --- | --- |
| `search(opts)` | GET | `/search` | `query`, `indexerIds`, `categories`, `type`, `limit`, `offset` |
| `grabRelease(payload)` | POST | `/search` | body = `{ guid, indexerId }` |
| `listIndexers()` | GET | `/indexer` | — |
| `getIndexer(id)` | GET | `/indexer/{id}` | — |
| `testIndexer(indexer)` | POST | `/indexer/test` | body = full indexer record |
| `getIndexerStats()` | GET | `/indexerstats` | — |
| `getIndexerStatus()` | GET | `/indexerstatus` | — |
| `listCategories()` | GET | `/indexer/categories` | — |
| `getHistory(opts)` | GET | `/history` | `page`, `pageSize`, `eventType` |
| `listApplications()` | GET | `/applications` | — |
| `listDownloadClients()` | GET | `/downloadclient` | — |
| `runCommand(payload)` | POST | `/command` | body = `{ name }` |
| `getSystemStatus()` | GET | `/system/status` | — |
| `getHealth()` | GET | `/health` | — |

The 14 tools map 1:1 onto these methods, named `prowlarr_search`,
`prowlarr_grab_release`, `prowlarr_list_indexers`, `prowlarr_get_indexer`,
`prowlarr_test_indexer`, `prowlarr_get_indexer_stats`,
`prowlarr_get_indexer_status`, `prowlarr_list_categories`,
`prowlarr_get_history`, `prowlarr_list_applications`,
`prowlarr_list_download_clients`, `prowlarr_run_command`,
`prowlarr_get_system_status`, `prowlarr_get_health`.

- [ ] **Step 1: Write `src/prowlarr/types.ts`**

```ts
export interface PagedResponse<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}

export interface Release {
  guid: string;
  title: string;
  indexer: string;
  indexerId: number;
  size: number;
  seeders?: number;
  leechers?: number;
  publishDate: string;
  protocol: string;
  downloadUrl?: string;
  infoUrl?: string;
  categories?: Array<{ id: number; name: string }>;
  grabs?: number;
}

export interface Indexer {
  id: number;
  name: string;
  protocol: string;
  enable: boolean;
  priority: number;
  privacy?: string;
  appProfileId?: number;
  tags?: number[];
  capabilities?: { categories?: Array<{ id: number; name: string }> };
}

export interface IndexerStats {
  indexers?: Array<{
    indexerId: number;
    indexerName: string;
    numberOfQueries: number;
    numberOfGrabs: number;
    numberOfFailedQueries: number;
    numberOfFailedGrabs: number;
    averageResponseTime: number;
  }>;
}

export interface IndexerStatus {
  id: number;
  indexerId: number;
  disabledTill?: string;
  mostRecentFailure?: string;
  initialFailure?: string;
}

export interface IndexerCategory {
  id: number;
  name: string;
  subCategories?: Array<{ id: number; name: string }>;
}

export interface HistoryRecord {
  id: number;
  indexerId: number;
  eventType: string;
  date: string;
  successful?: boolean;
  data?: Record<string, string>;
}

export interface Application {
  id: number;
  name: string;
  syncLevel: string;
  implementation: string;
  tags?: number[];
}

export interface DownloadClient {
  id: number;
  name: string;
  enable: boolean;
  protocol: string;
  priority: number;
  implementation: string;
}

export interface CommandResource {
  id: number;
  name: string;
  status: string;
  message?: string;
}

export interface SystemStatus {
  appName: string;
  version: string;
  osName?: string;
  isDocker?: boolean;
  startTime?: string;
}

export interface HealthCheck {
  source: string;
  type: string;
  message: string;
  wikiUrl?: string;
}
```

- [ ] **Step 2: Write the failing client tests**

`test/prowlarr/client.test.ts`:

```ts
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createProwlarrClient } from '../../src/prowlarr/client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = createProwlarrClient({ baseUrl: 'http://prowlarr.test:9696', apiKey: 'k' });
const url = (path: string) => `http://prowlarr.test:9696/api/v1${path}`;

describe('ProwlarrClient', () => {
  it('uses the v1 api base', async () => {
    server.use(http.get(url('/indexer'), () => HttpResponse.json([{ id: 1, name: 'nzbgeek' }])));
    await expect(client.listIndexers()).resolves.toHaveLength(1);
  });

  it('searches with query, indexer ids and categories', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get(url('/search'), ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );

    await client.search({ query: 'dune', indexerIds: [1, 2], categories: [2000], limit: 50 });

    expect(params?.get('query')).toBe('dune');
    expect(params?.getAll('indexerIds')).toEqual(['1', '2']);
    expect(params?.getAll('categories')).toEqual(['2000']);
    expect(params?.get('limit')).toBe('50');
  });

  it('grabs a release by guid and indexer id', async () => {
    let body: unknown;
    server.use(
      http.post(url('/search'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    await client.grabRelease({ guid: 'abc', indexerId: 3 });
    expect(body).toEqual({ guid: 'abc', indexerId: 3 });
  });

  it('reads indexer stats and status', async () => {
    server.use(
      http.get(url('/indexerstats'), () => HttpResponse.json({ indexers: [] })),
      http.get(url('/indexerstatus'), () => HttpResponse.json([])),
    );
    await expect(client.getIndexerStats()).resolves.toEqual({ indexers: [] });
    await expect(client.getIndexerStatus()).resolves.toEqual([]);
  });

  it('reads history as a paged response', async () => {
    server.use(
      http.get(url('/history'), () =>
        HttpResponse.json({ page: 1, pageSize: 20, totalRecords: 0, records: [] }),
      ),
    );
    await expect(client.getHistory({ page: 1 })).resolves.toMatchObject({ totalRecords: 0 });
  });

  it('lists applications and download clients', async () => {
    server.use(
      http.get(url('/applications'), () => HttpResponse.json([{ id: 1, name: 'Sonarr' }])),
      http.get(url('/downloadclient'), () => HttpResponse.json([{ id: 2, name: 'sab' }])),
    );
    await expect(client.listApplications()).resolves.toHaveLength(1);
    await expect(client.listDownloadClients()).resolves.toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run and verify failure**

Run: `npx vitest run test/prowlarr/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/prowlarr/client.ts`**

```ts
import type { InstanceConfig } from '../config.js';
import { createArrClient } from '../http/client.js';
import type {
  Application,
  CommandResource,
  DownloadClient,
  HealthCheck,
  HistoryRecord,
  Indexer,
  IndexerCategory,
  IndexerStats,
  IndexerStatus,
  PagedResponse,
  Release,
  SystemStatus,
} from './types.js';

export interface SearchOptions {
  query: string;
  indexerIds?: number[];
  categories?: number[];
  type?: string;
  limit?: number;
  offset?: number;
}

export interface GrabPayload {
  guid: string;
  indexerId: number;
}

export interface HistoryOptions {
  page?: number;
  pageSize?: number;
  eventType?: number;
}

export interface ProwlarrClient {
  search(options: SearchOptions): Promise<Release[]>;
  grabRelease(payload: GrabPayload): Promise<unknown>;
  listIndexers(): Promise<Indexer[]>;
  getIndexer(id: number): Promise<Indexer>;
  testIndexer(indexer: Indexer): Promise<unknown>;
  getIndexerStats(): Promise<IndexerStats>;
  getIndexerStatus(): Promise<IndexerStatus[]>;
  listCategories(): Promise<IndexerCategory[]>;
  getHistory(options?: HistoryOptions): Promise<PagedResponse<HistoryRecord>>;
  listApplications(): Promise<Application[]>;
  listDownloadClients(): Promise<DownloadClient[]>;
  runCommand(payload: { name: string }): Promise<CommandResource>;
  getSystemStatus(): Promise<SystemStatus>;
  getHealth(): Promise<HealthCheck[]>;
}

export function createProwlarrClient(config: InstanceConfig): ProwlarrClient {
  const http = createArrClient({
    product: 'Prowlarr',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    apiBase: '/api/v1',
  });

  return {
    search: (options) => http.get('/search', { ...options }),
    grabRelease: (payload) => http.post('/search', payload),
    listIndexers: () => http.get('/indexer'),
    getIndexer: (id) => http.get(`/indexer/${id}`),
    testIndexer: (indexer) => http.post('/indexer/test', indexer),
    getIndexerStats: () => http.get('/indexerstats'),
    getIndexerStatus: () => http.get('/indexerstatus'),
    listCategories: () => http.get('/indexer/categories'),
    getHistory: (options) => http.get('/history', { ...options }),
    listApplications: () => http.get('/applications'),
    listDownloadClients: () => http.get('/downloadclient'),
    runCommand: (payload) => http.post('/command', payload),
    getSystemStatus: () => http.get('/system/status'),
    getHealth: () => http.get('/health'),
  };
}
```

- [ ] **Step 5: Implement `src/prowlarr/shape.ts`**

```ts
import type { Release } from './types.js';

export interface ReleaseSummary {
  guid: string;
  title: string;
  indexer: string;
  indexerId: number;
  sizeGb: number;
  seeders?: number;
  leechers?: number;
  publishDate: string;
  protocol: string;
  categories?: string[];
}

export function summarizeRelease(release: Release): ReleaseSummary {
  return {
    guid: release.guid,
    title: release.title,
    indexer: release.indexer,
    indexerId: release.indexerId,
    sizeGb: Math.round((release.size / 1024 ** 3) * 100) / 100,
    seeders: release.seeders,
    leechers: release.leechers,
    publishDate: release.publishDate,
    protocol: release.protocol,
    categories: release.categories?.map((category) => category.name),
  };
}
```

- [ ] **Step 6: Write the failing tools test**

`test/prowlarr/tools.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ProwlarrClient } from '../../src/prowlarr/client.js';
import { createProwlarrTools } from '../../src/prowlarr/tools.js';

function toolsFor(overrides: Partial<ProwlarrClient>) {
  const tools = createProwlarrTools(overrides as ProwlarrClient);
  return (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  };
}

describe('createProwlarrTools', () => {
  it('registers all 14 tools with unique prowlarr_ prefixed names', () => {
    const names = createProwlarrTools({} as ProwlarrClient).map((t) => t.name);
    expect(names).toHaveLength(14);
    expect(names.every((n) => n.startsWith('prowlarr_'))).toBe(true);
    expect(new Set(names).size).toBe(14);
  });

  it('summarises search results with size in gigabytes', async () => {
    const search = vi.fn().mockResolvedValue([
      {
        guid: 'g1',
        title: 'Dune.2021.2160p',
        indexer: 'nzbgeek',
        indexerId: 1,
        size: 1024 ** 3 * 5,
        seeders: 20,
        publishDate: '2026-01-01T00:00:00Z',
        protocol: 'usenet',
        categories: [{ id: 2000, name: 'Movies' }],
      },
    ]);
    const get = toolsFor({ search });
    const result = (await get('prowlarr_search').handler({ query: 'dune' })) as Array<{
      sizeGb: number;
      categories?: string[];
    }>;
    expect(result[0]?.sizeGb).toBe(5);
    expect(result[0]?.categories).toEqual(['Movies']);
  });

  it('grabs a release by guid and indexer id', async () => {
    const grabRelease = vi.fn().mockResolvedValue({});
    const get = toolsFor({ grabRelease });
    await get('prowlarr_grab_release').handler({ guid: 'g1', indexerId: 1 });
    expect(grabRelease).toHaveBeenCalledWith({ guid: 'g1', indexerId: 1 });
  });

  it('requires a non-empty search query', () => {
    const tool = createProwlarrTools({} as ProwlarrClient).find((t) => t.name === 'prowlarr_search');
    const shape = tool?.inputSchema as { query: { parse: (v: unknown) => unknown } };
    expect(() => shape.query.parse('')).toThrow();
  });

  it('propagates client errors', async () => {
    const get = toolsFor({ listIndexers: vi.fn().mockRejectedValue(new Error('down')) });
    await expect(get('prowlarr_list_indexers').handler({})).rejects.toThrow('down');
  });
});
```

- [ ] **Step 7: Run and verify failure**

Run: `npx vitest run test/prowlarr/tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement `src/prowlarr/tools.ts`**

The representative tools below establish the pattern; write the remaining ones
as direct delegations to the client method from the table above.

```ts
import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../mcp/types.js';
import type { ProwlarrClient } from './client.js';
import { summarizeRelease } from './shape.js';

export function createProwlarrTools(client: ProwlarrClient): ToolDefinition[] {
  return [
    defineTool({
      name: 'prowlarr_search',
      description:
        'Search configured indexers for releases. Returns release guids that can be handed to ' +
        'prowlarr_grab_release. Use prowlarr_list_indexers and prowlarr_list_categories to ' +
        'find the ids for the optional filters.',
      inputSchema: {
        query: z.string().min(1).describe('Search term'),
        indexerIds: z
          .array(z.number().int())
          .optional()
          .describe('Restrict to these indexer ids (default: all enabled)'),
        categories: z
          .array(z.number().int())
          .optional()
          .describe('Restrict to these newznab category ids, e.g. 2000 for movies'),
        limit: z.number().int().min(1).max(200).optional().describe('Max results (default 100)'),
      },
      handler: async (args) => (await client.search(args)).map(summarizeRelease),
    }),

    defineTool({
      name: 'prowlarr_grab_release',
      description:
        'Send a release to the download client configured in Prowlarr. Get guid and indexerId ' +
        'from prowlarr_search.',
      inputSchema: {
        guid: z.string().min(1).describe('Release guid from prowlarr_search'),
        indexerId: z.number().int().describe('Indexer id from prowlarr_search'),
      },
      handler: ({ guid, indexerId }) => client.grabRelease({ guid, indexerId }),
    }),

    defineTool({
      name: 'prowlarr_list_indexers',
      description: 'List configured indexers with their protocol, priority and enabled state.',
      inputSchema: {},
      handler: () => client.listIndexers(),
    }),

    // Remaining tools, each delegating to the client method from the table
    // above: prowlarr_get_indexer, prowlarr_test_indexer,
    // prowlarr_get_indexer_stats, prowlarr_get_indexer_status,
    // prowlarr_list_categories, prowlarr_get_history,
    // prowlarr_list_applications, prowlarr_list_download_clients,
    // prowlarr_run_command, prowlarr_get_system_status, prowlarr_get_health.
  ];
}
```

Replace the trailing comment with the real definitions before committing — the
length assertion in the test requires all 14.

- [ ] **Step 9: Run the tests**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add prowlarr client and mcp tools"
```

---

### Task 10: Entrypoint wiring

**Files:**
- Create: `src/tools.ts`, `src/index.ts`
- Test: `test/tools.test.ts`

**Interfaces:**
- Consumes: `loadConfig`/`ServarrConfig` from `src/config.js`; the three `create*Client` and `create*Tools` functions; `createServer`, `startStdio`, `startHttp`.
- Produces:
  ```ts
  // src/tools.ts
  export function buildTools(config: ServarrConfig): ToolDefinition[]
  ```

`buildTools` is separated from `index.ts` so product enablement is testable
without starting a transport or touching `process.env`.

- [ ] **Step 1: Write the failing test**

`test/tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ServarrConfig } from '../src/config.js';
import { buildTools } from '../src/tools.js';

const instance = { baseUrl: 'http://localhost', apiKey: 'k' };
const base: ServarrConfig = { transport: 'stdio', port: 3000 };

describe('buildTools', () => {
  it('registers only the configured products', () => {
    const names = buildTools({ ...base, sonarr: instance }).map((t) => t.name);
    expect(names.some((n) => n.startsWith('sonarr_'))).toBe(true);
    expect(names.some((n) => n.startsWith('radarr_'))).toBe(false);
    expect(names.some((n) => n.startsWith('prowlarr_'))).toBe(false);
  });

  it('registers every product when all three are configured', () => {
    const names = buildTools({
      ...base,
      sonarr: instance,
      radarr: instance,
      prowlarr: instance,
    }).map((t) => t.name);

    expect(names.filter((n) => n.startsWith('sonarr_'))).toHaveLength(26);
    expect(names.filter((n) => n.startsWith('radarr_'))).toHaveLength(24);
    expect(names.filter((n) => n.startsWith('prowlarr_'))).toHaveLength(14);
  });

  it('produces globally unique tool names', () => {
    const names = buildTools({
      ...base,
      sonarr: instance,
      radarr: instance,
      prowlarr: instance,
    }).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('registers a partial stack without the missing product', () => {
    const names = buildTools({ ...base, sonarr: instance, prowlarr: instance }).map((t) => t.name);
    expect(names.some((n) => n.startsWith('prowlarr_'))).toBe(true);
    expect(names.some((n) => n.startsWith('radarr_'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run test/tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools.ts`**

```ts
import type { ServarrConfig } from './config.js';
import type { ToolDefinition } from './mcp/types.js';
import { createProwlarrClient } from './prowlarr/client.js';
import { createProwlarrTools } from './prowlarr/tools.js';
import { createRadarrClient } from './radarr/client.js';
import { createRadarrTools } from './radarr/tools.js';
import { createSonarrClient } from './sonarr/client.js';
import { createSonarrTools } from './sonarr/tools.js';

export function buildTools(config: ServarrConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  if (config.sonarr) tools.push(...createSonarrTools(createSonarrClient(config.sonarr)));
  if (config.radarr) tools.push(...createRadarrTools(createRadarrClient(config.radarr)));
  if (config.prowlarr) tools.push(...createProwlarrTools(createProwlarrClient(config.prowlarr)));

  return tools;
}
```

- [ ] **Step 4: Implement `src/index.ts`**

```ts
#!/usr/bin/env node
import { ConfigError, loadConfig } from './config.js';
import { createServer } from './mcp/server.js';
import { startHttp, startStdio } from './mcp/transport.js';
import { buildTools } from './tools.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const tools = buildTools(config);

  const enabled = [
    config.sonarr && 'Sonarr',
    config.radarr && 'Radarr',
    config.prowlarr && 'Prowlarr',
  ].filter(Boolean);

  // stdout carries the MCP protocol on the stdio transport, so log to stderr.
  console.error(`servarr-mcp: ${tools.length} tools from ${enabled.join(', ')}`);

  if (config.transport === 'http' || config.transport === 'both') {
    await startHttp(() => createServer(tools), {
      port: config.port,
      token: config.token as string,
    });
    console.error(`servarr-mcp: http transport listening on port ${config.port}`);
  }

  if (config.transport === 'stdio' || config.transport === 'both') {
    await startStdio(createServer(tools));
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`servarr-mcp: ${error.message}`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 5: Run the full suite and build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all green, `dist/index.js` produced.

- [ ] **Step 6: Verify the server starts and lists its tools**

```bash
SONARR_URL=http://localhost:8989 SONARR_API_KEY=fake \
  node -e "
    const { spawn } = require('node:child_process');
    const p = spawn('node', ['dist/index.js'], { stdio: ['pipe','pipe','inherit'] });
    p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'x',version:'1'}}})+'\n');
    p.stdout.once('data', () => {
      p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');
      p.stdout.once('data', (d) => { console.log(JSON.parse(d.toString()).result.tools.length + ' tools'); p.kill(); });
    });
  "
```

Expected: prints `26 tools`. No arr instance is contacted — `tools/list` does
not call any handler.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire configuration, tools and transports into the entrypoint"
```

---

### Task 11: Packaging and documentation

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `README.md`, `LICENSE`
- Modify: `package.json` (add `files`, `prepublishOnly`)

**Interfaces:**
- Consumes: the working server from Task 10.
- Produces: no code interfaces; this task makes the project installable and documented.

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
ENV SERVARR_MCP_TRANSPORT=http
CMD ["node", "dist/index.js"]
```

`.dockerignore`:

```
node_modules
dist
test
docs
.git
*.log
```

- [ ] **Step 2: Add packaging metadata**

```bash
npm pkg set files[0]="dist"
npm pkg set scripts.prepublishOnly="npm run build"
npm pkg set repository.type="git"
npm pkg set repository.url="git+https://github.com/jfms7s/servarr-mcp.git"
npm pkg set keywords[0]="mcp" keywords[1]="sonarr" keywords[2]="radarr" keywords[3]="prowlarr"
```

- [ ] **Step 3: Write `README.md`**

Written for someone who runs an arr stack and wants to point an MCP client at
it — not for a contributor. It must contain, in this order:

1. One-paragraph description and the three supported products with their API versions.
2. **Install** — `npx servarr-mcp`, and the Docker alternative.
3. **Configuration** — the full env var table copied from the spec, noting that each product is independently optional.
4. **Claude Desktop / Claude Code setup** — a complete `mcpServers` JSON block:

```json
{
  "mcpServers": {
    "servarr": {
      "command": "npx",
      "args": ["-y", "servarr-mcp"],
      "env": {
        "SONARR_URL": "http://localhost:8989",
        "SONARR_API_KEY": "your-key",
        "RADARR_URL": "http://localhost:7878",
        "RADARR_API_KEY": "your-key",
        "PROWLARR_URL": "http://localhost:9696",
        "PROWLARR_API_KEY": "your-key"
      }
    }
  }
}
```

5. **Remote/HTTP deployment** — setting `SERVARR_MCP_TRANSPORT=http` and `SERVARR_MCP_TOKEN`, plus an explicit warning that the HTTP transport has one shared bearer token and full write access to the arr stack, so it belongs behind a VPN or reverse proxy, never on the open internet.
6. **Tools** — a table of all 64 tool names grouped by product, one line of purpose each.
7. **Where to find your API key** — Settings → General → API Key in each app's web UI.
8. **Development** — `npm test`, `npm run lint`, `npm run build`.

- [ ] **Step 4: Add the MIT LICENSE file**

Standard MIT text, copyright holder `jfms7s`, year 2026.

- [ ] **Step 5: Verify the package contents and the image build**

Run:
```bash
npm pack --dry-run
docker build -t servarr-mcp:test .
```
Expected: the tarball contains only `dist/`, `package.json`, `README.md` and
`LICENSE`; the image builds clean.

- [ ] **Step 6: Final verification**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: add readme, license and docker packaging"
```

---

## Verification checklist

Before considering the plan complete, all of the following must hold:

- [ ] `npm test` passes with no skipped tests
- [ ] `npm run lint` and `npm run typecheck` are clean
- [ ] `npm run build` emits `dist/index.js`
- [ ] `buildTools` returns 64 tools when all three products are configured (26 Sonarr + 24 Radarr + 14 Prowlarr)
- [ ] Every tool name is unique and carries its product prefix
- [ ] No API key or bearer token appears in any error message, log line or tool response
- [ ] The HTTP transport rejects requests with a missing or wrong bearer token
- [ ] Starting with no product configured fails with an actionable message
