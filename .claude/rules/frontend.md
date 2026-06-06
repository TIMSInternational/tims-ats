---
paths:
  - "apps/web/**"
  - "packages/ui/**"
  - "packages/i18n/**"
---

# Frontend Patterns, Tailwind & Next.js Safety

## Frontend Patterns

- **Shared UI components** in `apps/web/components/`: KpiCard, DataTable, StatusBadge, EmptyState, Modal (with focus trap), Drawer, Skeleton. No duplicating UI code.
- **react-hook-form + Zod** for all forms. No raw `useState` per field.
- **`onError` toast on every mutation.** Import `toast()` from `lib/toast.ts`.
- **Loading + Error + Empty states.** Every query page handles all 3.
- **No hardcoded strings.** All text through `lib/i18n`. Keys in `es.json`/`en.json`.

## CSS / Tailwind

- **Design tokens via `@theme` in globals.css.** Use `bg-brand`, `text-muted`, `border-border`, `bg-surface`.
- **No inline `style={{}}`.** All Tailwind.
- **No magic numbers.** Use spacing scale.

## Next.js Safety Rules

- **Use `import 'server-only'`** in all server modules. Prevents server code from being bundled into client.
- **Keep Next.js patched.** CVE-2025-55182 (React2Shell) was CVSS 10.0 — RCE via Server Components.
- **Never expose server env vars to client.** Only `NEXT_PUBLIC_*` prefixed vars reach the browser.
- **No `dangerouslySetInnerHTML`.** If rendering user HTML (job descriptions, candidate notes), sanitize with DOMPurify.

## Known refactors pending

- Refactor pages to use shared KpiCard/DataTable components
  (god-component splits + i18n wiring were completed June 2026 — see `docs/REMAINING-WORK.md`)
