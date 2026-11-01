import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, paginateListObjectsV2, S3Client } from '@aws-sdk/client-s3';
import { isHistoryRecord, type HistoryRecord } from './history.ts';
import { DAY_MS, isHistoryDay, type HistoryDay, type HistoryIndex } from '../shared/history-chart.ts';

export function buildHistoryDay(date: string, records: HistoryRecord[]): HistoryDay {
  if (!records.length || records.some(record => !isHistoryRecord(record) || !record.observedAt.startsWith(date))) {
    throw new Error('Invalid history source');
  }
  const sorted = [...records].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const series = (dimension: 'operators' | 'aircraftTypes') => {
    const ids = [...new Set(sorted.flatMap(record => record[dimension].map(row => row.id)))].sort();
    const lookups = sorted.map(record => new Map(record[dimension].map(row => [row.id, row.count])));
    return Object.fromEntries(ids.map(id => [id, lookups.map(lookup => lookup.get(id) ?? 0)]));
  };
  const result: HistoryDay = { schemaVersion: 1, date, times: sorted.map(record => record.observedAt),
    totals: sorted.map(record => record.airborneCount), operators: series('operators'), aircraftTypes: series('aircraftTypes') };
  if (!isHistoryDay(result)) { throw new Error('Invalid history day'); }
  return result;
}
const client = new S3Client({ region: 'eu-north-1', maxAttempts: 2 });
const options = () => ({ abortSignal: AbortSignal.timeout(15_000) });
async function publish(s3: S3Client, bucket: string, key: string, value: unknown, sourceHash?: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: gzipSync(JSON.stringify(value)),
    ContentType: 'application/json', ContentEncoding: 'gzip', CacheControl: 'public, max-age=300',
    Metadata: sourceHash ? { sourcehash: sourceHash } : undefined,
  }), options());
}
async function buildDate(s3: S3Client, stateBucket: string, websiteBucket: string, date: string): Promise<boolean> {
  const objects: { key: string; etag: string }[] = [];
  for await (const page of paginateListObjectsV2({ client: s3 }, { Bucket: stateBucket, Prefix: `history/counts/v1/${date}/` }, options())) {
    for (const object of page.Contents ?? []) {
      if (object.Key && object.ETag) { objects.push({ key: object.Key, etag: object.ETag }); }
    }
  }
  if (!objects.length) { return false; }
  objects.sort((a, b) => a.key.localeCompare(b.key));
  const sourceHash = createHash('sha256').update(JSON.stringify(objects)).digest('hex');
  const key = `api/history/v1/${date}.json`;
  const published = await s3.send(new ListObjectsV2Command({ Bucket: websiteBucket, Prefix: key, MaxKeys: 1 }), options());
  if (published.Contents?.some(object => object.Key === key)) {
    const existing = await s3.send(new HeadObjectCommand({ Bucket: websiteBucket, Key: key }), options());
    if (existing.Metadata?.['sourcehash'] === sourceHash) { return true; }
  }
  const records: HistoryRecord[] = [];
  // Bound concurrent downloads and discard each source after producing its day.
  for (let start = 0; start < objects.length; start += 8) {
    const batch = await Promise.all(objects.slice(start, start + 8).map(async object => {
      const response = await s3.send(new GetObjectCommand({ Bucket: stateBucket, Key: object.key }), options());
      if (!response.Body) { throw new Error('Missing history body'); }
      const record: unknown = JSON.parse(gunzipSync(await response.Body.transformToByteArray()).toString());
      if (!isHistoryRecord(record)) { throw new Error('Invalid history record'); }
      return record;
    }));
    records.push(...batch);
  }
  await publish(s3, websiteBucket, key, buildHistoryDay(date, records), sourceHash);
  return true;
}
export async function handler(): Promise<void> {
  const stateBucket = process.env['STATE_BUCKET'];
  const websiteBucket = process.env['WEBSITE_BUCKET'];
  if (!stateBucket || !websiteBucket) { throw new Error('Missing history buckets'); }
  await buildRecentHistory(client, stateBucket, websiteBucket);
}
export async function buildRecentHistory(s3: S3Client, stateBucket: string, websiteBucket: string, now = Date.now()): Promise<void> {
  const days: string[] = [];
  for (let offset = 30; offset >= 0; offset--) {
    const date = new Date(now - offset * DAY_MS).toISOString().slice(0, 10);
    if (await buildDate(s3, stateBucket, websiteBucket, date)) { days.push(date); }
  }
  const index: HistoryIndex = { schemaVersion: 1, generatedAt: new Date(now).toISOString(), days };
  await publish(s3, websiteBucket, 'api/history/v1/index.json', index);
  console.log(`Published history index with ${days.length} days`);
}
