import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import { S3Client } from '@aws-sdk/client-s3';
import { createHistoryRecord } from '../backend/history.ts';
import { buildRecentHistory } from '../backend/history-builder.ts';
import { loadHistory } from '../src/history-client.ts';
import { historyPoints, DAY_MS } from '../shared/history-chart.ts';
import { plotHistory } from '../src/history-plot.ts';

// Only storage and HTTP are replaced: projection, publication, loading and plotting use production code.
test('multi-day archives reach charts with missing samples, zero counts and delayed recovery', async t => {
  const sources = new Map();
  const published = new Map();
  const s3 = new S3Client({ region: 'eu-north-1' });
  t.after(() => s3.destroy());
  let failedKey;
  const addObservation = (time, finCount, otherCount) => {
    const snapshot = {
      updatedAt: time, isStale: false, airborneCount: finCount + otherCount + 1,
      airlines: [
        ...(finCount ? [{ id: 'FIN', name: 'Finnair', count: finCount }] : []),
        { id: 'SAS', name: 'SAS', count: otherCount },
      ],
      aircraftTypeRankings: [
        ...(finCount ? [{ id: 'A320', name: 'Airbus A320', count: finCount }] : []),
        { id: 'B738', name: 'Boeing 737-800', count: otherCount },
      ],
      unassignedAircraft: { count: 1 }, unknownAircraftType: { count: 1 },
    };
    const record = createHistoryRecord(snapshot, Math.floor(Date.parse(time) / 900000), 'a'.repeat(64));
    const key = `history/counts/v1/${time.slice(0, 10)}/${time}.json.gz`;
    sources.set(key, { Body: gzipSync(JSON.stringify(record)), ETag: time });
  };
  s3.send = async command => {
    const { Bucket, Key, Prefix, ContinuationToken } = command.input;
    const files = Bucket === 'state' ? sources : published;
    switch (command.constructor.name) {
      case 'ListObjectsV2Command': {
        const matches = [...files.keys()].filter(key => key.startsWith(Prefix)).sort();
        const start = Number(ContinuationToken ?? 0);
        // Small pages exercise continuation through the real SDK paginator.
        const page = matches.slice(start, start + 2);
        const isTruncated = start + 2 < matches.length;
        return { Contents: page.map(key => ({ Key: key, ETag: files.get(key).ETag })),
          IsTruncated: isTruncated, NextContinuationToken: isTruncated ? String(start + 2) : undefined };
      }
      case 'HeadObjectCommand': return { Metadata: files.get(Key).Metadata };
      case 'GetObjectCommand': return { Body: { transformToByteArray: async () => files.get(Key).Body } };
      case 'PutObjectCommand':
        if (Key === failedKey) { throw new Error('Simulated storage failure'); }
        published.set(Key, command.input);
        return {};
      default: throw new Error(`Unexpected command: ${command.constructor.name}`);
    }
  };
  t.mock.method(globalThis, 'fetch', async path => {
    const object = published.get(path);
    // HTTP clients receive decompressed JSON from Content-Encoding: gzip.
    return object ? new globalThis.Response(gunzipSync(object.Body), { headers: { 'Content-Type': object.ContentType } })
      : new globalThis.Response('', { status: 404 });
  });
  addObservation('2026-10-30T23:45:00.000Z', 3, 2);
  addObservation('2026-10-31T00:00:00.000Z', 4, 2);
  addObservation('2026-10-31T00:15:00.000Z', 0, 3);
  addObservation('2026-10-31T00:45:00.000Z', 2, 4);
  addObservation('2026-11-01T00:00:00.000Z', 5, 4);
  const now = Date.parse('2026-11-01T00:15:00.000Z');
  const since = now - 7 * DAY_MS;
  const read = () => loadHistory(7, new globalThis.AbortController().signal, now);
  await buildRecentHistory(s3, 'state', 'web', now);
  const initial = await read();
  assert.deepEqual(initial.index.days, ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual(historyPoints(initial.days, 'total', '', since, now).map(point => point.count), [6, 7, 4, 7, 10]);
  for (const [dimension, id] of [['operators', 'FIN'], ['aircraftTypes', 'A320']]) {
    const points = historyPoints(initial.days, dimension, id, since, now);
    assert.deepEqual(points.map(point => point.count), [3, 4, 0, 2, 5]);
    assert.equal((plotHistory(points, since, now).path.match(/M/g) ?? []).length, 3);
  }
  const previousIndex = published.get('api/history/v1/index.json');
  addObservation('2026-10-31T00:30:00.000Z', 1, 4);
  failedKey = 'api/history/v1/2026-10-31.json';
  await assert.rejects(buildRecentHistory(s3, 'state', 'web', now), /Simulated storage failure/);
  assert.equal(published.get('api/history/v1/index.json'), previousIndex);
  assert.deepEqual((await read()).days, initial.days);
  failedKey = undefined;
  await buildRecentHistory(s3, 'state', 'web', now);
  const recovered = await read();
  const points = historyPoints(recovered.days, 'operators', 'FIN', since, now);
  assert.deepEqual(points.map(point => point.count), [3, 4, 0, 1, 2, 5]);
  assert.equal((plotHistory(points, since, now).path.match(/M/g) ?? []).length, 2);
  await buildRecentHistory(s3, 'state', 'web', now);
  assert.deepEqual((await read()).days, recovered.days);
  const day = await loadHistory(1, new globalThis.AbortController().signal, now);
  assert.deepEqual(historyPoints(day.days, 'total', '', now - DAY_MS, now).map(point => point.count), [4, 6, 7, 10]);
});
