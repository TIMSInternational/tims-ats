import { useEffect, useState } from 'react';
import { computeRmsLevel } from './audio-level';

/**
 * Returns the current microphone input level (0..1) while `active`.
 * Opens its own preview stream + AudioContext and tears everything down
 * when `active` flips false or the component unmounts.
 */
export function useMicLevel(active: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          setLevel(computeRmsLevel(buf));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setLevel(0);
      }
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
      void ctx?.close();
    };
  }, [active]);

  return level;
}
