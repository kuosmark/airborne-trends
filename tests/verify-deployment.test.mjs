import assert from 'node:assert/strict';
import console from 'node:console';
import { test } from 'node:test';
import { verifyDeployment } from '../infra/verify.ts';

const html = '<html><app-root></app-root><script src="main-ABCDEFGH.js"></script></html>';

function setup(t, { homepage = html, status = 200, ranking, isDelayed = false } = {}) {
  const calls = [];
  const logs = [];
  t.mock.method(console, 'log', message => logs.push(message));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/')) { return new globalThis.Response(homepage, { status }); }
    return globalThis.Response.json(ranking ?? {
      updatedAt: new Date(Date.now() - (isDelayed ? 3_600_000 : 0)).toISOString(),
      airlines: [], positions: [], isStale: false,
    });
  });
  return { calls, logs };
}

test('verifies the deployed homepage and compact ranking using only public endpoints', async t => {
  const { calls, logs } = setup(t);
  await verifyDeployment(html);
  assert.deepEqual(calls.map(call => call.url), [
    'https://airborne-trends.markuskuosmanen.com/', 'https://airborne-trends.markuskuosmanen.com/api/ranking-v2',
  ]);
  for (const { options } of calls) {
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof globalThis.AbortSignal);
  }
  assert.match(logs.join('\n'), /homepage matches.*ranking response is valid/);
  assert.match(logs.join('\n'), /fresh/);
});

test('fails verification on unavailable, outdated, or malformed public responses', async t => {
  for (const [options, expected] of [
    [{ status: 503 }, /HTTP 503/],
    [{ homepage: '<html>Old deployment</html>' }, /does not match/],
    [{ ranking: { error: 'unavailable' } }, /Invalid compact snapshot/],
    [{ ranking: { updatedAt: 'invalid', airlines: [], positions: [], isStale: false } }, /Invalid ranking response/],
  ]) {
    await t.test(String(expected), async child => {
      setup(child, options);
      await assert.rejects(verifyDeployment(html), expected);
    });
  }
});

test('reports a delayed valid snapshot without failing the deployment or triggering a refresh', async t => {
  const { calls, logs } = setup(t, { isDelayed: true });
  await verifyDeployment(html);
  assert.equal(calls.length, 2);
  assert.match(logs.join('\n'), /delayed/);
});

test('network and response-body errors fail verification', async t => {
  setup(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network unavailable'); });
  await assert.rejects(verifyDeployment(html), /Network unavailable/);
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    text: async () => { throw new globalThis.DOMException('Body timed out', 'TimeoutError'); },
  }));
  await assert.rejects(verifyDeployment(html), { name: 'TimeoutError' });
});
