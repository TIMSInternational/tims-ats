'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useI18n } from '../../../../../lib/i18n';

interface Tag {
  id: string;
  tag: string;
  source: string;
}

function getTagStyle(source: string): string {
  if (source === 'ai') return 'bg-teal-50 text-teal-600 border border-teal-200';
  if (source === 'skill') return 'bg-blue-50 text-blue-600';
  if (source === 'category') return 'bg-purple-50 text-purple-600';
  return 'bg-blue-50 text-blue-600';
}

export function TagsCard({ tags, candidateId }: { tags: Tag[]; candidateId: string }) {
  const { t } = useI18n();
  const [newTag, setNewTag] = useState('');
  const utils = trpc.useUtils();

  const addTag = trpc.candidate.addTag.useMutation({
    onSuccess: () => { utils.candidate.getById.invalidate({ id: candidateId }); setNewTag(''); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const removeTag = trpc.candidate.removeTag.useMutation({
    onSuccess: () => { utils.candidate.getById.invalidate({ id: candidateId }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const handleAdd = () => {
    if (!newTag.trim()) return;
    addTag.mutate({ candidateId, tag: newTag.trim() });
  };

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.candidates.tags}</h3>
      {tags.length === 0 ? (
        <p className="text-xs text-[#8B8B8B] mb-3">{t.candidates.noTags}</p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          {tags.map((tag) => (
            <span
              key={tag.id}
              className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full ${getTagStyle(tag.source)}`}
            >
              {tag.source === 'ai' && 'IA: '}
              {tag.tag}
              <button
                onClick={() => removeTag.mutate({ candidateId, tag: tag.tag })}
                className="opacity-60 hover:opacity-100 ml-0.5"
                disabled={removeTag.isPending}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder={t.candidates.addTag}
          maxLength={50}
          className="flex-1 h-8 px-3 rounded-lg border border-[#EDEDED] text-xs focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
        />
        <button
          onClick={handleAdd}
          disabled={!newTag.trim() || addTag.isPending}
          className="h-8 px-3 rounded-lg bg-[#1F114C] text-white text-xs font-medium hover:bg-[#2a1866] transition disabled:opacity-50"
        >
          +
        </button>
      </div>
    </div>
  );
}
