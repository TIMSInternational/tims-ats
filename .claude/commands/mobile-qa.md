---
description: Mobile QA at 390x844 via Playwright MCP — overflow scan with boxes snapshots, never submits forms, deletes all artifacts
allowed-tools:
  - Bash
  - Read
  - mcp__plugin_playwright_playwright__*
---

# /mobile-qa — 390×844 Playwright QA Sweep

QA the app (or the pages/flows the user names) at iPhone viewport 390×844 using the Playwright MCP, hunting horizontal overflow, clipped controls, and unreachable buttons.

## Execution Contract (non-negotiable)

You MUST use `browser_snapshot` with `{boxes: true}` for geometry checks. You are forbidden from:

- **Submitting ANY form** (apply, add-candidate, create-vacancy, invites, …) — this app runs against the LIVE Supabase database. Fill steps to advance wizards if needed, but NEVER click the final submit.
- Using `page.screenshot` / `browser_take_screenshot` while a modal is open — it flakily HANGS at capture level. Boxes snapshots catch everything screenshots would.
- Leaving artifacts behind: every screenshot, snapshot file, or temp script MUST be deleted before you finish.
- Marking a page "clean" without actually running the overflow check on it.

**Fail-closed guardrail**: if the browser/MCP session dies mid-sweep, report which pages WERE checked and which weren't — never extrapolate "the rest is probably fine".

## Setup

1. Dev server: `cd apps/web && PORT=3001 pnpm dev` (background; reuse if already running).
2. Viewport: resize browser to **390×844**.
3. Login (org admin `admin@tims.co` / `TimsAts2026!`): fill `input[type=email]` / `input[type=password]` via the native value setter, then `form.requestSubmit()` on the form's OWN submit button — a generic button-find clicks the Google OAuth button instead.
4. Public portal (`/careers/...`): logged-in users get redirected off it — clear cookies + storage first (or use a fresh context).
5. Platform pages: login as `federico@nexadev.ai` / `TimsAts2026!`.

## Overflow scan (per page)

Run in-page via evaluate:

```js
const out = [];
if (document.documentElement.scrollWidth > document.documentElement.clientWidth)
  out.push(`PAGE OVERFLOW: ${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth}`);
for (const el of document.querySelectorAll('*')) {
  const r = el.getBoundingClientRect();
  if (r.right > window.innerWidth + 1 || r.left < -1)
    out.push(`${el.tagName}.${String(el.className).slice(0,60)} → left:${Math.round(r.left)} right:${Math.round(r.right)}`);
}
out.slice(0, 20);
```

For modals/wizards: open them, walk each step (fill, never submit), and use `browser_snapshot {boxes: true}` to verify buttons/inputs are inside the viewport and reachable (shared Modal has `max-h-[calc(100dvh-2rem)] overflow-y-auto` — confirm scrollability covers tall steps).

## Teardown

- Delete ALL artifacts (screenshots, snapshot dumps, temp scripts): verify with `ls` that nothing remains.
- Close the browser session.

## Output

Per page/flow: ✅ clean or ❌ findings (element, geometry, what the user would experience). End with a summary table and a fix-list ordered by user impact.
