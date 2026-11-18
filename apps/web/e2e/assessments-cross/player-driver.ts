import type { Frame, Locator } from '@playwright/test';

/**
 * A candidate who answers whatever the TIMS hosted player shows, through the real UI only, until the sitting ends.
 * The player draws timssuite.com's own test screens (LIA: subtest intro → practice with feedback → «Práctica
 * Completada» → timed items with «Omitir»; English: welcome → exam shell; Personality: intro → items; the suite's
 * lockdown overlay). It knows nothing of items, keys or scoring: it reads the player's public DOM contract
 * (`data-tims`, `data-kind`, `data-status`, `data-tims-part` = option | ack | submit | skip | feedback, and
 * `data-tims-key` to tell items apart) and answers each served item with a varying choice, so a practice item
 * answered wrongly is retried («Intentar de nuevo») with another option.
 *
 * Same logic as the suite's own hosted e2e driver (tims-suite apps/web/e2e/hosted/drive.ts, 6ee7ba31), plus the
 * hooks this spec needs: `onScreen` (a label per distinct screen, for the walkthrough), `stopWhen`, `leftPlayer`.
 */
export interface DriveReport {
  steps: Record<string, number>;
  items: Record<string, number>;
  answers: number;
  /**
   * Presses dispatched as a DOM click event instead of a pointer click, only while the player's frame is fullscreen
   * (lockdown): Playwright computes a pointer position from the frame's place in the page, which a fullscreen iframe
   * no longer has. A test-tool limit, not the player's: outside fullscreen every press is a real click.
   */
  synthetic: number;
  /** Times the suite's lockdown overlay was dismissed by entering fullscreen, as a candidate does. */
  lockdownEntries: number;
  /** Labels of every distinct screen seen, in order. */
  screens: string[];
}

export interface DriveOptions {
  timeoutMs: number;
  /** True once the sitting is no longer on screen (link-out: back at the ATS; embedded: the frame closed itself). */
  leftPlayer?: () => boolean;
  /** Stop before answering this item (by `data-tims-item` type, or by screen label). */
  stopWhen?: (itemType: string, label: string) => boolean;
  /** Called before the candidate acts on a screen, with a label naming it (e.g. to take a screenshot). */
  onScreen?: (label: string) => Promise<void>;
}

/** Reads in one pass: an element can vanish between two reads when the step re-renders; the next pass retries. */
const READ_MS = 2_000;
/** Longer than the SDK's longest wait (a Retry-After of up to 2 minutes). */
const STALL_MS = 150_000;
const TEXT =
  'Primero definiría el objetivo y los datos disponibles, luego revisaría las fuentes, ' +
  'compararía los resultados con criterio propio y documentaría las decisiones y los riesgos antes de usarlos.';

interface Ctx {
  f: Frame;
  report: DriveReport;
  opts: DriveOptions;
}

async function seen(ctx: Ctx, label: string): Promise<void> {
  if (ctx.report.screens[ctx.report.screens.length - 1] !== label) ctx.report.screens.push(label);
  await ctx.opts.onScreen?.(label);
}

/** Click, or dispatch the click event while the frame is fullscreen (see DriveReport.synthetic). */
async function press(ctx: Ctx, l: Locator): Promise<void> {
  const { f, report } = ctx;
  // The suite's lockdown overlay («Pantalla Completa Requerida») covers the test until the candidate presses
  // «Entrar en Pantalla Completa», exactly as on timssuite.com: do what a candidate does.
  const overlay = f.locator('[data-testid="lockdown-overlay"]');
  if (await overlay.isVisible().catch(() => false)) {
    await seen(ctx, 'lockdown-overlay');
    report.lockdownEntries++;
    await overlay.getByRole('button').first().click({ timeout: 10_000 });
    await overlay.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
  }
  const fullscreen = await f.evaluate(() => document.fullscreenElement !== null).catch(() => false);
  if (fullscreen) {
    report.synthetic++;
    await l.dispatchEvent('click');
  } else await l.click({ timeout: 10_000 });
}

async function visible(l: Locator): Promise<boolean> {
  return (
    (await l.count()) > 0 &&
    (await l
      .first()
      .isVisible()
      .catch(() => false))
  );
}

