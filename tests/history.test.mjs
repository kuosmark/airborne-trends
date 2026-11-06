import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createHistoryRecord, isHistoryRecord } from '../backend/history.ts';
import { writeHistory } from '../backend/history-storage.ts';
import { refreshScheduledRanking } from '../backend/scheduled-refresh.ts';
import { readRefreshState } from '../backend/refresh-state.ts';
import { REFRESH_INTERVAL_MS } from '../shared/ranking.ts';

const start = Date.parse('2026-10-28T12:00:00.000Z');
const reference = 'a'.repeat(64);
const clone = value => globalThis.structuredClone(value);
function snapshot(time = start) {
  return {
    updatedAt: new Date(time).toISOString(), isStale: false, airborneCount: 3,
    airlines: [{ id: 'AAA', name: 'Airline A', count: 2, aircraftTypes: [{ name: 'A320', count: 2 }],
      positions: [{ id: '000001', latitude: 60, longitude: 25, callsign: 'AAA1', aircraftType: 'A320' }] }],
    unassignedAircraft: { count: 1, aircraftTypes: [{ name: 'Unknown', count: 1 }] },
    aircraftTypeRankings: [{ id: 'A320', name: 'Airbus A320', count: 2, operators: [{ id: 'AAA', count: 2 }] }],
    unknownAircraftType: { count: 1, operators: [{ id: null, count: 1 }], descriptions: [{ name: 'Private raw text', count: 1 }] },
  };
}
function setup() {
  let saved = { lastAttemptSlot: null, snapshot: null, snapshotAttempts: [] };
  let clock = start;
  let calls = 0;
  const writes = [], published = [], reports = [];
  const state = { read: async () => clone(saved), write: async value => { saved = clone(value); } };
  const history = { referenceVersion: reference, write: async record => { writes.push(clone(record)); }, report: event => reports.push(event) };
  const options = {
    state, history, directory: { isAvailable: () => true, apply: value => value, refresh: async () => {} },
    now: () => clock, scheduledAt: new Date(clock).toISOString(), deadline: clock + 120000,
    fetchSnapshot: async () => { calls++; return snapshot(clock); },
    publish: async value => { published.push(clone(value)); },
  };
  return { options, writes, published, reports, saved: () => clone(saved), calls: () => calls,
    advance() { clock += REFRESH_INTERVAL_MS; options.scheduledAt = new Date(clock).toISOString(); options.deadline = clock + 120000; } };
}

test('projects only aggregate counts and metadata, never aircraft details', () => {
  const record = createHistoryRecord(snapshot(), start / REFRESH_INTERVAL_MS, reference);
  assert.deepEqual(record, {
    schemaVersion: 1, countingVersion: 1, referenceVersion: reference,
    observedAt: new Date(start).toISOString(), scheduledSlot: start / REFRESH_INTERVAL_MS, airborneCount: 3,
    operators: [{ id: 'AAA', name: 'Airline A', count: 2 }], aircraftTypes: [{ id: 'A320', name: 'Airbus A320', count: 2 }],
    unknownOperatorCount: 1, unknownTypeCount: 1,
  });
  assert.doesNotMatch(JSON.stringify(record), /latitude|longitude|positions|callsign|000001|Private raw text/);
  assert.equal(isHistoryRecord({ ...record, positions: [] }), false);
});

