import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, paginateListObjectsV2, S3Client } from '@aws-sdk/client-s3';
import { isHistoryRecord, type HistoryRecord } from './history.ts';
import { HOUR_MS, summarizeHistoryDay, isHistoryYear, type HistoryYear } from '../shared/history-summary.ts';
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
    slots: sorted.map(record => record.scheduledSlot), totals: sorted.map(record => record.airborneCount), operators: series('operators'), aircraftTypes: series('aircraftTypes') };
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
async function buildDate(s3: S3Client, stateBucket: string, websiteBucket: string, date: string, now: number): Promise<HistoryDay | null> {
  const objects: { key: string; etag: string }[] = [];
  for await (const page of paginateListObjectsV2({ client: s3 }, { Bucket: stateBucket, Prefix: `history/counts/v1/${date}/` }, options())) {
    for (const object of page.Contents ?? []) {
      if (object.Key && object.ETag) { objects.push({ key: object.Key, etag: object.ETag }); }
    }
  }
  if (!objects.length) { return null; }
  objects.sort((a, b) => a.key.localeCompare(b.key));
  const sourceHash = createHash('sha256').update('summaries-v1').update(date === new Date(now).toISOString().slice(0, 10) ? String(Math.floor(now / HOUR_MS)) : '').update(JSON.stringify(objects)).digest('hex');
  const key = `api/history/v1/${date}.json`;
  const published = await s3.send(new ListObjectsV2Command({ Bucket: websiteBucket, Prefix: key, MaxKeys: 1 }), options());
  if (published.Contents?.some(object => object.Key === key)) {
    const existing = await s3.send(new HeadObjectCommand({ Bucket: websiteBucket, Key: key }), options());
    if (existing.Metadata?.['sourcehash'] === sourceHash) {
      const cached = await readPublished(s3, websiteBucket, key);
      if (!isHistoryDay(cached)) { throw new Error('Invalid cached history day'); }
      return cached;
    }
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
  const day = buildHistoryDay(date, records);
  const result = { ...day, summaries: {
    hourly: summarizeHistoryDay(day, HOUR_MS, now), daily: summarizeHistoryDay(day, DAY_MS, now),
  } };
  await publish(s3, websiteBucket, key, result, sourceHash);
  return result;
}
async function readPublished(s3: S3Client, bucket: string, key: string): Promise<unknown> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), options());
  if (!response.Body) { throw new Error('Missing published history'); }
  return JSON.parse(gunzipSync(await response.Body.transformToByteArray()).toString()) as unknown;
}
export async function handler(): Promise<void> {
  const stateBucket = process.env['STATE_BUCKET'];
  const websiteBucket = process.env['WEBSITE_BUCKET'];
  if (!stateBucket || !websiteBucket) { throw new Error('Missing history buckets'); }
  await buildRecentHistory(client, stateBucket, websiteBucket);
}
export async function buildRecentHistory(s3: S3Client, stateBucket: string, websiteBucket: string, now = Date.now()): Promise<void> {
  const yearKey = 'api/history/v1/year.json';
  const existing = await s3.send(new ListObjectsV2Command({ Bucket: websiteBucket, Prefix: yearKey, MaxKeys: 1 }), options());
  let previous: HistoryYear | null = null;
  if (existing.Contents?.some(object => object.Key === yearKey)) {
    const value = await readPublished(s3, websiteBucket, yearKey);
    if (!isHistoryYear(value)) { throw new Error('Invalid history year'); }
    previous = value;
  }
  const firstDay = Math.floor(now / DAY_MS) * DAY_MS - 364 * DAY_MS;
  const summaries = new Map((previous?.daily ?? []).filter(bucket => bucket.time >= firstDay).map(bucket => [bucket.time, bucket]));
  const dates = new Set<string>();
  for (let offset = 30; offset >= 0; offset--) { dates.add(new Date(now - offset * DAY_MS).toISOString().slice(0, 10)); }
  // Discover missing dates after publishing outages, and finalize the last partial day.
  {
    for await (const page of paginateListObjectsV2({ client: s3 }, { Bucket: stateBucket, Prefix: 'history/counts/v1/', Delimiter: '/' }, options())) {
      for (const prefix of page.CommonPrefixes ?? []) {
        const date = prefix.Prefix?.split('/')[3];
        if (date && Date.parse(date) >= firstDay && Date.parse(date) <= now &&
            (!summaries.has(Date.parse(date)) || date >= (previous?.generatedAt.slice(0, 10) ?? ''))) { dates.add(date); }
      }
    }
  }
  const days: string[] = [];
  for (const date of [...dates].sort()) {
    const day = await buildDate(s3, stateBucket, websiteBucket, date, now);
    if (!day) { continue; }
    const daily = day.summaries?.daily ?? summarizeHistoryDay(day, DAY_MS, now);
    if (Date.parse(date) >= firstDay && daily[0]) { summaries.set(daily[0].time, daily[0]); }
    if (date >= new Date(now - 30 * DAY_MS).toISOString().slice(0, 10)) { days.push(date); }
  }
  const generatedAt = new Date(now).toISOString();
  await publish(s3, websiteBucket, yearKey, { schemaVersion: 1, generatedAt,
    daily: [...summaries.values()].sort((a, b) => a.time - b.time) });
  const index: HistoryIndex = { schemaVersion: 1, generatedAt, days };
  await publish(s3, websiteBucket, 'api/history/v1/index.json', index);
  console.log(`Published history index with ${days.length} days`);
}
