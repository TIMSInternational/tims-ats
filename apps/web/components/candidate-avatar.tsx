'use client';

import { getInitials, getAvatarColor } from '../lib/format-utils';

interface CandidateAvatarProps {
  firstName: string;
  lastName: string;
  avatar?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** The person's name is visible next to the avatar: hide the initials tile from assistive tech. */
  decorative?: boolean;
}

// The smallest sizes keep 11px text (the platform minimum); xs shows one initial so it fits.
const SIZES = {
  xs: 'size-6 text-caption',
  sm: 'size-8 text-caption',
  md: 'size-9 text-callout',
  lg: 'size-12 text-subheading',
  xl: 'size-20 text-2xl',
};

export function CandidateAvatar({
  firstName,
  lastName,
  avatar,
  size = 'md',
  decorative = false,
}: CandidateAvatarProps) {
  const name = `${firstName} ${lastName}`;
  const cls = SIZES[size];

  if (avatar) {
    return <img src={avatar} alt={decorative ? '' : name} className={`${cls} rounded-full object-cover shrink-0`} />;
  }

  return (
    <div
      className={`${cls} rounded-full ${getAvatarColor(name)} flex items-center justify-center text-white font-semibold shrink-0`}
      aria-hidden={decorative || undefined}
    >
      {size === 'xs' ? getInitials(name).slice(0, 1) : getInitials(name)}
    </div>
  );
}
