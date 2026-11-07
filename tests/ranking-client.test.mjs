import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRankingClient } from '../src/ranking-client.ts';
import { compactSnapshot, expandSnapshot } from '../shared/snapshot-wire.ts';

const position = { id: 'abcdef', callsign: 'FIN1', aircraftType: 'Airbus', latitude: 10, longitude: 20 };
const snapshot = { updatedAt: '2026-10-19T12:00:00Z', isStale: false, airborneCount: 1,
  airlines: [{ id: 'FIN', name: 'Finnair', count: 1, aircraftTypes: [{ name: 'Airbus', count: 1 }], positions: [position] }],
  unassignedAircraft: { count: 0, aircraftTypes: [], positions: [] },
  aircraftTypeRankings: [{ id: 'A320', name: 'Airbus', count: 1, operators: [{ id: 'FIN', count: 1 }], positions: [position] }],
  unknownAircraftType: { count: 0, operators: [], positions: [] },
};
const response = (value, etag) => new globalThis.Response(JSON.stringify(value), { headers: { ETag: etag } });

test('compact snapshots preserve both rankings and share the same position objects', () => {
  const compact = compactSnapshot(snapshot);
  assert.equal(compact.positions.length, 1);
  const expanded = expandSnapshot(JSON.parse(JSON.stringify(compact)));
  assert.deepEqual(expanded, snapshot);
  assert.equal(expanded.airlines[0].positions[0], expanded.aircraftTypeRankings[0].positions[0]);
  assert.deepEqual(expandSnapshot(compactSnapshot({ updatedAt: snapshot.updatedAt, isStale: false, airlines: [] })),
    { updatedAt: snapshot.updatedAt, isStale: false, airlines: [], unassignedAircraft: undefined, aircraftTypeRankings: undefined, unknownAircraftType: undefined });
});

test('compact snapshots reject invalid references and positions', () => {
  for (const indexes of [[-1], [1], [0.5], ['0'], [0, 0]]) {
    const compact = compactSnapshot(snapshot);
    compact.airlines[0].positionIndexes = indexes;
    assert.throws(() => expandSnapshot(compact));
  }
  const compact = compactSnapshot(snapshot);
  compact.positions = [{ ...position, latitude: 91 }];
  assert.throws(() => expandSnapshot(compact));
});

test('unchanged responses retain identity but metadata changes with the same timestamp are applied', async t => {
  const load = createRankingClient();
  const signal = new globalThis.AbortController().signal;
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'api/ranking-v2');
    assert.equal(options.headers['If-None-Match'], count === 0 ? undefined : 'one');
    count++;
    if (count === 2) return new globalThis.Response(null, { status: 304 });
    if (count === 3) return response('unparsed body', 'one');
    const next = globalThis.structuredClone(snapshot);
    if (count === 4) next.airlines[0].name = 'Updated name';
    return response(compactSnapshot(next), count === 4 ? 'two' : 'one');
  });
  const first = await load(signal);
  assert.equal(await load(signal), first);
  assert.equal(await load(signal), first);
  const changed = await load(signal);
  assert.notEqual(changed, first);
  assert.equal(changed.airlines[0].name, 'Updated name');
});

test('falls back during rollout then switches to compact data without reusing legacy ETags', async t => {
  const load = createRankingClient();
  let isPublished = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers['If-None-Match'], undefined);
    if (url === 'api/ranking') return response(snapshot, 'legacy');
    if (!isPublished) return new globalThis.Response(null, { status: 403 });
    return response(compactSnapshot(snapshot), 'compact');
  });
  const signal = new globalThis.AbortController().signal;
  assert.deepEqual(await load(signal), snapshot);
  isPublished = true;
  assert.deepEqual(await load(signal), snapshot);
});

test('invalid responses never replace the validated snapshot or its ETag', async t => {
  const load = createRankingClient();
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    count++;
    if (count > 1) assert.equal(options.headers['If-None-Match'], 'valid');
    if (count === 2) return response({}, 'invalid');
    if (count === 3) return new globalThis.Response(null, { status: 304 });
    return response(compactSnapshot(snapshot), 'valid');
  });
  const signal = new globalThis.AbortController().signal;
  const first = await load(signal);
  await assert.rejects(load(signal));
  assert.equal(await load(signal), first);
});
