/**
 * A deliberately tiny Markdown subset parser for user-authored copy (vacancy descriptions).
 *
 * It produces a plain data tree — never HTML — which `MarkdownText` renders as React elements,
 * so any markup embedded in the source (`<script>`, `<img onerror>`) stays literal text.
 *
 * Supported: `#`/`##`/`###` headings, `-`/`*`/`•` bullet lists, `1.` ordered lists,
 * paragraphs separated by blank lines, single line breaks inside a paragraph,
 * `**bold**` / `__bold__` and `*italic*`.
 */

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] };

export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3; content: MdInline[] }
  | { type: 'paragraph'; lines: MdInline[][] }
  | { type: 'list'; ordered: boolean; items: MdInline[][] };

/** Bound on parsed input: descriptions are capped server-side, this is defence in depth. */
export const MARKDOWN_LITE_MAX_LENGTH = 20_000;

// Every pattern here must match in linear time: a description is up to 5000 chars of
// user-authored text and runs on every public job card. The previous heading pattern
// (`(.+?)\s*#*\s*$`) backtracked quadratically-to-cubically on long whitespace runs
// (a 5000-char heading line took ~90 s), so the closing `#` sequence is now stripped
// by `stripClosingHashes` instead of by the regex.
const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const BOLD = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__)/;
const ITALIC = /(\*[^*\n]+?\*)/;

const isWhitespace = (char: string) => char.trim() === '';

/**
 * Drops a trailing `#` run and the whitespace before it ("Title ##" -> "Title"), keeping at
 * least one character — exactly what the old `(.+?)\s*#*\s*$` capture produced, in one pass.
 */
function stripClosingHashes(text: string): string {
  let end = text.length;
  while (end > 1 && text[end - 1] === '#') end -= 1;
  while (end > 1 && isWhitespace(text[end - 1] ?? '')) end -= 1;
  return text.slice(0, end);
}

function parseItalic(text: string): MdInline[] {
  return text
    .split(ITALIC)
    .filter((part) => part.length > 0)
    .map(
      (part): MdInline =>
        part.length > 2 && part.startsWith('*') && part.endsWith('*')
          ? { type: 'em', children: [{ type: 'text', text: part.slice(1, -1) }] }
          : { type: 'text', text: part },
    );
}

export function parseInline(text: string): MdInline[] {
  return text
    .split(BOLD)
    .filter((part) => part.length > 0)
    .flatMap((part): MdInline[] => {
      const isBold =
        part.length > 4 &&
        ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__')));
      return isBold ? [{ type: 'strong', children: parseItalic(part.slice(2, -2)) }] : parseItalic(part);
    });
}

export function parseMarkdownLite(source: string): MdBlock[] {
  const lines = source.slice(0, MARKDOWN_LITE_MAX_LENGTH).replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  const open: { paragraph: MdInline[][] | null; list: { ordered: boolean; items: MdInline[][] } | null } = {
    paragraph: null,
    list: null,
  };

  const flush = () => {
    if (open.paragraph) blocks.push({ type: 'paragraph', lines: open.paragraph });
    if (open.list) blocks.push({ type: 'list', ordered: open.list.ordered, items: open.list.items });
    open.paragraph = null;
    open.list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = HEADING.exec(line.trim());
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, content: parseInline(stripClosingHashes(heading[2] ?? '')) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    const itemMatch = bullet ?? ordered;
    if (itemMatch) {
      const isOrdered = ordered !== null;
      if (open.paragraph || (open.list && open.list.ordered !== isOrdered)) flush();
      const list = open.list ?? { ordered: isOrdered, items: [] };
      list.items.push(parseInline(itemMatch[1].trim()));
      open.list = list;
      continue;
    }
    if (open.list) flush();
    const paragraph = open.paragraph ?? [];
    paragraph.push(parseInline(line.trim()));
    open.paragraph = paragraph;
  }
  flush();
  return blocks;
}

function inlineToText(nodes: MdInline[]): string {
  return nodes.map((node) => (node.type === 'text' ? node.text : inlineToText(node.children))).join('');
}

/** Markdown-free single-line preview (job cards), e.g. "Responsabilidades: Liderar el equipo …". */
export function markdownToPlainText(source: string): string {
  return parseMarkdownLite(source)
    .flatMap((block) => {
      if (block.type === 'heading') return [inlineToText(block.content)];
      if (block.type === 'paragraph') return block.lines.map(inlineToText);
      return block.items.map(inlineToText);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
