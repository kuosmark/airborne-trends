import process from 'node:process';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LambdaClient, GetFunctionConfigurationCommand, UpdateFunctionCodeCommand } from '@aws-sdk/client-lambda';
import { test } from 'node:test';
import { packageBackend, releaseBackend, validateFunctionArn } from '../infra/release.ts';

const functionArn = 'arn:aws:lambda:eu-north-1:123456789012:function:AirborneTrends-Refresh';
const code = Buffer.from('test package');
const configuration = { MemorySize: 512, Runtime: 'nodejs22.x', Handler: 'index.handler', Architectures: ['arm64'],
  RevisionId: 'existing-revision', LastUpdateStatus: 'Successful' };

test('backend package contains a bundled index.handler without invoking the provider', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('No provider calls during packaging'); });
  const archive = await packageBackend();
  const directory = await mkdtemp(join(tmpdir(), 'airline-package-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const index = join(directory, 'index.js');
  const files = execFileSync('python3', ['-c',
    'import io, sys, zipfile; z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(z.namelist()); z.extractall(sys.argv[1])',
    directory], { input: archive }).toString().trim();
  assert.ok(files.includes('data/mictronics-aircraft.json'));
  // Load the exact extracted bundle; matching source text cannot verify its exports.
  const require = createRequire(import.meta.url);
  const previousRoot = process.env.LAMBDA_TASK_ROOT;
  process.env.LAMBDA_TASK_ROOT = directory;
  t.after(() => {
    if (previousRoot === undefined) { delete process.env.LAMBDA_TASK_ROOT; }
    else { process.env.LAMBDA_TASK_ROOT = previousRoot; }
  });
  const packaged = require(index);
  assert.equal(typeof packaged.handler, 'function');
  assert.equal(fetch.mock.callCount(), 0);
});

test('release updates only code with a revision guard and verifies the deployed package', async t => {
  let isUpdated = false;
  const calls = [];
  t.mock.method(LambdaClient.prototype, 'send', async command => {
    calls.push(command);
    if (command instanceof UpdateFunctionCodeCommand) { isUpdated = true; return {}; }
    return { ...configuration, CodeSha256: isUpdated ? createHash('sha256').update(code).digest('base64') : 'old' };
  });
  await releaseBackend(code, functionArn);
  assert.ok(calls[0] instanceof GetFunctionConfigurationCommand);
  assert.ok(calls[1] instanceof UpdateFunctionCodeCommand);
  assert.deepEqual(calls[1].input, { FunctionName: functionArn, ZipFile: code, RevisionId: 'existing-revision' });
  assert.ok(calls.slice(2).every(command => command instanceof GetFunctionConfigurationCommand));
  assert.ok(calls.every(command => command.input.FunctionName === functionArn));
});

test('releases reject unreviewed runtime settings and overlapping updates before changing code', async t => {
  for (const changed of [{ MemorySize: 256 }, { Runtime: 'nodejs24.x' }, { Handler: 'other.handler' }, { Architectures: ['x86_64'] },
    { RevisionId: undefined }, { LastUpdateStatus: 'InProgress' }]) {
    const send = t.mock.method(LambdaClient.prototype, 'send', async () => ({ ...configuration, ...changed }));
    await assert.rejects(releaseBackend(code, functionArn), /configuration changed/);
    assert.equal(send.mock.callCount(), 1);
  }
});

test('revision conflicts stop a release without retrying the code update', async t => {
  const calls = [];
  t.mock.method(LambdaClient.prototype, 'send', async command => {
    calls.push(command);
    if (command instanceof UpdateFunctionCodeCommand) { throw new Error('PreconditionFailedException'); }
    return configuration;
  });
  await assert.rejects(releaseBackend(code, functionArn), /PreconditionFailed/);
  assert.equal(calls.length, 2);
});

test('a failed Lambda update or unexpected code hash stops the release', async t => {
  for (const released of [{ LastUpdateStatus: 'Failed' }, { CodeSha256: 'unexpected-code' }]) {
    let isUpdated = false;
    t.mock.method(LambdaClient.prototype, 'send', async command => {
      if (command instanceof UpdateFunctionCodeCommand) { isUpdated = true; return {}; }
      return { ...configuration, ...(isUpdated ? released : {}) };
    });
    await assert.rejects(releaseBackend(code, functionArn));
  }
});

test('qualified, wildcard and out-of-region Lambda targets are rejected without AWS requests', async t => {
  const send = t.mock.method(LambdaClient.prototype, 'send', async () => configuration);
  assert.equal(validateFunctionArn(functionArn), functionArn);
  for (const target of ['', '*', 'Refresh', `${functionArn}:alias`, functionArn.replace('eu-north-1', 'us-east-1')]) {
    await assert.rejects(releaseBackend(code, target), /ARN/);
  }
  assert.equal(send.mock.callCount(), 0);
});


test('history package exports its handler without the aircraft database', async context => {
  const archive = await packageBackend(true);
  const directory = await mkdtemp(join(tmpdir(), 'airline-history-package-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const files = execFileSync('python3', ['-c',
    'import io, sys, zipfile; z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(z.namelist()); z.extractall(sys.argv[1])',
    directory], { input: archive }).toString().trim();
  assert.equal(files.includes('mictronics'), false);
  const require = createRequire(import.meta.url);
  assert.equal(typeof require(join(directory, 'index.js')).handler, 'function');
});
