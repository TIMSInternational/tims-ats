import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── CI must run on EVERY pull request, whatever its base ────────────────────────
//
// Both workflows used to declare `pull_request: branches: [main]`. That filter meant a
// PR whose BASE IS A BRANCH — every stacked PR — ran **nothing**: no Type Check, no
// vitest, no Security Audit, no Table-ownership check, and no `verification-gate`.
// Only Vercel reported, so the PR page looked clean while zero checks had run.
//
// Observed live on PR #160 (stacked on #155): its entire check list was two Vercel
// entries. A reviewer glancing at it would read that as green.
//
// This is the same defect class as the Codex CLI exiting 0 when quota-blocked
// (.claude/rules/verification.md) and the read-only role that would have broken
// nightly check 14: a control that does not run, presenting as a control that passed.
//
// Scanning the trigger block textually rather than parsing YAML is deliberate:
// `js-yaml` is present in the pnpm store but is NOT a declared dependency of this
// package, and reaching into an undeclared transitive dep is the exact defect that
// was found in the gate work (`tsx`). The block extractor below is narrow, and the
// `push` assertion proves it actually resolves sub-keys rather than finding nothing.

const WORKFLOW_DIR = join(__dirname, '../../.github/workflows');

/**
 * The lines belonging to `key:` inside the top-level `on:` block — i.e. every line
 * indented deeper than the key itself, up to the next sibling.
 * Returns null when the key is absent, which is distinct from "present but empty".
 */
function triggerBlock(src: string, key: 'push' | 'pull_request'): string[] | null {
  const lines = src.split('\n');
  // `on:` at column 0. (YAML 1.1 folds a bare `on` to boolean true when parsed, which is
  // another reason not to hand this to a parser casually — the key is literally `on:` here.)
  const onIdx = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (onIdx === -1) return null;
  let end = lines.length;
  for (let i = onIdx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const section = lines.slice(onIdx + 1, end);
  const keyIdx = section.findIndex((l) => new RegExp(`^(\\s+)${key}:\\s*$`).test(l));
  if (keyIdx === -1) return null;
  const indent = section[keyIdx].match(/^(\s*)/)![1].length;
  const body: string[] = [];
  for (let i = keyIdx + 1; i < section.length; i++) {
    const l = section[i];
    if (l.trim() === '' || /^\s*#/.test(l)) continue;
    const thisIndent = l.match(/^(\s*)/)![1].length;
    if (thisIndent <= indent) break;
    body.push(l);
  }
  return body;
}

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({ name: f, src: readFileSync(join(WORKFLOW_DIR, f), 'utf8') }));

describe('CI triggers — a stacked PR must not silently skip every check', () => {
  it('found the workflows to check', () => {
    // Non-vacuity: an empty directory read would make every assertion below pass.
    expect(workflows.length).toBeGreaterThanOrEqual(2);
    expect(workflows.map((w) => w.name)).toEqual(expect.arrayContaining(['ci.yml', 'dotnet-platform.yml']));
  });

  it('the block extractor resolves sub-keys — proven on `push`, which DOES filter branches', () => {
    // Without this, a broken extractor returning [] would satisfy the "no branches"
    // assertion below while reading nothing at all. `push` is deliberately still pinned
    // to main, so it is the positive control for the same parser.
    for (const w of workflows) {
      const push = triggerBlock(w.src, 'push');
      expect(push, `${w.name}: no on.push block found`).not.toBeNull();
      expect(
        push!.some((l) => /^\s*branches:\s*\[main\]\s*$/.test(l)),
        `${w.name}: on.push must stay [main]`,
      ).toBe(true);
    }
  });

  it('no workflow restricts pull_request to a base branch', () => {
    const offenders: string[] = [];
    for (const w of workflows) {
      const pr = triggerBlock(w.src, 'pull_request');
      if (pr === null) continue; // a workflow with no pull_request trigger is out of scope
      if (pr.some((l) => /^\s*branches:/.test(l))) offenders.push(w.name);
    }
    expect(
      offenders,
      'These workflows filter `pull_request` by base branch, so a stacked PR (base = a branch, not main) ' +
        'runs NONE of their jobs and the PR presents as green having verified nothing. Drop the ' +
        '`branches:` filter under `pull_request`. A `paths:` filter is fine and unaffected.',
    ).toEqual([]);
  });

  it('keeps dotnet-platform’s paths filter — dropping branches must not drop that too', () => {
    const pr = triggerBlock(workflows.find((w) => w.name === 'dotnet-platform.yml')!.src, 'pull_request');
    expect(pr).not.toBeNull();
    expect(pr!.some((l) => /^\s*paths:\s*$/.test(l))).toBe(true);
    expect(pr!.some((l) => /Tims\.Platform/.test(l))).toBe(true);
  });
});
