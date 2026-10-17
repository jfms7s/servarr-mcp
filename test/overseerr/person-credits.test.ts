import { describe, expect, it, vi } from 'vitest';
import type { OverseerrClient } from '../../src/overseerr/client.js';
import { createOverseerrTools } from '../../src/overseerr/tools.js';

function creditsTool(credits: unknown) {
  const getPersonCredits = vi.fn().mockResolvedValue(credits);
  const tools = createOverseerrTools({ getPersonCredits } as Partial<OverseerrClient> as OverseerrClient);
  const tool = tools.find((t) => t.name === 'overseerr_get_person_credits');
  if (!tool) throw new Error('no overseerr_get_person_credits tool');
  return tool;
}

// Ids 1..n with dates that are not already in order, half movies (releaseDate)
// and half TV (firstAirDate), so the sort has to read both fields.
function roles(n: number, kind: 'cast' | 'crew') {
  return Array.from({ length: n }, (_, i) => {
    const id = i + 1;
    const year = 1950 + ((id * 37) % n);
    const date = `${year}-01-01`;
    return id % 2 === 0
      ? { id, mediaType: 'movie', title: `${kind} ${id}`, releaseDate: date }
      : { id, mediaType: 'tv', name: `${kind} ${id}`, firstAirDate: date };
  });
}

const dateOf = (r: { releaseDate?: string; firstAirDate?: string }) => r.releaseDate ?? r.firstAirDate ?? '';

describe('overseerr_get_person_credits', () => {
  it('returns at most 50 cast and 50 crew rows by default, newest first, with totals', async () => {
    const tool = creditsTool({ id: 7, cast: roles(170, 'cast'), crew: roles(80, 'crew') });
    const result = (await tool.handler({ personId: 7 })) as {
      id: number;
      castTotal: number;
      crewTotal: number;
      cast: Array<{ releaseDate?: string; firstAirDate?: string }>;
      crew: Array<{ releaseDate?: string; firstAirDate?: string }>;
    };
    expect(result).toMatchObject({ id: 7, castTotal: 170, crewTotal: 80 });
    expect(result.cast).toHaveLength(50);
    expect(result.crew).toHaveLength(50);
    const castDates = result.cast.map(dateOf);
    expect(castDates).toEqual([...castDates].sort().reverse());
    const allCastDates = roles(170, 'cast').map(dateOf).sort().reverse();
    expect(castDates[0]).toBe(allCastDates[0]);
  });

  it('honours an explicit limit and keeps undated credits last', async () => {
    const tool = creditsTool({
      id: 7,
      cast: [{ id: 1, title: 'Undated' }, ...roles(4, 'cast')],
      crew: [],
    });
    const result = (await tool.handler({ personId: 7, limit: 10 })) as {
      castTotal: number;
      cast: Array<{ id: number }>;
    };
    expect(result.castTotal).toBe(5);
    expect(result.cast).toHaveLength(5);
    expect(result.cast.at(-1)?.id).toBe(1);
    const limited = (await tool.handler({ personId: 7, limit: 2 })) as { cast: unknown[] };
    expect(limited.cast).toHaveLength(2);
  });
});
