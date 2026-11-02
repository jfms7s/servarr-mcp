#!/usr/bin/env node
// Regenerates test/fixtures/<product>/*.json from the upstream OpenAPI specs.
//
// Each fixture holds two synthetic records in which every property the upstream schema
// declares is filled in. The shape tests run them through the summarisers: a summary field
// that comes out undefined means our code reads a name upstream doesn't declare.
// This catches declared-name drift only, not which fields a real instance fills.
//
// Usage: node scripts/fixtures/generate.mjs <specs-dir>
// <specs-dir> holds the specs named in SPECS below, saved as JSON. To refresh them:
//   gh api "repos/Sonarr/Sonarr/contents/src/Sonarr.Api.V3/openapi.json?ref=<tag>" \
//     -H "Accept: application/vnd.github.raw" > sonarr.json
//   gh api "repos/Radarr/Radarr/contents/src/Radarr.Api.V3/openapi.json?ref=<tag>" ... > radarr.json
//   gh api "repos/Prowlarr/Prowlarr/contents/src/Prowlarr.Api.V1/openapi.json?ref=<tag>" ... > prowlarr.json
//   gh api "repos/seerr-team/seerr/contents/seerr-api.yml?ref=<tag>" ... > seerr.yml
//   npx js-yaml seerr.yml > seerr.json
// then update the versions in SPECS and rerun. Generated files are formatted by Prettier.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPECS = {
  sonarr: { file: 'sonarr.json', version: 'Sonarr v4.0.20.3014 (src/Sonarr.Api.V3/openapi.json)' },
  radarr: { file: 'radarr.json', version: 'Radarr v6.4.4.10685 (src/Radarr.Api.V3/openapi.json)' },
  prowlarr: {
    file: 'prowlarr.json',
    version: 'Prowlarr v2.7.0.5723 (src/Prowlarr.Api.V1/openapi.json)',
  },
  overseerr: { file: 'seerr.json', version: 'Seerr v3.5.1 (seerr-api.yml)' },
};

const TARGETS = [
  { product: 'sonarr', name: 'series', schema: 'SeriesResource', endpoint: 'GET /api/v3/series' },
  { product: 'sonarr', name: 'episode', schema: 'EpisodeResource', endpoint: 'GET /api/v3/episode' },
  { product: 'sonarr', name: 'queue', schema: 'QueueResource', endpoint: 'GET /api/v3/queue' },
  { product: 'radarr', name: 'movie', schema: 'MovieResource', endpoint: 'GET /api/v3/movie' },
  { product: 'radarr', name: 'queue', schema: 'QueueResource', endpoint: 'GET /api/v3/queue' },
  {
    product: 'prowlarr',
    name: 'indexer',
    schema: 'IndexerResource',
    endpoint: 'GET /api/v1/indexer',
  },
  { product: 'overseerr', name: 'request', schema: 'MediaRequest', endpoint: 'GET /api/v1/request' },
  {
    product: 'overseerr',
    name: 'movie',
    schema: 'MovieDetails',
    endpoint: 'GET /api/v1/movie/{movieId}',
  },
];

const RECORDS = 2;
const MAX_DEPTH = 4;

function resolve(spec, schema) {
  let current = schema;
  while (current && current.$ref) {
    current = current.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((node, key) => node[key], spec);
  }
  return current ?? {};
}

function example(spec, raw, name, index, depth) {
  const schema = resolve(spec, raw);
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    if (!schema[key]) continue;
    const parts = key === 'allOf' ? schema[key] : schema[key].slice(0, 1);
    const merged = {};
    for (const part of parts) Object.assign(merged, example(spec, part, name, index, depth));
    return merged;
  }
  if (schema.enum) return schema.enum[index % schema.enum.length];
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (schema.properties || type === 'object') {
    if (depth >= MAX_DEPTH) return {};
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [
        key,
        example(spec, value, key, index, depth + 1),
      ]),
    );
  }
  switch (type) {
    case 'array':
      return depth >= MAX_DEPTH ? [] : [example(spec, schema.items ?? {}, name, index, depth + 1)];
    case 'integer':
      return index + 1;
    case 'number':
      return index + 1.5;
    case 'boolean':
      return index % 2 === 0;
    case 'string':
      if (schema.format === 'date-time') return `2026-01-0${index + 1}T00:00:00Z`;
      if (schema.format === 'date') return `2026-01-0${index + 1}`;
      if (/path$/i.test(name)) return `/data/${name}-${index + 1}`;
      return `${name}-${index + 1}`;
    default:
      return `${name}-${index + 1}`;
  }
}

const [specsDir] = process.argv.slice(2);
if (!specsDir) {
  console.error('usage: node scripts/fixtures/generate.mjs <specs-dir>');
  process.exit(64);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const loaded = {};
for (const target of TARGETS) {
  const { file, version } = SPECS[target.product];
  loaded[file] ??= JSON.parse(readFileSync(join(specsDir, file), 'utf8'));
  const spec = loaded[file];
  if (!spec.components?.schemas?.[target.schema]) {
    throw new Error(`${file}: no schema ${target.schema}`);
  }
  const records = Array.from({ length: RECORDS }, (_, index) =>
    example(spec, { $ref: `#/components/schemas/${target.schema}` }, target.name, index, 0),
  );
  const fixture = {
    source: `${version}, schema ${target.schema}, for ${target.endpoint}; synthetic values`,
    records,
  };
  const out = join(root, 'test', 'fixtures', target.product, `${target.name}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
