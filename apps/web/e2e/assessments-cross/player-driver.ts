import type { Frame, Locator } from '@playwright/test';

/**
 * A candidate who answers whatever the TIMS hosted player shows, through the real UI only, until the
 * sitting ends. It knows nothing of items, keys or scoring: it reads the player's public DOM contract
 * (`data-tims`, `data-kind`, `data-status`, `data-tims-part`) and answers each served item with a
 * varying choice, so a practice item that needs another answer is retried with another option.
 */
export interface DriveReport {
  steps: Record<string, number>;
  items: Record<string, number>;
  answers: number;
}

const STALL_MS = 150_000;
const TEXT =
  'Primero definiría el objetivo y los datos disponibles, luego revisaría las fuentes y documentaría las decisiones.';

async function visible(l: Locator): Promise<boolean> {
  return (
    (await l.count()) > 0 &&
    (await l
      .first()
      .isVisible()
      .catch(() => false))
  );
}

async function signature(f: Frame): Promise<string> {
  return f.evaluate(() => {
    const step = document.querySelector('[data-tims="step"]');
    const items = [...document.querySelectorAll('[data-tims="item"]')]
      .map(
        (i) =>
          `${i.getAttribute('aria-labelledby')}:${i.getAttribute('data-status')}:${(i.textContent ?? '').slice(0, 60)}`,
      )
      .join('|');
    return `${step?.getAttribute('data-kind')}#${(step?.textContent ?? '').slice(0, 80)}#${items}`;
  });
}

async function fillItem(item: Locator, attempt: number): Promise<void> {
  const add = item.locator('[data-tims-part="add"]');
  for (let i = 0; i < Math.min(attempt, 4); i++)
    if ((await add.count()) > 0 && (await add.first().isEnabled())) await add.first().click();
  for (const ta of await item.locator('textarea').all()) {
    if (!(await ta.isEnabled())) continue;
    const max = Number((await ta.getAttribute('maxlength')) ?? '400');
    await ta.fill(TEXT.slice(0, Math.max(1, Math.min(max, TEXT.length))));
  }
  let filled = 0;
  for (const inp of await item.locator('input[type="text"], input:not([type])').all())
    if (await inp.isEnabled()) await inp.fill(`Elemento ${attempt + 1}.${++filled}`);
  for (const sel of await item.locator('select').all()) {
    const n = await sel.locator('option').count();
    if (n > 1 && (await sel.isEnabled())) await sel.selectOption({ index: 1 + (attempt % (n - 1)) });
  }
  const groups = await item.evaluate((el) => [
    ...new Set([...el.querySelectorAll('input[type="radio"]')].map((r) => (r as HTMLInputElement).name)),
  ]);
  for (const [g, name] of groups.entries()) {
    const radios = item.locator(`input[type="radio"][name="${name}"]`);
    const n = await radios.count();
    if (n === 0) continue;
    const r = radios.nth((attempt + g) % n);
    if (!(await r.isEnabled())) continue;
    await r.click();
    if (!(await r.isChecked())) await r.check({ force: true }).catch(() => undefined);
  }
  const boxes = item.locator('input[type="checkbox"]');
  if ((await boxes.count()) > 0 && (await boxes.first().isEnabled())) await boxes.first().click();
  const options = item.locator('button[data-tims-part="option"]');
  const k = await options.count();
  if (k > 0 && (await options.first().isEnabled())) await options.nth(attempt % k).click();
}

async function submitItem(item: Locator): Promise<boolean> {
  const submit = item.locator('[data-tims-part="submit"]');
  for (let tries = 0; tries < 4; tries++) {
    if ((await submit.count()) === 0) return true;
    if (await submit.first().isEnabled()) {
      await submit.first().click();
      return true;
    }
    const add = item.locator('[data-tims-part="add"]');
    if ((await add.count()) === 0 || !(await add.first().isEnabled())) return false;
    await add.first().click();
    for (const inp of await item.locator('input[type="text"], input:not([type])').all())
      if ((await inp.inputValue()) === '') await inp.fill(`Elemento extra ${tries + 1}`);
  }
  return false;
}

/**
 * Answer until the player reports the end or leaves (the return_url), or until `stopWhen` says to stop
 * (e.g. the first English speaking item). Returns what it saw.
 */
