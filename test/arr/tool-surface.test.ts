// Guards the Sonarr and Radarr tool surface while their shared tools are built from src/arr:
// name, order, effect, description and the full input JSON Schema of every tool must not change.
// A deliberate change updates the snapshot with `npx vitest run -u test/arr/tool-surface.test.ts`.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ServarrConfig } from '../../src/config.js';
import { buildTools } from '../../src/tools.js';

const instance = { baseUrl: 'http://localhost', apiKey: 'k' };
const base: ServarrConfig = { transport: 'stdio', port: 3000, host: '127.0.0.1' };

function surface(product: 'sonarr' | 'radarr') {
  return buildTools({ ...base, [product]: instance }).map((tool) => ({
    name: tool.name,
    effect: tool.effect,
    description: tool.description,
    input: z.toJSONSchema(z.object(tool.inputSchema)),
  }));
}

describe('arr tool surface', () => {
  it('keeps every Sonarr tool as it is', () => {
    expect(surface('sonarr')).toMatchSnapshot();
  });

  it('keeps every Radarr tool as it is', () => {
    expect(surface('radarr')).toMatchSnapshot();
  });
});
