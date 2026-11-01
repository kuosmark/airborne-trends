import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import { S3Client } from '@aws-sdk/client-s3';
import { buildRecentHistory } from '../backend/history-builder.ts';
const observation = {schemaVersion:1,countingVersion:1,referenceVersion:'a'.repeat(64),
  observedAt:'2026-10-30T00:00:00.000Z',scheduledSlot:1992576,airborneCount:3,
  operators:[{id:'FIN',name:'Finnair',count:3}],aircraftTypes:[{id:'A320',name:'Airbus',count:3}],
  unknownOperatorCount:0,unknownTypeCount:0};
function storage() {
  const s3 = new S3Client({region:'eu-north-1'});
  const files = new Map();
  const source = { Key:'history/counts/v1/2026-10-30/2026-10-30T00:00:00.000Z.json.gz',ETag:'one' };
  let reads=0;
  let isFailing=false;
  let isMalformed=false;
  s3.send=async command=>{
    const input=command.input;
    switch(command.constructor.name) {
      case 'ListObjectsV2Command': return { Contents:input.Bucket==='state'
        ? (source.Key.startsWith(input.Prefix)?[source]:[])
        : [...files.keys()].filter(key=>key.startsWith(input.Prefix)).map(Key=>({Key})) };
      case 'HeadObjectCommand': return {Metadata:files.get(input.Key).Metadata};
      case 'GetObjectCommand': reads++; return {Body:{transformToByteArray:async()=>gzipSync(JSON.stringify(isMalformed?{}:observation))}};
      case 'PutObjectCommand':
        if(isFailing && input.Key.endsWith('2026-10-30.json'))throw new Error('storage failed');
        files.set(input.Key,input);return {};
      default: throw new Error('Unexpected command');
    }
  };
  return {s3, files, source, reads:()=>reads, fail:()=>{isFailing=true;}, recover:()=>{isFailing=false;}, malformed:()=>{isMalformed=true;}};
}
const now=Date.parse('2026-10-30T01:00Z');
test('builder caches unchanged days and rebuilds changed sources, publishing index last',async()=>{
  const store=storage();
  await buildRecentHistory(store.s3,'state','web',now);
  assert.equal(store.reads(),1);
  assert.deepEqual([...store.files.keys()],['api/history/v1/2026-10-30.json','api/history/v1/index.json']);
  const index=JSON.parse(gunzipSync(store.files.get('api/history/v1/index.json').Body));
  assert.deepEqual(index.days,['2026-10-30']);
  await buildRecentHistory(store.s3,'state','web',now);
  assert.equal(store.reads(),1);
  store.source.ETag='two';
  await buildRecentHistory(store.s3,'state','web',now);
  assert.equal(store.reads(),2);
  store.s3.destroy();
});
test('failed day write preserves the last index and next run recovers',async()=>{
  const store=storage();
  await buildRecentHistory(store.s3,'state','web',now);
  const previous=store.files.get('api/history/v1/index.json');
  store.source.ETag='changed';store.fail();
  await assert.rejects(buildRecentHistory(store.s3,'state','web',now+3600000));
  assert.equal(store.files.get('api/history/v1/index.json'),previous);
  store.recover();
  await buildRecentHistory(store.s3,'state','web',now+3600000);
  assert.notEqual(store.files.get('api/history/v1/index.json'),previous);
  store.s3.destroy();
});
test('malformed source prevents publication rather than writing partial counts',async()=>{
  const store=storage();store.malformed();
  await assert.rejects(buildRecentHistory(store.s3,'state','web',now),/Invalid history record/);
  assert.equal(store.files.size,0);store.s3.destroy();
});


test('builder includes the oldest UTC date needed for 30 days and excludes older dates', async () => {
  const store = storage();
  await buildRecentHistory(store.s3, 'state', 'web', now + 30 * 86400000);
  const readIndex = () => JSON.parse(gunzipSync(store.files.get('api/history/v1/index.json').Body));
  assert.deepEqual(readIndex().days, ['2026-10-30']);
  await buildRecentHistory(store.s3, 'state', 'web', now + 31 * 86400000);
  assert.deepEqual(readIndex().days, []);
  store.s3.destroy();
});