export async function driveSitting(
  f: Frame,
  opts: {
    timeoutMs: number;
    leftPlayer: () => boolean;
    stopWhen?: (itemType: string) => boolean;
    /** Called before the candidate acts on a step (an instructions screen or an item), e.g. to take a screenshot. */
    onScreen?: (what: string) => Promise<void>;
  },
): Promise<DriveReport & { stoppedAt?: string }> {
  const report: DriveReport = { steps: {}, items: {}, answers: 0 };
  const attempts = new Map<string, number>();
  const deadline = Date.now() + opts.timeoutMs;
  let stuckSince = Date.now();
  let last = '';
  while (Date.now() < deadline) {
    if (opts.leftPlayer()) return report;
    if (await visible(f.locator('[data-testid="sitting-ended"], [data-tims-part="finished"]'))) return report;
    const sig = await signature(f).catch(() => '');
    if (sig !== last) {
      last = sig;
      stuckSince = Date.now();
    } else if (Date.now() - stuckSince > STALL_MS)
      throw new Error(`the sitting made no progress: ${sig.slice(0, 300)}`);

    const retry = f.locator('[data-tims-part="error"] [data-tims-part="action"]');
    if (await visible(retry)) {
      await retry
        .first()
        .click()
        .catch(() => undefined);
      await f.waitForTimeout(500).catch(() => undefined);
      continue;
    }
    const step = f.locator('[data-tims="step"]').first();
    if ((await step.count().catch(() => 0)) === 0) {
      await f.waitForTimeout(150).catch(() => undefined);
      continue;
    }
    const kind = (await step.getAttribute('data-kind').catch(() => null)) ?? '?';
    if (kind === 'instructions' || kind === 'section_break' || kind === 'done') {
      const ack = step.locator(':scope > [data-tims-part="action"]');
      if (
        (await ack.count()) > 0 &&
        (await ack
          .first()
          .isEnabled()
          .catch(() => false))
      ) {
        report.steps[kind] = (report.steps[kind] ?? 0) + 1;
        await opts.onScreen?.(kind);
        const before = ((await step.textContent().catch(() => '')) ?? '').slice(0, 80);
        await ack
          .first()
          .click()
          .catch(() => undefined);
        await f
          .waitForFunction(
            (s) => {
              const el = document.querySelector('[data-tims="step"]');
              return !el || el.textContent?.slice(0, 80) !== s;
            },
            before,
            { timeout: 30_000 },
          )
          .catch(() => undefined);
      } else await f.waitForTimeout(150).catch(() => undefined);
      continue;
    }
    const items = step.locator('[data-tims="item"]');
    if ((await step.getAttribute('data-layout').catch(() => null)) === 'all_on_page') {
      const idle = await items
        .evaluateAll((els) => els.filter((e) => e.getAttribute('data-status') === 'idle').length)
        .catch(() => 0);
      if (idle === 0) {
        await f.waitForTimeout(150).catch(() => undefined);
        continue;
      }
      const key = `page:${((await step.textContent()) ?? '').slice(0, 120)}`;
      await opts.onScreen?.(`page:${(await items.first().getAttribute('data-tims-item')) ?? '?'}`);
      const n = attempts.get(key) ?? 0;
      attempts.set(key, n + 1);
      for (const item of await items.all()) {
        const type = (await item.getAttribute('data-tims-item')) ?? '?';
        report.items[type] = (report.items[type] ?? 0) + 1;
        await fillItem(item, n);
      }
      const submit = step.locator('[data-tims-part="page-form"] > [data-tims-part="action"]');
      if ((await submit.count()) > 0 && (await submit.first().isEnabled())) {
        await submit.first().click();
        report.answers++;
      }
      await f.waitForTimeout(200).catch(() => undefined);
      continue;
    }
    const item = items.first();
    if (
      (await item.count().catch(() => 0)) === 0 ||
      (await item.getAttribute('data-status').catch(() => null)) !== 'idle'
    ) {
      await f.waitForTimeout(100).catch(() => undefined);
      continue;
    }
    const type = (await item.getAttribute('data-tims-item')) ?? '?';
    await opts.onScreen?.(type);
    if (opts.stopWhen?.(type)) return { ...report, stoppedAt: type };
    const key = `${type}:${await item.getAttribute('aria-labelledby')}:${((await item.textContent()) ?? '').slice(0, 160)}`;
    const n = attempts.get(key) ?? 0;
    attempts.set(key, n + 1);
    report.items[type] = (report.items[type] ?? 0) + 1;
    await fillItem(item, n);
    if (await submitItem(item)) report.answers++;
    await f
      .waitForFunction(
        (k) => {
          const el = document.querySelector('[data-tims="step"] [data-tims="item"]');
          if (!el) return true;
          const now = `${el.getAttribute('data-tims-item')}:${el.getAttribute('aria-labelledby')}:${(el.textContent ?? '').slice(0, 160)}`;
          return now !== k || el.getAttribute('data-status') !== 'idle';
        },
        key,
        { timeout: 30_000 },
      )
      .catch(() => undefined);
  }
  throw new Error(`the sitting did not end within ${opts.timeoutMs} ms (${report.answers} answers)`);
}
