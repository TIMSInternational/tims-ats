import { HardExitGuard } from './hard-exit-guard';

// Mounted for the whole room (lobby + in-call) so no exit is ever a soft
// navigation that would keep the room's relaxed CSP. See ./hard-exit.ts.
export default function InterviewRoomLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <HardExitGuard />
      {children}
    </>
  );
}
