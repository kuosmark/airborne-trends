import { expect, test } from '@playwright/test';

const types = [
  { id: 'A320', name: 'AIRBUS A-320', classification: 'L2J', count: 10 },
  { id: 'B744', name: 'BOEING 747-400', classification: 'L4J', count: 4 },
  { id: 'AT76', name: 'ATR 72-600', classification: 'L2T', count: 3 },
  { id: 'C172', name: 'CESSNA 172', classification: 'L1P', count: 2 },
];

test('category, engine count and search combine, toggle and reset without including unknown types', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: {
    updatedAt: new Date().toISOString(), isStale: false, airborneCount: 24,
    positions: [],
    airlines: [{ id: 'TST', name: 'Test operator', count: 24,
      aircraftTypes: [...types.map(type => ({ name: type.name, count: type.count })), { name: 'Unknown', count: 5 }] }],
    unassignedAircraft: { count: 0, aircraftTypes: [] },
    aircraftTypeRankings: types.map(type => ({ ...type, operators: [{ id: 'TST', count: type.count }] })),
    unknownAircraftType: { count: 5, operators: [{ id: 'TST', count: 5 }] },
  } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Aircraft types', exact: true }).click();
  const board = page.getByRole('region', { name: 'Aircraft type leaderboard' });
  const unknown = page.getByRole('region', { name: 'Unknown type', exact: true });
  const category = page.getByRole('group', { name: 'Aircraft category', exact: true });
  const engines = page.getByRole('group', { name: 'Engine count', exact: true });
  const jets = category.getByRole('button', { name: 'Jets', exact: true });
  const twoEngines = engines.getByRole('button', { name: '2 engines', exact: true });
  const anyEngine = engines.getByRole('button', { name: 'Any', exact: true });
  const search = page.getByRole('searchbox');
  const reset = page.getByRole('button', { name: 'Reset filters', exact: true });

  async function expectResults(names, aircraft, typeCount) {
    await expect(board.locator('.airline-name')).toHaveText(names);
    await expect(page.locator('.airborne-total')).toHaveText(`${aircraft} aircraft`);
    await expect(page.locator('.search-results')).toHaveText(typeCount);
  }

  await expectResults(types.map(type => type.name), 24, '4 types');
  await expect(unknown).toBeVisible();
  const filters = page.getByRole('button', { name: /^Filters/ });
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  await filters.click();
  await expect(filters).toHaveAttribute('aria-expanded', 'true');
  await jets.click();
  await expect(jets).toHaveAttribute('aria-pressed', 'true');
  await expectResults(['AIRBUS A-320', 'BOEING 747-400'], 14, '2 of 4 types');
  await expect(unknown).toBeHidden();
  await twoEngines.click();
  await expect(twoEngines).toHaveAttribute('aria-pressed', 'true');
  await expectResults(['AIRBUS A-320'], 10, '1 of 4 types');
  await twoEngines.click();
  await expect(twoEngines).toHaveAttribute('aria-pressed', 'true');
  await expectResults(['AIRBUS A-320'], 10, '1 of 4 types');

  // Categories toggle off; engine choices remain selected until another is chosen.
  await jets.click();
  await expect(jets).toHaveAttribute('aria-pressed', 'false');
  await expect(category.getByRole('button', { name: 'All aircraft', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectResults(['AIRBUS A-320', 'ATR 72-600'], 13, '2 of 4 types');
  await expect(unknown).toBeHidden();
  await search.fill('AT76');
  await expectResults(['ATR 72-600'], 3, '1 of 4 types');
  // A known type outside the active engine filter must still be excluded.
  await search.fill('B744');
  await expectResults([], 0, '0 of 4 types');
  await expect(board.getByText('No matches for the selected filters.', { exact: true })).toBeVisible();

  // Reset clears all three inputs, including the category, in one action.
  await search.fill('A320');
  await jets.click();
  await expectResults(['AIRBUS A-320'], 10, '1 of 4 types');
  await reset.click();
  await expect(search).toHaveValue('');
  await expect(jets).toHaveAttribute('aria-pressed', 'false');
  await expect(anyEngine).toHaveAttribute('aria-pressed', 'true');
  await expectResults(types.map(type => type.name), 24, '4 types');
  await expect(unknown).toBeVisible();
  await expect(reset).toBeHidden();
  await expect(page.getByRole('button', { name: 'Reset filters', exact: true, includeHidden: true })).toBeDisabled();
});

test('snapshot age aligns right when it fits and left below counts on narrow screens', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: {
    updatedAt: new Date().toISOString(), isStale: false, airborneCount: 4891,
    positions: [], airlines: [{ id: 'TST', name: 'Test operator', count: 4891, aircraftTypes: [{ name: 'AIRBUS A-320', count: 4891 }] }],
    unassignedAircraft: { count: 0, aircraftTypes: [] },
    aircraftTypeRankings: [{ id: 'A320', name: 'AIRBUS A-320', classification: 'L2J', count: 4891, operators: [{ id: 'TST', count: 4891 }] }],
    unknownAircraftType: { count: 0, operators: [] },
  } }));
  await page.goto('/');
  for (const tab of ['Operators', 'Aircraft types']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expect(page.locator('.airborne-total')).toHaveText('4,891 aircraft');
    await expect(page.locator('.search-results')).toHaveText(tab === 'Operators' ? '1 operators' : '1 types');
    await expect.poll(() => page.evaluate(() => {
      const toolbar = globalThis.document.querySelector('.results-toolbar');
      const status = toolbar.querySelector('.ranking-status').getBoundingClientRect();
      const timestamp = toolbar.querySelector('.snapshot-status').getBoundingClientRect();
      const bounds = toolbar.getBoundingClientRect();
      const gap = parseFloat(globalThis.getComputedStyle(toolbar).columnGap);
      const isInline = status.width + gap + timestamp.width <= bounds.width + 1;
      if (isInline) {
        return Math.abs(timestamp.right - bounds.right) < 1
          && timestamp.top >= status.top && timestamp.bottom <= status.bottom + 1;
      }
      return Math.abs(timestamp.left - bounds.left) < 1 && timestamp.top >= status.bottom;
    })).toBe(true);
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  }
});