async function screenSignature(f: Frame): Promise<string> {
  return f.evaluate(() => {
    const step = document.querySelector('[data-tims="step"]');
    const items = [...document.querySelectorAll('[data-tims="item"]')]
      .map(
        (i) =>
          `${i.getAttribute('data-tims-item')}:${i.getAttribute('aria-labelledby') ?? i.getAttribute('data-tims-key')}:${i.getAttribute('data-status')}:${(i.textContent ?? '').slice(0, 60)}`,
      )
      .join('|');
    const player = document.querySelector('[data-tims="player"]');
    return `${player?.getAttribute('data-phase')}#${step?.getAttribute('data-kind')}#${(step?.textContent ?? '').slice(0, 80)}#${items}`;
  });
}

/** A name for the suite screen on display (one label per kind of screen, not per item). */
async function screenLabel(step: Locator): Promise<string> {
  return step
    .evaluate((el) => {
      const kind = el.getAttribute('data-kind') ?? '?';
      const text = el.textContent ?? '';
      const item = el.querySelector('[data-tims="item"]');
      const type = item?.getAttribute('data-tims-item') ?? '';
      if (kind === 'instructions') return 'subtest-intro';
      const feedback = el.querySelector('[data-tims-part="feedback"]');
      if (feedback)
        return feedback.getAttribute('data-outcome') === 'incorrect'
          ? 'practice-feedback-wrong'
          : 'practice-feedback-right';
      if (/Práctica Completada|Practice Complete/i.test(text)) return 'practice-complete';
      if (kind === 'section_break') return 'section-break';
      if (kind === 'practice') return 'practice-item';
      if (type.startsWith('lia_'))
        return el.querySelector('[data-tims-part="skip"]') ? 'timed-item-omitir' : 'timed-item';
      if (type === 'multiple_choice')
        return item?.querySelector('[data-english-part="passage"]') ? 'english-reading' : 'english-choice';
      if (type === 'audio_prompt') return 'english-listening';
      if (type === 'audio_record') return 'english-speaking';
      return `${kind}-${type || 'page'}`;
    })
    .catch(() => 'unknown');
}

async function fillItem(ctx: Ctx, item: Locator, attempt: number): Promise<void> {
  const { f } = ctx;
  let filled = 0;
  const add = item.locator('[data-tims-part="add"]');
  for (let i = 0; i < Math.min(attempt, 4); i++)
    if ((await add.count()) > 0 && (await add.first().isEnabled())) await press(ctx, add.first());
  for (const ta of await item.locator('textarea').all()) {
    if (!(await ta.isEnabled())) continue;
    const max = Number((await ta.getAttribute('maxlength')) ?? '400');
    await ta.fill(TEXT.slice(0, Math.max(1, Math.min(max, TEXT.length))));
  }
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
    await press(ctx, r);
    if (!(await r.isChecked())) await r.check({ force: true }).catch(() => undefined);
  }
  const boxes = item.locator('input[type="checkbox"]');
  if ((await boxes.count()) > 0 && (await boxes.first().isEnabled())) await press(ctx, boxes.first());
  // `immediate` choice mode (LIA): each option is a button that answers; English selects with it, then «Siguiente».
  const options = item.locator('button[data-tims-part="option"]');
  const k = await options.count();
  if (k > 0 && (await options.first().isEnabled())) await press(ctx, options.nth(attempt % k));
  // English listening: the clip must be played (or fail) before «Siguiente»; speaking records a take, then stops.
  const play = item.locator('[data-tims-part="audio"] button').first();
  if ((await play.count()) > 0 && (await play.isEnabled())) {
    await press(ctx, play);
    await item
      .locator('[data-tims-part="submit"]:enabled')
      .waitFor({ timeout: 15_000 })
      .catch(() => undefined);
  }
  const record = item.locator('[data-tims-part="record"]');
  if ((await record.count()) > 0 && (await record.first().isEnabled())) {
    await press(ctx, record.first());
    const stop = item.locator('[data-tims-part="stop"]');
    await stop.waitFor({ timeout: 10_000 }).catch(() => undefined);
    await f.waitForTimeout(1_500);
    if ((await stop.count()) > 0) await press(ctx, stop.first());
    await item
      .locator('[data-tims-part="submit"]:enabled')
      .waitFor({ timeout: 10_000 })
      .catch(() => undefined);
  }
}

