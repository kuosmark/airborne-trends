import { expect, test } from '@playwright/test';

test('open history ages without refetching or shifting its chart when periods change', async ({ page }) => {
  const now = new Date('2026-11-01T12:00:00.000Z');
  await page.clock.install({ time: now });
  await page.route('**/api/ranking-v2', route => route.fulfill({ json: {
    updatedAt: now.toISOString(), isStale: false, airborneCount: 3, positions: [],
    airlines: [], unassignedAircraft: { count: 3, aircraftTypes: [{ name: 'Unknown', count: 3 }] },
  } }));
  const day = {
    schemaVersion: 1, date: '2026-11-01',
    times: Array.from({ length: 48 }, (_, index) =>
      new Date(Date.parse('2026-11-01T00:05:00Z') + index * 15 * 60_000).toISOString()),
    totals: Array(48).fill(3), operators: {}, aircraftTypes: {},
  };
  const year = {
    schemaVersion: 1, generatedAt: now.toISOString(), daily: [{
      time: Date.parse('2026-11-01T00:00:00Z'), end: now.getTime(),
      samples: 48, expected: 48, isPartial: true, isCovered: true,
      total: 3, operators: {}, aircraftTypes: {},
    }],
  };
  let historyRequests = 0;
  await page.route('**/api/history/v1/**', route => {
    historyRequests++;
    const url = route.request().url();
    const json = url.endsWith('/index.json')
      ? { schemaVersion: 1, generatedAt: now.toISOString(), days: ['2026-11-01'] }
      : url.endsWith('/year.json') ? year : day;
    return route.fulfill({ json });
  });
  await page.goto('/');
  const chart = page.locator('app-history-chart').first();
  await chart.getByRole('button', { name: /Airborne history/ }).click();
  await chart.locator('summary').click();
  await expect(chart.locator('.details-meta')).toContainText('Updated just now');
  const scale = await chart.locator('.y-axis').textContent();
  for (const period of ['7 days', '30 days', '1 year', '24 hours']) {
    const button = chart.getByRole('button', { name: period, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(chart.locator('.y-axis')).toHaveText(scale);
  }
  const path = await chart.locator('path.series').getAttribute('d');
  await page.clock.fastForward(121 * 60_000);
  await expect(chart.locator('.details-meta')).toContainText('Updated 2 hr ago');
  await expect(chart.getByText('History updates are delayed.')).toBeVisible();
  await expect(chart.locator('path.series')).toHaveAttribute('d', path);
  expect(historyRequests).toBe(3);
});

test('recent charts do not wait for yearly data and yearly freshness uses its own timestamp', async ({ page }) => {
  const now = new Date('2026-11-01T12:00:00Z');
  await page.clock.install({ time: now });
  await page.route('**/api/ranking-v2', route => route.fulfill({ json: {
    updatedAt: now.toISOString(), isStale: false, airborneCount: 3, positions: [],
    airlines: [], unassignedAircraft: { count: 3, aircraftTypes: [{ name: 'Unknown', count: 3 }] },
  } }));
  let releaseYear;
  const yearReady = new Promise(resolve => { releaseYear = resolve; });
  await page.route('**/api/history/v1/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/year.json')) {
      await yearReady;
      await route.fulfill({ json: {
        schemaVersion: 1, generatedAt: '2026-11-01T09:00:00.000Z', daily: [{
          time: Date.parse('2026-10-31T00:00:00Z'), end: Date.parse('2026-11-01T00:00:00Z'),
          samples: 96, expected: 96, isPartial: false, isCovered: true,
          total: 3, operators: {}, aircraftTypes: {},
        }],
      } });
      return;
    }
    await route.fulfill({ json: url.endsWith('/index.json')
      ? { schemaVersion: 1, generatedAt: now.toISOString(), days: ['2026-11-01'] }
      : { schemaVersion: 1, date: '2026-11-01', times: ['2026-11-01T11:50:00.000Z'], totals: [3], operators: {}, aircraftTypes: {} },
    });
  });
  await page.goto('/');
  const chart = page.locator('app-history-chart').first();
  await chart.getByRole('button', { name: /Airborne history/ }).click();
  try {
    await expect(chart.locator('svg')).toBeVisible();
    await expect(chart.getByText('History updates are delayed.')).toHaveCount(0);
    await chart.getByRole('button', { name: '1 year', exact: true }).click();
    await expect(chart.getByText('Loading history…')).toBeVisible();
  } finally {
    releaseYear();
  }
  await expect(chart.locator('svg')).toBeVisible();
  await expect(chart.getByText('History updates are delayed.')).toBeVisible();
  await chart.getByRole('button', { name: '24 hours', exact: true }).click();
  await expect(chart.getByText('History updates are delayed.')).toHaveCount(0);
});

test('yearly history remains usable when recent history fails', async ({ page }) => {
  const now = new Date('2026-11-01T12:00:00Z');
  await page.clock.install({ time: now });
  await page.route('**/api/ranking-v2', route => route.fulfill({ json: {
    updatedAt: now.toISOString(), isStale: false, airborneCount: 3, positions: [],
    airlines: [], unassignedAircraft: { count: 3, aircraftTypes: [] },
  } }));
  await page.route('**/api/history/v1/**', route => {
    if (!route.request().url().endsWith('/year.json')) {
      return route.fulfill({ status: 503, body: 'Unavailable' });
    }
    return route.fulfill({ json: {
      schemaVersion: 1, generatedAt: '2026-11-01T09:00:00.000Z', daily: [{
        time: Date.parse('2026-10-31T00:00:00Z'), end: Date.parse('2026-11-01T00:00:00Z'),
        samples: 96, expected: 96, isPartial: false, isCovered: true,
        total: 3, operators: {}, aircraftTypes: {},
      }],
    } });
  });
  await page.goto('/');
  const chart = page.locator('app-history-chart').first();
  await chart.getByRole('button', { name: /Airborne history/ }).click();
  await expect(chart.getByText('History is temporarily unavailable.')).toBeVisible();
  await chart.getByRole('button', { name: '1 year', exact: true }).click();
  await expect(chart.locator('svg')).toBeVisible();
  await expect(chart.getByText('History updates are delayed.')).toBeVisible();
  await chart.getByRole('button', { name: '24 hours', exact: true }).click();
  await expect(chart.getByText('History is temporarily unavailable.')).toBeVisible();
});
