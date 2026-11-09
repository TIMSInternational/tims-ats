import { expect, test, type Page } from '@playwright/test';
import { MockAssessmentsProvider } from './mock-provider';

// AS-14 / AS-7, end to end in a real browser over a MOCKED TIMS Assessments provider (see mock-provider.ts):
// HR configures the vacancy's tests from the catalog, a concurrent edit is caught by the version check, the vacancy's
// tests are assigned to a candidate after the consent notice, and the results show per test with D3/D20 and D6.

async function open(page: Page, view: 'vacancy' | 'candidate') {
  await page.addInitScript(() => window.localStorage.setItem('tims-locale', 'EN'));
  await page.goto(`/index.html?view=${view}`);
}

test('HR configures the vacancy tests from the catalog, and a concurrent edit is caught', async ({ page }) => {
  const provider = new MockAssessmentsProvider();
  await provider.install(page);
  await open(page, 'vacancy');

  const card = page.getByRole('region', { name: 'Assessments for this vacancy' });
  await expect(card.getByText('No assessments configured')).toBeVisible();

  for (const test of ['LIA', 'English', 'Personality']) {
    await card.getByLabel('Add a test').selectOption({ label: test });
    await card.getByRole('button', { name: 'Add' }).click();
  }
  const lia = card.getByRole('listitem').filter({ hasText: 'LIA' });
  const english = card.getByRole('listitem').filter({ hasText: 'English' });
  const personality = card.getByRole('listitem').filter({ hasText: 'Personality' });
  await expect(lia.getByText('Current version 1.0')).toBeVisible();
  await expect(lia.getByText('LIA is used only as a minimum threshold')).toBeVisible(); // D20
  await expect(english.getByText('English counts once, in the Languages dimension.')).toBeVisible(); // D3
  await expect(personality.getByLabel('How FIT uses it')).toBeDisabled();

  // Nothing is sent while a reason or a minimum is missing.
  await card.getByRole('button', { name: 'Save assessments' }).click();
  await expect(lia.getByText('Explain why this test is job-related')).toBeVisible();
  expect(provider.puts).toHaveLength(0);

  await lia.getByLabel('Minimum global percentile (0–100)').fill('40');
  await lia.getByLabel('Why this test is job-related').fill('Analyses data under time pressure');
  await english.getByLabel('Minimum CEFR level').selectOption('B2');
  await english.getByLabel('Why this test is job-related').fill('Serves customers in English');
  await personality.getByLabel('Why this test is job-related').fill('Interview guide');
  await card.getByRole('button', { name: 'Save assessments' }).click();

  await expect(page.getByText('Assessments saved')).toBeVisible();
  expect(provider.puts[0]).toEqual({
    expectedVersion: '0'.repeat(32),
    assessments: [
      { instrument: 'lia', use: 'scored', min: { globalPercentile: 40 }, reason: 'Analyses data under time pressure' },
      { instrument: 'english', use: 'gate', min: { cefr: 'B2' }, reason: 'Serves customers in English' },
      { instrument: 'personality', use: 'advisory', reason: 'Interview guide' },
    ],
  });

  // Another HR session saves meanwhile: this editor's next save is refused, and their version is shown instead.
  provider.saveElsewhere([
    {
      instrument: 'english',
      use: 'gate',
      min: { globalPercentile: null, cefr: 'C1', level: null, score: null },
      weight: null,
      reason: 'Elsewhere',
    },
  ]);
  await lia.getByLabel('Why this test is job-related').fill('Edited here');
  await card.getByRole('button', { name: 'Save assessments' }).click();
  await expect(page.getByText('Someone else changed these assessments.')).toBeVisible();
  await expect(card.getByRole('listitem')).toHaveCount(1);
  await expect(card.getByLabel('Why this test is job-related')).toHaveValue('Elsewhere');
});