async function submitItem(ctx: Ctx, item: Locator): Promise<boolean> {
  const submit = item.locator('[data-tims-part="submit"]');
  for (let tries = 0; tries < 4; tries++) {
    if ((await submit.count()) === 0) return true; // immediate mode: the choice answered it
    if (await submit.first().isEnabled()) {
      await press(ctx, submit.first());
      return true;
    }
    const add = item.locator('[data-tims-part="add"]');
    if ((await add.count()) === 0 || !(await add.first().isEnabled())) return false;
    await press(ctx, add.first());
    for (const inp of await item.locator('input[type="text"], input:not([type])').all())
      if ((await inp.inputValue()) === '') await inp.fill(`Elemento extra ${tries + 1}`);
  }
  return false;
}

const itemKey = (el: Element | null): string =>
  el
    ? `${el.getAttribute('data-tims-item')}:${el.getAttribute('aria-labelledby') ?? el.getAttribute('data-tims-key')}:${(el.textContent ?? '').slice(0, 160)}`
    : '';

/** One pass of the loop: returns 'end' when the sitting is over, or a stop report. */
async function tick(
  ctx: Ctx,
  attempts: Map<string, number>,
): Promise<'continue' | 'end' | { stoppedAt: string; label: string }> {
  const { f, report, opts } = ctx;
  if (await visible(f.locator('[data-testid="sitting-ended"], [data-tims-part="finished"]'))) {
    await seen(ctx, 'receipt');
    return 'end';
  }
  const retry = f.locator('[data-tims-part="error"] [data-tims-part="action"]');
  if (await visible(retry)) {
    await press(ctx, retry.first());
    await f.waitForTimeout(500);
    return 'continue';
  }
  const step = f.locator('[data-tims="step"]').first();
  if ((await step.count()) === 0) {
    await f.waitForTimeout(100);
    return 'continue';
  }
  const kind = (await step.getAttribute('data-kind', { timeout: READ_MS }).catch(() => null)) ?? '?';
  // The suite's own screens mark every button that moves the sitting on without answering (a subtest intro's
  // «Comenzar Práctica», the practice feedback's «Intentar de nuevo» / «Siguiente», «Comenzar Sección») as
  // `data-tims-part="ack"`, wherever it sits in the step.
  const suiteAck = step.locator('[data-tims-part="ack"]');
  if (await visible(suiteAck)) {
    // The screen can move on between the visibility check and this read: give up quickly and let the next tick look again.
    if (await suiteAck.first().isEnabled({ timeout: 2_000 }).catch(() => false)) {
      report.steps[kind] = (report.steps[kind] ?? 0) + 1;
      await seen(ctx, await screenLabel(step));
      await press(ctx, suiteAck.first());
    }
    await f.waitForTimeout(150);
    return 'continue';
  }
  if (kind === 'instructions' || kind === 'section_break' || kind === 'done') {
    const ack = step.locator(':scope > [data-tims-part="action"]');
    if ((await ack.count()) > 0 && (await ack.first().isEnabled())) {
      report.steps[kind] = (report.steps[kind] ?? 0) + 1;
      await seen(ctx, await screenLabel(step));
      const before = ((await step.textContent()) ?? '').slice(0, 80);
      await press(ctx, ack.first());
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
    } else await f.waitForTimeout(150);
    return 'continue';
  }

  const items = step.locator('[data-tims="item"]');
  if ((await step.getAttribute('data-layout', { timeout: READ_MS }).catch(() => null)) === 'all_on_page') {
    const idle = await items.evaluateAll((els) => els.filter((e) => e.getAttribute('data-status') === 'idle').length);
    if (idle === 0) {
      await f.waitForTimeout(150);
      return 'continue';
    }
    await seen(ctx, await screenLabel(step));
    const key = `page:${((await step.textContent()) ?? '').slice(0, 120)}`;
    const n = attempts.get(key) ?? 0;
    attempts.set(key, n + 1);
    for (const item of await items.all()) {
      const type = (await item.getAttribute('data-tims-item', { timeout: READ_MS }).catch(() => null)) ?? '?';
      report.items[type] = (report.items[type] ?? 0) + 1;
      await fillItem(ctx, item, n);
    }
    const submit = step.locator('[data-tims-part="page-form"] > [data-tims-part="action"]');
    if ((await submit.count()) > 0 && (await submit.first().isEnabled())) {
      await press(ctx, submit.first());
      report.answers++;
    }
    await f.waitForTimeout(200);
    return 'continue';
  }

  const item = items.first();
  if (
    (await item.count()) === 0 ||
    (await item.getAttribute('data-status', { timeout: READ_MS }).catch(() => null)) !== 'idle'
  ) {
    await f.waitForTimeout(100);
    return 'continue';
  }
  const type = (await item.getAttribute('data-tims-item', { timeout: READ_MS }).catch(() => null)) ?? '?';
  const label = await screenLabel(step);
  await seen(ctx, label);
  if (opts.stopWhen?.(type, label)) return { stoppedAt: type, label };
  // Items of one subtest can read alike (LIA's rotated figures are all "R"): the item id tells them apart.
  const key = await item.evaluate(itemKey, undefined, { timeout: READ_MS }).catch(() => null);
  if (key === null) return 'continue';
  const n = attempts.get(key) ?? 0;
  attempts.set(key, n + 1);
  report.items[type] = (report.items[type] ?? 0) + 1;
  await fillItem(ctx, item, n);
  if (await submitItem(ctx, item)) report.answers++;
  await f
    .waitForFunction(
      (k) => {
        const el = document.querySelector('[data-tims="step"] [data-tims="item"]');
        if (!el) return true;
        // The same key as itemKey (a page function cannot close over it).
        const now = `${el.getAttribute('data-tims-item')}:${el.getAttribute('aria-labelledby') ?? el.getAttribute('data-tims-key')}:${(el.textContent ?? '').slice(0, 160)}`;
        return now !== k || el.getAttribute('data-status') !== 'idle';
      },
      key,
      { timeout: 30_000 },
    )
    .catch(() => undefined);
  return 'continue';
}

