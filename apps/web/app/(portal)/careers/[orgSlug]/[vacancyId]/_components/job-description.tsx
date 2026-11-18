import { MarkdownText } from '../../../../../../components/markdown-text';

interface JobDescriptionProps {
  description: string;
}

export function JobDescription({ description }: JobDescriptionProps) {
  return <MarkdownText source={description} className="space-y-3 text-base leading-relaxed text-secondary sm:text-subheading" />;
}
