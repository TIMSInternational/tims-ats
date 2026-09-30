interface JobDescriptionProps {
  description: string;
}

export function JobDescription({ description }: JobDescriptionProps) {
  return (
    <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#585858]">
      {description.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={index} className="font-semibold text-[#1F114C]">{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      )}
    </div>
  );
}
