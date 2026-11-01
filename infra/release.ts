import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { LambdaClient, GetFunctionConfigurationCommand, UpdateFunctionCodeCommand,
  waitUntilFunctionUpdated } from '@aws-sdk/client-lambda';
import { publishWebsite, readWebsiteOutputs } from './publish.ts';

const run = promisify(execFile);

export function validateFunctionArn(value: string): string {
  if (!/^arn:aws:lambda:eu-north-1:\d{12}:function:[\w-]+$/.test(value)) {
    throw new Error('Provide an unqualified Lambda ARN in eu-north-1');
  }
  return value;
}

export async function packageBackend(isHistory = false): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'airline-backend-'));
  try {
    const index = join(directory, 'index.js');
    await build({
      entryPoints: [fileURLToPath(new URL(isHistory ? '../backend/history-builder.ts' : '../backend/lambda.ts', import.meta.url))],
      outfile: index, bundle: true, platform: 'node', target: 'node22', minify: false,
    });
    const data = join(directory, 'data');
    if (!isHistory) {
      await mkdir(data);
      await copyFile(fileURLToPath(new URL('../backend/data/mictronics-aircraft.json', import.meta.url)),
        join(data, 'mictronics-aircraft.json'));
    }
    const archive = join(directory, 'backend.zip');
    await run('python3', ['-m', 'zipfile', '-c', archive, index, ...(!isHistory ? [data] : [])]);
    return await readFile(archive);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function releaseBackend(code: Uint8Array, functionArn: string): Promise<void> {
  validateFunctionArn(functionArn);
  const client = new LambdaClient({ region: 'eu-north-1', maxAttempts: 1 });
  try {
    const current = await client.send(new GetFunctionConfigurationCommand({ FunctionName: functionArn }));
    if (current.MemorySize !== 512 || current.Runtime !== 'nodejs22.x' || current.Handler !== 'index.handler' ||
        current.Architectures?.length !== 1 || current.Architectures[0] !== 'arm64' ||
        !current.RevisionId || current.LastUpdateStatus !== 'Successful') {
      throw new Error('Lambda configuration changed; review infrastructure before releasing');
    }
    await client.send(new UpdateFunctionCodeCommand({
      FunctionName: functionArn, ZipFile: code, RevisionId: current.RevisionId,
    }));
    await waitUntilFunctionUpdated({ client, maxWaitTime: 300 }, { FunctionName: functionArn });
    const released = await client.send(new GetFunctionConfigurationCommand({ FunctionName: functionArn }));
    const expectedHash = createHash('sha256').update(code).digest('base64');
    if (released.CodeSha256 !== expectedHash) { throw new Error('Lambda code does not match the release package'); }
  } finally {
    client.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [bucket, distribution, refresh, history] = process.argv.slice(2);
  if (!bucket || !distribution || !refresh) { throw new Error('Provide website bucket, distribution ID and refresh Lambda ARN'); }
  const website = readWebsiteOutputs({ AirlineRanking: { WebsiteBucket: bucket, DistributionId: distribution } });
  validateFunctionArn(refresh);
  if (history) { validateFunctionArn(history); }
  await releaseBackend(await packageBackend(), refresh);
  if (history) { await releaseBackend(await packageBackend(true), history); }
  await publishWebsite('dist/airline-ranking/browser', website);
  console.log('Backend and frontend released. Infrastructure and polling settings were not changed.');
}
