import type { ReactNode } from 'react';
import { parseMarkdownLite, type MdInline } from '../lib/markdown-lite';

interface MarkdownTextProps {
  source: string;
  className?: string;
}

function renderInline(nodes: MdInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === 'text') return node.text;
    if (node.type === 'strong') {
      return (
        <strong key={key} className="font-semibold text-[#1F114C]">
          {renderInline(node.children, key)}
        </strong>
      );
    }
    return <em key={key}>{renderInline(node.children, key)}</em>;
  });
}

const HEADING_CLASS = {
  1: 'text-[16px] font-bold text-[#1F114C]',
  2: 'text-[15px] font-bold text-[#1F114C]',
  3: 'text-[14px] font-semibold text-[#1F114C]',
} as const;

/**
 * Renders the small Markdown subset from `lib/markdown-lite` as React elements.
 * No HTML string is ever produced, so markup inside the source renders as literal text.
 */
export function MarkdownText({ source, className }: MarkdownTextProps) {
  const blocks = parseMarkdownLite(source);
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        if (block.type === 'heading') {
          const Tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5';
          return (
            <Tag key={key} className={HEADING_CLASS[block.level]}>
              {renderInline(block.content, key)}
            </Tag>
          );
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={key} className={`space-y-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={key}>
            {block.lines.map((line, lineIndex) => (
              <span key={`${key}-${lineIndex}`}>
                {lineIndex > 0 && <br />}
                {renderInline(line, `${key}-${lineIndex}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
