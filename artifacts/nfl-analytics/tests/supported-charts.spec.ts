import { expect, test } from '@playwright/test';

test('lazy plots appear with supported evidence and follow market and sportsbook filters without inventing zeroes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/supported-charts.html');
  const comparison = page.locator('[data-section="pregame-team-comparison"]');
  const movement = page.locator('[data-section="line-movement"]');

  await expect(comparison.getByText('0 of 4 supported')).toBeVisible();
  await expect(comparison.getByRole('status')).toContainText('No supported two-team values');
  await expect(movement.locator('.movement-empty strong')).toHaveText('No line history available');
  await expect(comparison.locator('.recharts-wrapper')).toHaveCount(0);
  await expect(movement.locator('.recharts-wrapper')).toHaveCount(0);
  expect(await page.evaluate(() => performance.getEntriesByType('resource').some(entry =>
    /(?:PregameComparisonPlot|LineMovementPlot)/.test(entry.name)))).toBe(false);

  await page.getByTestId('toggle-evidence').click();
  await expect(comparison.getByText('1 of 4 supported')).toBeVisible();
  await expect(comparison.locator('.recharts-wrapper')).toBeVisible();
  await expect(comparison.locator('[aria-label="Accessible list of supported pregame comparison values"] li')).toHaveCount(1);
  await expect(comparison.getByRole('option', { name: 'Rushing' })).toHaveCount(0);
  await expect(comparison.getByText('0.123 EPA/dropback')).toBeVisible();
  await expect(comparison.getByText('-0.234 EPA/dropback')).toBeVisible();
  await comparison.locator('.detail-zero-coverage summary').click();
  await expect(comparison.getByText('Rushing: Cutoff-safe fixture')).toBeVisible();
  await expect(comparison.locator('.recharts-bar-rectangle')).toHaveCount(2);

  await expect(movement.getByRole('img', { name: 'Spread movement chart' })).toBeVisible();
  await expect(movement.locator('.recharts-line-curve')).toHaveCount(2);
  await expect(movement.getByText('-3.5 · -110')).toBeVisible();
  await expect(movement.getByText('-2.5 · -105')).toBeVisible();
  expect(await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    return ['PregameComparisonPlot', 'LineMovementPlot'].every(name =>
      resources.some(url => url.includes(name)));
  })).toBe(true);

  await movement.getByRole('tab', { name: 'Total' }).click();
  await expect(movement.getByRole('img', { name: 'Total movement chart' })).toBeVisible();
  await expect(movement.locator('.recharts-line').first().locator('.recharts-line-dot')).toHaveCount(0); // Null points are not fabricated as zero.
  await expect(movement.locator('.recharts-line').last().locator('.recharts-line-dot')).toHaveCount(2);
  await expect(movement.locator('.movement-summary-value strong').filter({ hasText: '-115' })).toBeVisible();
  await expect(movement.locator('.movement-summary-value strong').filter({ hasText: '-108' })).toBeVisible();
  await expect(movement.getByText('0 · -115')).toHaveCount(0);

  await movement.getByRole('button', { name: 'DraftKings' }).click();
  await expect(movement.getByText('No total history')).toBeVisible();
  await expect(movement.locator('.recharts-wrapper')).toHaveCount(0);
  await movement.getByRole('button', { name: 'FanDuel' }).click();
  await expect(movement.getByRole('img', { name: 'Total movement chart' })).toBeVisible();
  await expect(movement.locator('.recharts-line').first().locator('.recharts-line-dot')).toHaveCount(0);
  await expect(movement.locator('.recharts-line').last().locator('.recharts-line-dot')).toHaveCount(2);
  await movement.getByRole('tab', { name: 'Spread' }).click();
  await expect(movement.getByText('No spread history')).toBeVisible();
  await movement.getByRole('button', { name: 'Compare books' }).click();
  await expect(movement.getByRole('img', { name: 'Spread movement chart' })).toBeVisible();
  await expect(movement.locator('.recharts-line-curve')).toHaveCount(2);
  expect(errors).toEqual([]);
});