test('search hides unknown groups and mobile drawers use balanced space', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: {
    updatedAt: new Date().toISOString(), isStale: false, airborneCount: 15,
    positions: [],
    airlines: [{ id: 'TST', name: 'Test operator', count: 10, aircraftTypes: [{ name: 'AIRBUS A-320', count: 10 }] }],
    unassignedAircraft: { count: 5, aircraftTypes: [{ name: 'Unknown', count: 5 }] },
    aircraftTypeRankings: [{ ...types[0], operators: [{ id: 'TST', count: 10 }] }],
    unknownAircraftType: { count: 5, operators: [{ id: null, count: 5 }] },
  } }));
  await page.goto('/');
  for (const [tab, unknownName] of [['Operators', 'Unknown operator'], ['Aircraft types', 'Unknown type']]) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    const unknown = page.getByRole('region', { name: unknownName, exact: true });
    await expect(unknown).toBeVisible();
    await page.getByRole('searchbox').fill('zzzzz');
    await expect(page.getByText('No matches for the selected filters.', { exact: true })).toBeVisible();
    await expect(unknown).toBeHidden();
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(unknown).toBeVisible();
    if (page.viewportSize().width <= 480) {
      const statusHeight = await page.locator('.ranking-status').evaluate(el => el.getBoundingClientRect().height);
      const countsHeight = await page.locator('.ranking-counts').evaluate(el => el.getBoundingClientRect().height);
      expect(statusHeight).toBeLessThanOrEqual(countsHeight + 1);
      const headingBounds = button => button.evaluate(el => {
        const row = el.getBoundingClientRect();
        const title = el.querySelector('.airline-name').getBoundingClientRect();
        return { x: title.x - row.x, y: title.y - row.y, width: title.width, height: title.height };
      });
      const regularButton = page.locator('.leaderboard .airline-toggle').first();
      const closedHeading = await headingBounds(regularButton);
      await regularButton.click();
      expect(await headingBounds(regularButton)).toEqual(closedHeading);
      const padding = await page.locator('.details-panel').evaluate(el => {
        const style = globalThis.getComputedStyle(el);
        return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
      });
      expect(padding[0]).toBe(padding[1]);
      expect(padding[0]).toBe(20);
      await regularButton.click();
      expect(await headingBounds(regularButton)).toEqual(closedHeading);
      const unknownButton = unknown.locator('.airline-toggle');
      const closedUnknownHeading = await headingBounds(unknownButton);
      await unknownButton.click();
      expect(await headingBounds(unknownButton)).toEqual(closedUnknownHeading);
      const unknownPadding = await unknown.locator('.details-panel').evaluate(el => {
        const style = globalThis.getComputedStyle(el);
        return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
      });
      expect(unknownPadding).toEqual(padding);
      await unknownButton.click();
      expect(await headingBounds(unknownButton)).toEqual(closedUnknownHeading);
    }
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  }
});
