import { readFileSync } from 'node:fs';

/**
 * Records from test/fixtures/<product>/<name>.json, generated from the upstream OpenAPI
 * schemas by scripts/fixtures/generate.mjs: every declared property is filled in, with
 * synthetic values. Typed by the caller; nothing checks the cast, which is the point of
 * the tests that use them.
 */
export function loadFixture<T>(product: string, name: string): T[] {
  const url = new URL(`./${product}/${name}.json`, import.meta.url);
  const fixture = JSON.parse(readFileSync(url, 'utf8')) as { source: string; records: T[] };
  return fixture.records;
}

/** Keys of a summary whose value is undefined: fields the schema does not declare. */
export function undefinedKeys(summary: object): string[] {
  return Object.entries(summary)
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);
}
