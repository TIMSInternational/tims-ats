import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { CANDIDATE, MockProviderAdmin } from './mock-provider-admin';

// Round 12, end to end in a real browser over a MOCKED TIMS Assessments provider (mock-provider-admin.ts): the platform
// owner binds an organization, reads its state, unbinds it safely (refused while open sittings remain, then confirmed
// with their cancellation), and runs one candidate's DSAR export (a download) and erasure (after a confirmation).

async function open(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('tims-locale', 'EN'));
  await page.goto('/index.html?view=platform');
}

test('the platform owner binds an organization, then unbinds it only once its open sittings are dealt with', async ({
  page,
}) => {
  const provider = new MockProviderAdmin();
  await provider.install(page);
  await open(page);

  const section = page.getByRole('region', { name: 'TIMS Assessments' });
  await expect(section.getByText('Not bound')).toBeVisible();
  await section.getByLabel('LIA').check();
  await section.getByLabel('English', { exact: true }).check();
  await section.getByLabel('Default language').selectOption('en');
  await section.getByRole('button', { name: 'Save binding' }).click();

  await expect(section.getByText('Bound', { exact: true })).toBeVisible();
  await expect(section.getByText('LIA, English')).toBeVisible();
  expect(provider.binds).toEqual([
    { organizationId: '0a000000-0000-4000-8000-000000000001', instruments: ['lia', 'english'], defaultLocale: 'en' },
  ]);
  await expect(section.getByText('Unfinished tests: 2').first()).toBeVisible();

  // The confirmation: nothing is sent until the consequence is acknowledged.
  await section.getByRole('button', { name: 'Unbind the organization' }).click();
  const dialog = page.getByRole('dialog', { name: 'Unbind Acme Corp from TIMS Assessments?' });
  const unbind = dialog.getByRole('button', { name: 'Unbind', exact: true });
  await expect(unbind).toBeDisabled();
  await dialog.getByLabel('I understand that the organization will stop receiving').check();

  // Without cancelling the open sittings, the server refuses and says what is left.
  await unbind.click();
  await expect(dialog.getByRole('alert')).toContainText('Not unbound: open work remains.');
  expect(provider.unbinds).toEqual([{ cancelOpenAttempts: false }]);

  // Confirmed with their cancellation: cancelled at the provider first, then unbound.
  await dialog.getByLabel('Cancel the 2 unfinished tests first').check();
  await unbind.click();
  await expect(dialog).toBeHidden();
  expect(provider.cancelledAtProvider).toEqual([2]);
  await expect(section.getByText('Unbound (the provider tenant is kept for data export and erasure)')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Unbind the organization' })).toHaveCount(0);
});

test('the platform owner downloads a candidate DSAR export and erases after confirming', async ({ page }) => {
  const provider = new MockProviderAdmin();
  provider.bound = true;
  provider.active = true;
  provider.instruments = ['lia'];
  await provider.install(page);
  await open(page);

  const dsar = page.getByRole('region', { name: 'Data subject rights (DSAR)' });
  const id = dsar.getByLabel('Candidate ID');
  await id.fill('not-a-uuid');
  await dsar.getByRole('button', { name: 'Download export' }).click();
  await expect(dsar.getByText('Enter a valid candidate ID (UUID).')).toBeVisible();

  await id.fill(CANDIDATE);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dsar.getByRole('button', { name: 'Download export' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`tims-assessments-export-${CANDIDATE}.json`);
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as { providerExports: unknown[] };
  expect(exported.providerExports).toHaveLength(1);
  await expect(dsar.getByText('Export downloaded.')).toBeVisible();

  await dsar.getByRole('button', { name: 'Erase data at the provider' }).click();
  const confirm = page.getByRole('dialog', { name: "Erase this candidate's assessment data?" });
  await expect(confirm).toContainText(CANDIDATE);
  expect(provider.erasures).toEqual([]); // nothing before the confirmation
  await confirm.getByRole('button', { name: 'Erase', exact: true }).click();
  await expect(dsar.getByText('Erasure requested for 1 of 1 subjects.')).toBeVisible();
  expect(provider.erasures).toEqual([CANDIDATE]);
});
