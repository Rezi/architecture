import { expect, test } from '@playwright/test';

test('home page links to every area', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Architecture Walkthrough');
	for (const name of [
		'Common architecture',
		'Frontend architecture',
		'Backend architecture',
		'Security'
	]) {
		await expect(page.getByRole('link', { name }).first()).toBeVisible();
	}
});

test('a topic page renders content, sources and next link', async ({ page }) => {
	await page.goto('/common/what-is-architecture');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('What architecture actually is');
	await expect(page.getByRole('heading', { name: 'Sources and further reading' })).toBeVisible();
	await page.getByRole('link', { name: /Next/ }).click();
	await expect(page).toHaveURL(/separation-of-concerns/);
});

test('unknown topic gives a 404', async ({ page }) => {
	const response = await page.goto('/frontend/does-not-exist');
	expect(response?.status()).toBe(404);
});