test('rejects incomplete, stale, duplicate, negative, fractional and inconsistent counts', () => {
  const mutations = [
    value => { delete value.airborneCount; }, value => { delete value.aircraftTypeRankings; },
    value => { delete value.unassignedAircraft; }, value => { delete value.unknownAircraftType; },
    value => { value.isStale = true; }, value => { value.airborneCount = 4; },
    value => { value.airlines.push(clone(value.airlines[0])); value.airborneCount += 2; value.unknownAircraftType.count += 2; },
    value => { value.aircraftTypeRankings.push(clone(value.aircraftTypeRankings[0])); value.airborneCount += 2; value.unassignedAircraft.count += 2; },
    value => { value.airlines[0].count = -1; }, value => { value.aircraftTypeRankings[0].count = 1.5; },
    value => { value.airlines[0].id = 'bad'; }, value => { value.aircraftTypeRankings[0].id = 'INVALID'; },
    value => { value.updatedAt = 'bad'; }, value => { value.unknownTypeCount = NaN; value.unknownAircraftType.count = NaN; },
  ];
  for (const mutate of mutations) {
    const value = snapshot(); mutate(value);
    assert.throws(() => createHistoryRecord(value, start / REFRESH_INTERVAL_MS, reference));
  }
  assert.throws(() => createHistoryRecord(snapshot(), 1.5, reference));
  assert.throws(() => createHistoryRecord(snapshot(), 1, 'bad'));
});

test('empty but complete snapshots are valid; unknown dimensions overlap independently', () => {
  const value = snapshot();
  value.airlines = []; value.aircraftTypeRankings = [];
  value.unassignedAircraft.count = value.unknownAircraftType.count = 3;
  assert.equal(createHistoryRecord(value, 1, reference).airborneCount, 3);
  value.airborneCount = value.unassignedAircraft.count = value.unknownAircraftType.count = 0;
  assert.equal(createHistoryRecord(value, 1, reference).airborneCount, 0);
});

test('archives once despite two live publications, duplicate invocation and repeated source timestamps', async () => {
  const f = setup();
  await refreshScheduledRanking(f.options);
  assert.equal(f.published.length, 2); assert.equal(f.writes.length, 1);
  await refreshScheduledRanking(f.options);
  assert.equal(f.calls(), 1); assert.equal(f.writes.length, 1);
  f.advance(); f.options.fetchSnapshot = async () => snapshot(start);
  await refreshScheduledRanking(f.options);
  assert.equal(f.writes.length, 1); assert.equal(f.saved().pendingHistory, null);
});

test('a failed archive keeps live publication working and recovers original counts before the next fetch', async () => {
  const f = setup();
  f.options.history.write = async () => { throw new Error('S3 unavailable'); };
  await assert.rejects(refreshScheduledRanking(f.options), /history/);
  assert.equal(f.published.length, 2);
  const pending = f.saved().pendingHistory;
  assert.equal(pending.observedAt, new Date(start).toISOString());
  assert.deepEqual(f.reports, ['failed']);
  f.advance();
  f.options.history.write = async record => { f.writes.push(clone(record)); };
  const fetch = f.options.fetchSnapshot;
  f.options.fetchSnapshot = async () => { assert.deepEqual(f.writes[0], pending); return fetch(); };
  await refreshScheduledRanking(f.options);
  assert.equal(f.calls(), 2); assert.equal(f.writes.length, 2); assert.equal(f.saved().pendingHistory, null);
  assert.equal(f.writes[0].scheduledSlot + 1, f.writes[1].scheduledSlot);
});

test('prolonged archive failures keep only the latest pending record and explicitly report the gap', async () => {
  const f = setup(); f.options.history.write = async () => { throw new Error('Unavailable'); };
  await assert.rejects(refreshScheduledRanking(f.options)); f.advance();
  await assert.rejects(refreshScheduledRanking(f.options));
  assert.equal(f.calls(), 2); assert.equal(f.published.length, 4);
  assert.ok(f.reports.includes('dropped'));
  assert.equal(f.saved().pendingHistory.observedAt, new Date(start + REFRESH_INTERVAL_MS).toISOString());
});

test('an invalid history projection does not block live output or invent missing counts', async () => {
  const f = setup(); f.options.fetchSnapshot = async () => { const value = snapshot(); delete value.aircraftTypeRankings; delete value.unknownAircraftType; return value; };
  await assert.rejects(refreshScheduledRanking(f.options), /history/);
  assert.equal(f.published.length, 2); assert.equal(f.writes.length, 0);
  assert.deepEqual(f.reports, ['invalid']); assert.equal(f.saved().pendingHistory, null);
});

