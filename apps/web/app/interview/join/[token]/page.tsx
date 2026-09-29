import type { Metadata } from 'next';
import { InterviewJoin } from './interview-join';

// The join token is a bearer credential in the URL: never index it, never leak it through Referer.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function InterviewJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InterviewJoin token={token} />;
}