/** Answer until the sitting ends (the receipt), the candidate is back at the ATS, or `stopWhen` says to stop. */
export async function driveSitting(
  f: Frame,
  opts: DriveOptions,
): Promise<DriveReport & { stoppedAt?: string; stoppedLabel?: string }> {
  const report: DriveReport = { steps: {}, items: {}, answers: 0, synthetic: 0, lockdownEntries: 0, screens: [] };
  const ctx: Ctx = { f, report, opts };
  const attempts = new Map<string, number>();
  const deadline = Date.now() + opts.timeoutMs;
  let stuckSince = Date.now();
  let lastSig = '';
  while (Date.now() < deadline) {
    if (opts.leftPlayer?.() || f.isDetached()) return report;
    const sig = await screenSignature(f).catch(() => '');
    if (sig !== lastSig) {
      lastSig = sig;
      stuckSince = Date.now();
    } else if (Date.now() - stuckSince > STALL_MS) {
      const status = await f
        .evaluate(() =>
          [...document.querySelectorAll('[data-tims-part="status"], [role="status"], [role="alert"]')]
            .map((e) => (e.textContent ?? '').trim())
            .filter(Boolean)
            .join(' | '),
        )
        .catch(() => '');
      throw new Error(
        `the sitting made no progress for ${STALL_MS / 1000} s: ${sig.slice(0, 400)}\nstatus: ${status.slice(0, 400)}`,
      );
    }
    let r: Awaited<ReturnType<typeof tick>>;
    try {
      r = await tick(ctx, attempts);
    } catch (e) {
      // The frame closed itself mid-action (embedded: the sitting ended and the portal closed it).
      if (opts.leftPlayer?.() || f.isDetached()) return report;
      throw e;
    }
    if (r === 'end') return report;
    if (r !== 'continue') return { ...report, stoppedAt: r.stoppedAt, stoppedLabel: r.label };
  }
  throw new Error(`the sitting did not end within ${opts.timeoutMs} ms (${report.answers} answers)`);
}
