import type { Snapshot } from '../shared/ranking.ts';
import { isSnapshot } from '../shared/snapshot-validation.ts';
import { expandSnapshot } from '../shared/snapshot-wire.ts';

export function createRankingClient() {
  let snapshot: Snapshot | undefined;
  let etag: string | null = null;
  let previousUrl: string | undefined;

  async function request(url: string, signal: AbortSignal) {
    const headers: Record<string, string> = {};
    if (etag && previousUrl === url) { headers['If-None-Match'] = etag; }
    return fetch(url, { signal, headers, cache: 'no-store' });
  }

  return async (signal: AbortSignal): Promise<Snapshot> => {
    let url = 'api/ranking-v2';
    let response = await request(url, signal);
    // The frontend can deploy before the first compact snapshot is published.
    if (response.status === 404 || response.status === 403) {
      url = 'api/ranking';
      response = await request(url, signal);
    }
    if (response.status === 304 && snapshot && previousUrl === url) { return snapshot; }
    if (!response.ok) { throw new Error('Ranking request failed'); }
    const nextEtag = response.headers.get('ETag');
    if (nextEtag && nextEtag === etag && previousUrl === url && snapshot) { return snapshot; }
    const value: unknown = await response.json();
    let next: Snapshot;
    if (url === 'api/ranking-v2') {
      next = expandSnapshot(value);
    } else {
      if (!isSnapshot(value)) { throw new Error('Invalid ranking response'); }
      next = value;
    }
    snapshot = next;
    etag = nextEtag;
    previousUrl = url;
    return snapshot;
  };
}
