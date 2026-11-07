import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand, waitUntilInvalidationCompleted } from '@aws-sdk/client-cloudfront';

interface WebsiteOutputs { WebsiteBucket: string; DistributionId: string }

export function readWebsiteOutputs(value: unknown): WebsiteOutputs {
  if (typeof value !== 'object' || value === null || !('AirborneTrends' in value)) {
    throw new Error('Missing AirborneTrends deployment outputs');
  }
  const outputs = value.AirborneTrends;
  if (typeof outputs !== 'object' || outputs === null ||
      !('WebsiteBucket' in outputs) || !('DistributionId' in outputs)) {
    throw new Error('Invalid website bucket or distribution outputs');
  }
  const bucket = outputs.WebsiteBucket;
  const distributionId = outputs.DistributionId;
  if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
      typeof distributionId !== 'string' || !/^[A-Z0-9]+$/.test(distributionId)) {
    throw new Error('Invalid website bucket or distribution outputs');
  }
  return { WebsiteBucket: bucket, DistributionId: distributionId };
}

export async function publishWebsite(directory: string, outputs: WebsiteOutputs): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (!entries.some(entry => entry.name === 'index.html' && entry.isFile())) {
    throw new Error('Build must contain index.html');
  }
  // The current Angular build contains only these files. Reject unexpected directories or symlinks.
  if (entries.some(entry => !entry.isFile() || !/^[\w-]+\.(html|js|css)$/.test(entry.name))) {
    throw new Error('Build contains unexpected files; review them before publishing');
  }
  const files = await Promise.all(entries.map(async entry => ({
    name: entry.name, body: await readFile(join(directory, entry.name)),
  })));
  // Publish index last so visitors cannot receive HTML that references assets not yet uploaded.
  files.sort((a, b) => Number(a.name === 'index.html') - Number(b.name === 'index.html'));
  const s3 = new S3Client({ region: 'eu-north-1' });
  const cloudFront = new CloudFrontClient({ region: 'us-east-1' });
  try {
    for (const file of files) {
      const isHashedAsset = /-[A-Z0-9]{8}\.(js|css)$/.test(file.name);
      const contentType = file.name.endsWith('.html') ? 'text/html' : file.name.endsWith('.css') ? 'text/css' : 'text/javascript';
      await s3.send(new PutObjectCommand({
        Bucket: outputs.WebsiteBucket, Key: file.name, Body: file.body, ContentType: contentType,
        CacheControl: isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      }));
    }
    const result = await cloudFront.send(new CreateInvalidationCommand({
      DistributionId: outputs.DistributionId,
      InvalidationBatch: { CallerReference: randomUUID(), Paths: { Quantity: 1, Items: ['/*'] } },
    }));
    if (!result.Invalidation?.Id) { throw new Error('CloudFront did not confirm the invalidation'); }
    await waitUntilInvalidationCompleted({ client: cloudFront, maxWaitTime: 300 }, {
      DistributionId: outputs.DistributionId, Id: result.Invalidation.Id,
    });
  } finally {
    s3.destroy();
    cloudFront.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputsPath = process.argv[2];
  if (!outputsPath) { throw new Error('Provide the CDK outputs JSON file'); }
  const value: unknown = JSON.parse(await readFile(outputsPath, 'utf8'));
  await publishWebsite('dist/airborne-trends/browser', readWebsiteOutputs(value));
  console.log('Website published and CloudFront invalidation completed.');
}
