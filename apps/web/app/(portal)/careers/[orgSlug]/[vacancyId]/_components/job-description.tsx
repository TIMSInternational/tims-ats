import { MarkdownText } from '../../../../../../components/markdown-text';

interface JobDescriptionProps {
  description: string;
}

export function JobDescription({ description }: JobDescriptionProps) {
  return <MarkdownText source={description} className="space-y-3 text-[14px] leading-relaxed text-[#585858]" />;
}
