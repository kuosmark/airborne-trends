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
  await search.fill('no matching type');
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
