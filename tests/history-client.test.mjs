import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadHistory } from '../src/history-client.ts';

const now = Date.parse('2026-10-30T12:00:00.000Z');
const index = { schemaVersion: 1, generatedAt: new Date(now).toISOString(), days: ['2026-10-28', '2026-10-30'] };
const day = { schemaVersion: 1, date: '2026-10-30', times: ['2026-10-30T11:00:00.000Z'],
  totals: [3], operators: { FIN: [3] }, aircraftTypes: { A320: [3] } };

test('history loads only advertised dates within the requested window and forwards cancellation', async context => {
  const calls = [];
  const signal = new globalThis.AbortController().signal;
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push(path);
    assert.equal(options.signal, signal);
    return globalThis.Response.json(path.endsWith('index.json') ? index : day);
  });
  const result = await loadHistory(1, signal, now);
  assert.deepEqual(calls, ['/api/history/v1/index.json', '/api/history/v1/2026-10-30.json']);
  assert.deepEqual(result.days, [day]);
});

test('history rejects HTTP errors, malformed JSON and days that do not match the index', async context => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => new globalThis.Response('', { status: 503 }));
  await assert.rejects(loadHistory(1, new globalThis.AbortController().signal, now));
  fetchMock.mock.mockImplementation(async () => new globalThis.Response('invalid JSON'));
  await assert.rejects(loadHistory(1, new globalThis.AbortController().signal, now));
  fetchMock.mock.mockImplementation(async path => globalThis.Response.json(path.endsWith('index.json') ? index : { ...day, date: '2026-10-29' }));
  await assert.rejects(loadHistory(1, new globalThis.AbortController().signal, now));
});

test('history preserves request cancellation rather than returning partial results', async context => {
  context.mock.method(globalThis, 'fetch', async (path, options) => {
    options.signal.throwIfAborted();
    return globalThis.Response.json(index);
  });
  const controller = new globalThis.AbortController();
  controller.abort();
  await assert.rejects(loadHistory(7, controller.signal, now), { name: 'AbortError' });
});

test('year loader accepts validated daily summaries, handles old deployments, and rejects malformed data',async context=>{
  const {loadHistoryYear}=await import('../src/history-client.ts');
  const fetchMock=context.mock.method(globalThis,'fetch',async()=>globalThis.Response.json({schemaVersion:1,generatedAt:index.generatedAt,daily:[]}));
  assert.deepEqual((await loadHistoryYear(new globalThis.AbortController().signal)).daily,[]);
  fetchMock.mock.mockImplementation(async()=>new globalThis.Response('',{status:404}));
  assert.equal(await loadHistoryYear(new globalThis.AbortController().signal),null);
  fetchMock.mock.mockImplementation(async()=>globalThis.Response.json({schemaVersion:1,generatedAt:index.generatedAt,daily:[null]}));
  await assert.rejects(loadHistoryYear(new globalThis.AbortController().signal));
});
