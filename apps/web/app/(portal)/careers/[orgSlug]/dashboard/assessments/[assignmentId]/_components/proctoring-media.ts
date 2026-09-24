export interface ProctoringMedia {
  camera: MediaStream;
  screen: MediaStream;
}

export function hasLiveVideo(stream: MediaStream | null): stream is MediaStream {
  return stream?.getVideoTracks().some((track) => track.readyState === 'live') ?? false;
}

export function isEntireScreenShare(stream: MediaStream): boolean {
  return stream.getVideoTracks()[0]?.getSettings().displaySurface === 'monitor';
}

export function stopMedia(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function stopProctoringMedia(media: ProctoringMedia): void {
  stopMedia(media.camera);
  stopMedia(media.screen);
}
