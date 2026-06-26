// apps/web/app/(portal)/ai-interview/[token]/audio-level.ts
/**
 * RMS loudness of an 8-bit time-domain buffer (AnalyserNode.getByteTimeDomainData),
 * where 128 is silence. Returns a 0..1 level suitable for a mic meter.
 */
export function computeRmsLevel(timeDomain: Uint8Array): number {
  if (timeDomain.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < timeDomain.length; i++) {
    const v = (timeDomain[i] - 128) / 128; // -1..1
    sumSquares += v * v;
  }
  const rms = Math.sqrt(sumSquares / timeDomain.length); // 0..1
  return Math.min(1, rms);
}