test('failed fetches and legacy recovery do not create historical observations', async () => {
  const f = setup();
  await f.options.state.write({ lastAttemptSlot: start / REFRESH_INTERVAL_MS, snapshot: snapshot(), snapshotAttempts: [start] });
  await refreshScheduledRanking(f.options);
  assert.equal(f.writes.length, 0); assert.equal(f.calls(), 0);
  f.advance(); f.options.fetchSnapshot = async () => { throw new Error('Provider failed'); };
  await assert.rejects(refreshScheduledRanking(f.options));
  assert.equal(f.writes.length, 0);
});

test('saved pending history survives a process failure before archival and metadata changes', async () => {
  const f = setup(); const record = createHistoryRecord(snapshot(), start / REFRESH_INTERVAL_MS, reference);
  await f.options.state.write({ lastAttemptSlot: start / REFRESH_INTERVAL_MS, snapshot: snapshot(), snapshotAttempts: [start], pendingHistory: record });
  f.options.history.referenceVersion = 'b'.repeat(64);
  await refreshScheduledRanking(f.options);
  assert.equal(f.calls(), 0); assert.deepEqual(f.writes, [record]);
  assert.equal(f.saved().pendingHistory, null);
});

test('failed live publication does not cause another archive or provider request on recovery', async () => {
  const f = setup(); const publish = f.options.publish;
  f.options.publish = async () => { throw new Error('Failed live write'); };
  await assert.rejects(refreshScheduledRanking(f.options));
  f.options.publish = publish; await refreshScheduledRanking(f.options);
  assert.equal(f.writes.length, 1); assert.equal(f.calls(), 1);
});

test('state migration preserves paid request history and validates pending aggregate data', () => {
  const attempts = [start];
  const value = readRefreshState({ lastAttemptSlot: start / REFRESH_INTERVAL_MS, snapshot: snapshot(), snapshotAttempts: attempts });
  assert.deepEqual(value.snapshotAttempts, attempts); assert.equal(value.pendingHistory, null);
  assert.throws(() => readRefreshState({ ...value, pendingHistory: { positions: [] } }), /pending history/);
});

test('S3 archive is compressed, private-bucket targeted and conditional on absence', async () => {
  const record = createHistoryRecord(snapshot(), start / REFRESH_INTERVAL_MS, reference);
  let input;
  await writeHistory({ send: async command => { input = command.input; } }, 'private-state', record);
  assert.equal(input.Bucket, 'private-state');
  assert.equal(input.Key, 'history/counts/v1/2026-10-28/2026-10-28T12:00:00.000Z.json.gz');
  assert.equal(input.IfNoneMatch, '*'); assert.equal(input.ContentEncoding, 'gzip');
  assert.deepEqual(JSON.parse(gunzipSync(input.Body).toString()), record);
  for (const name of ['PreconditionFailed', 'ConditionalRequestConflict', 'AccessDenied', 'TimeoutError']) {
    const write = writeHistory({ send: async () => { const error = new Error('Unsafe details'); error.name = name; throw error; } }, 'state', record);
    if (name === 'PreconditionFailed') await write;
    else await assert.rejects(write);
  }
});

test('late scheduled observations remain buildable across an interval boundary', async () => {
  const { buildHistoryDay } = await import('../backend/history-builder.ts');
  const slot = Math.floor(start / REFRESH_INTERVAL_MS);
  const record = createHistoryRecord(snapshot(start + REFRESH_INTERVAL_MS), slot, reference);
  assert.equal(isHistoryRecord(record), true);
  const day = buildHistoryDay(record.observedAt.slice(0, 10), [record]);
  assert.deepEqual(day.slots, [slot]);
  assert.deepEqual(day.times, [record.observedAt]);
  assert.deepEqual(day.totals, [3]);
});
