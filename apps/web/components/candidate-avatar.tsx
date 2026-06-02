'use client';

import { getInitials, getAvatarColor } from '../lib/format-utils';

interface CandidateAvatarProps {
  firstName: string;
  lastName: string;
  avatar?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: 'w-7 h-7 text-[9px]',
  md: 'w-9 h-9 text-[11px]',
  lg: 'w-12 h-12 text-[13px]',
};

export function CandidateAvatar({ firstName, lastName, avatar, size = 'md' }: CandidateAvatarProps) {
  const name = `${firstName} ${lastName}`;
  const cls = SIZES[size];

  if (avatar) {
    return <img src={avatar} alt={name} className={`${cls} rounded-full object-cover shrink-0`} />;
  }

  return (
    <div className={`${cls} rounded-full ${getAvatarColor(name)} flex items-center justify-center text-white font-bold shrink-0`}>
      {getInitials(name)}
    </div>
  );
}
