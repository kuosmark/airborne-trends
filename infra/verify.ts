import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isSnapshotStale } from '../shared/ranking.ts';
import { expandSnapshot } from '../shared/snapshot-wire.ts';

const WEBSITE_URL = 'https://airlines.markuskuosmanen.com';

async function fetchPublicPage(path: string): Promise<Response> {
  const response = await fetch(`${WEBSITE_URL}${path}`, {
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok) { throw new Error(`Verification failed for ${path}: HTTP ${response.status}`); }
  return response;
}

export async function verifyDeployment(expectedHtml: string): Promise<void> {
  const homepage = await fetchPublicPage('/');
  if (await homepage.text() !== expectedHtml) {
    throw new Error('Published homepage does not match the deployed build');
  }
  const ranking = await fetchPublicPage('/api/ranking-v2');
  const snapshot = expandSnapshot(await ranking.json());
  console.log('Deployment verified: homepage matches the build and ranking response is valid.');
  console.log(`Ranking updated at ${snapshot.updatedAt}; ${isSnapshotStale(snapshot, Date.now()) ? 'delayed (covered by the refresh alarm)' : 'fresh'}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const expectedHtml = await readFile('dist/airborne-trends/browser/index.html', 'utf8');
  await verifyDeployment(expectedHtml);
}
