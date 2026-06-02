// ---------------------------------------------------------------------------
// Video Service — generates meeting room URLs
// Uses Jitsi Meet (free, no API key needed) for MVP
// Future: migrate to Daily.co or Google Meet when budget allows
// ---------------------------------------------------------------------------

export const videoService = {
  createRoom(interviewId: string): string {
    const roomName = `tims-interview-${interviewId.slice(0, 8)}`;
    return `https://meet.jit.si/${roomName}`;
  },
};