test('HR assigns the vacancy tests after the consent notice, then reads each result', async ({ page }) => {
  const provider = new MockAssessmentsProvider();
  provider.saveElsewhere([
    {
      instrument: 'lia',
      use: 'scored',
      min: { globalPercentile: 40, cefr: null, level: null, score: null },
      weight: null,
      reason: 'Analysis',
    },
    {
      instrument: 'english',
      use: 'gate',
      min: { globalPercentile: null, cefr: 'B2', level: null, score: null },
      weight: null,
      reason: 'Customers',
    },
    { instrument: 'itcia', use: 'advisory', min: null, weight: null, reason: 'Not offered to this org' },
  ]);
  await provider.install(page);
  await open(page, 'candidate');

  const card = page.getByRole('region', { name: 'TIMS Assessments' });
  await expect(card.getByText('No assessments assigned yet.')).toBeVisible();
  await card.getByRole('button', { name: "Assign the vacancy's assessments" }).click();

  const dialog = page.getByRole('dialog', { name: 'Assign assessments: Data Analyst' });
  await expect(dialog.getByTestId('assign-instruments').getByRole('listitem')).toHaveText(['LIA', 'English']);
  await expect(dialog.getByText('1 listed tests are not offered')).toBeVisible();

  // The attested age band is required before the notice.
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByTestId('assessment-consent-notice')).toHaveCount(0);
  await dialog.getByLabel('18 or older').check();
  await dialog.getByLabel('Extra time (accommodation)').selectOption('1.5');
  await dialog.getByRole('button', { name: 'Continue' }).click();

  const notice = dialog.getByTestId('assessment-consent-notice');
  await expect(notice).toContainText('TIMS Assessments');
  await expect(notice).toContainText('Acme Corp');
  await expect(notice).toContainText('Selection for the vacancy “Data Analyst”');
  await expect(notice.getByRole('note')).toContainText('DRAFT PENDING LEGAL REVIEW'); // D22
  const assign = dialog.getByRole('button', { name: 'Assign', exact: true });
  await expect(assign).toBeDisabled();
  await dialog.getByLabel('I have reviewed this notice.', { exact: false }).check();
  await assign.click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(provider.assigns[0]).toEqual({
    candidateId: 'ca000000-0000-4000-8000-000000000001',
    vacancyId: '7ac00000-0000-4000-8000-000000000001',
    instruments: [{ instrument: 'lia' }, { instrument: 'english' }],
    ageBand: '18_plus',
    timeMultiplier: 1.5,
    aids: [],
  });
  await expect(card.getByTestId('provider-status-chip')).toHaveText(['Awaiting consent', 'Awaiting consent']);
  await expect(card.getByText('Waiting for: assessment')).toHaveCount(2);

  // The provider publishes: a valid LIA result and an English result held for review.
  provider.publish('lia', { validity: 'valid', globalPercentile: 62, cefr: null });
  provider.publish('english', { validity: 'needs_review', globalPercentile: null, cefr: 'B1' });
  await page.reload();
  const lia = card.getByTestId('provider-attempt').filter({ hasText: 'LIA' });
  const english = card.getByTestId('provider-attempt').filter({ hasText: 'English' });
  await expect(lia.getByTestId('provider-status-chip')).toHaveText('Result ready');
  await expect(lia.getByText('Global percentile 62')).toBeVisible();
  await expect(lia.getByTestId('provider-result-minimum')).toHaveText('Minimum met');
  await expect(lia.getByText('Shown as minimum met or not met')).toBeVisible(); // D20: LIA counts as a threshold
  await expect(english.getByTestId('provider-status-chip')).toHaveText('Needs review');
  await expect(english.getByText('Not counted in FIT until it is reviewed', { exact: false })).toBeVisible();
  await expect(english.getByText('CEFR B1')).toHaveCount(0); // never shown as a score while under review
  await expect(english.getByText('Counts once, in Languages')).toBeVisible(); // D3
});

test('a team leader sees only "below minimum", never the level (D6)', async ({ page }) => {
  const provider = new MockAssessmentsProvider();
  provider.saveElsewhere([
    {
      instrument: 'lia',
      use: 'gate',
      min: { globalPercentile: 40, cefr: null, level: null, score: null },
      weight: null,
      reason: 'Analysis',
    },
  ]);
  provider.attempts.push({
    attemptId: crypto.randomUUID(),
    instrument: 'lia',
    status: 'result_ready',
    instrumentVersion: '1.0',
    missingConsents: [],
    result: { validity: 'valid', globalPercentile: 30, cefr: null },
  });
  provider.audience = 'team_leader';
  await provider.install(page);
  await open(page, 'candidate');

  const lia = page.getByTestId('provider-attempt').filter({ hasText: 'LIA' });
  await expect(lia.getByTestId('provider-result-minimum')).toHaveText('Below minimum');
  await expect(lia.getByTestId('provider-result-level')).toHaveCount(0);
  await expect(lia.getByText('30')).toHaveCount(0);
});
