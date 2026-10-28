# Platform legal content

These files are the text of the platform legal pages:

| Page                   | Spanish               | English               |
| ---------------------- | --------------------- | --------------------- |
| `/legal/terms`         | `es/terms.md`         | `en/terms.md`         |
| `/legal/privacy`       | `es/privacy.md`       | `en/privacy.md`       |
| `/legal/subprocessors` | `es/subprocessors.md` | `en/subprocessors.md` |
| `/legal/ai-processing` | `es/ai-processing.md` | `en/ai-processing.md` |

They are DRAFT structure only. Every section carries a `TODO (counsel)` marker for counsel to
replace. While any `TODO (counsel)` marker remains in a file, its page shows a DRAFT banner and
is marked `noindex`.

## Editing

Replace the text and remove each `TODO (counsel)` marker; no code change is needed. Replace both languages
together (a test requires es and en to be both draft or both final, with the same `##` sections). A file
may be up to 200,000 characters (`LEGAL_MAX_CONTENT_CHARS`); a longer one is refused, never truncated. The
renderer (`apps/web/lib/markdown-lite.ts`) supports a deliberately small subset:

- `#` (page title, first one only), `##`, `###` headings
- paragraphs separated by a blank line
- `-` bullet lists and `1.` numbered lists
- `**bold**` and `*italic*`

Anything else (links, tables, raw HTML) is shown as literal text. HTML is never rendered.

The subprocessor table on `/legal/subprocessors` is NOT in these files: it is generated from
`apps/web/lib/legal/subprocessors.ts`, which a test keeps in step with the vendors the code
actually calls. The Markdown file supplies only the text above the table.

## Publishing

Nothing here is visible until `NEXT_PUBLIC_LEGAL_PAGES_ENABLED=true` is set for the web app
and the app is redeployed. With the flag unset, every `/legal/*` route returns 404 and no
footer or apply-form link to these pages is rendered.
