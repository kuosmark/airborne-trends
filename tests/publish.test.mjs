import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand, GetInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { publishWebsite, readWebsiteOutputs } from '../infra/publish.ts';

const outputs = { WebsiteBucket: 'test-website', DistributionId: 'EXAMPLE123' };

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'airline-publish-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), '<html></html>');
  await writeFile(join(directory, 'main-ABCDEFGH.js'), 'example');
  await writeFile(join(directory, 'styles-12345678.css'), 'example');
  const calls = [];
  t.mock.method(S3Client.prototype, 'send', async command => {
    calls.push(command);
    return {};
  });
  t.mock.method(CloudFrontClient.prototype, 'send', async command => {
    calls.push(command);
    return { Invalidation: { Id: 'invalidation', Status: 'Completed' } };
  });
  return { directory, calls };
}

test('publishing sends assets before HTML, uses cache headers, and waits for invalidation', async t => {
  const { directory, calls } = await setup(t);
  await publishWebsite(directory, outputs);
  assert.deepEqual(calls.slice(0, 2).map(command => command.input.Key).sort(),
    ['main-ABCDEFGH.js', 'styles-12345678.css']);
  assert.equal(calls[2].input.Key, 'index.html');
  for (const command of calls.slice(0, 2)) {
    assert.equal(command.input.CacheControl, 'public, max-age=31536000, immutable');
    assert.equal(command.input.Bucket, outputs.WebsiteBucket);
  }
  assert.equal(calls.find(command => command.input.Key === 'main-ABCDEFGH.js').input.ContentType, 'text/javascript');
  assert.equal(calls.find(command => command.input.Key === 'styles-12345678.css').input.ContentType, 'text/css');
  assert.equal(calls[2].input.ContentType, 'text/html');
  assert.equal(calls[2].input.CacheControl, 'no-cache');
  assert.ok(calls[3] instanceof CreateInvalidationCommand);
  assert.equal(calls[3].input.DistributionId, outputs.DistributionId);
  assert.deepEqual(calls[3].input.InvalidationBatch.Paths, { Quantity: 1, Items: ['/*'] });
  assert.ok(calls[4] instanceof GetInvalidationCommand);
  assert.equal(calls.length, 5);
});

test('unhashed assets require revalidation', async t => {
  const { directory, calls } = await setup(t);
  await writeFile(join(directory, 'extra.js'), 'example');
  await publishWebsite(directory, outputs);
  assert.equal(calls.find(command => command.input.Key === 'extra.js').input.CacheControl, 'no-cache');
});

for (const unexpected of ['api', '.env', 'symlink']) {
  test(`rejects ${unexpected} before any AWS request`, async t => {
    const { directory, calls } = await setup(t);
    if (unexpected === 'api') await mkdir(join(directory, 'api'));
    else if (unexpected === '.env') await writeFile(join(directory, '.env'), 'example');
    else await symlink(join(directory, 'index.html'), join(directory, 'linked.html'));
    await assert.rejects(publishWebsite(directory, outputs), /unexpected files/);
    assert.equal(calls.length, 0);
  });
}

test('an asset upload failure leaves the existing index and cache untouched', async t => {
  const { directory } = await setup(t);
  t.mock.method(S3Client.prototype, 'send', async () => { throw new Error('Upload failed'); });
  await assert.rejects(publishWebsite(directory, outputs), /Upload failed/);
  assert.equal(S3Client.prototype.send.mock.callCount(), 1);
  assert.equal(CloudFrontClient.prototype.send.mock.callCount(), 0);
});

test('missing index blocks publication', async t => {
  const { directory, calls } = await setup(t);
  await rm(join(directory, 'index.html'));
  await assert.rejects(publishWebsite(directory, outputs), /index.html/);
  assert.equal(calls.length, 0);
});

test('deployment outputs require the expected stack, bucket and distribution', () => {
  assert.deepEqual(readWebsiteOutputs({ AirborneTrends: outputs }), outputs);
  for (const value of [null, {}, { AirborneTrends: {} }, { AirborneTrends: { ...outputs, WebsiteBucket: '../state' } },
    { AirborneTrends: { ...outputs, DistributionId: '*' } }]) {
    assert.throws(() => readWebsiteOutputs(value), /outputs/);
  }
});
