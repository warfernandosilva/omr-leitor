import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeFrame, FrameAnalysis, DEFAULT_THRESHOLDS } from '../utils/frame-guides';

// Amostragem do vídeo para análise (equilíbrio velocidade × precisão)
const SAMPLE_W = 320;
const SAMPLE_MS = 100; // ~10fps
const LOCK_STREAK = 6; // frames travados seguidos para disparar

export type AutoStatus = 'idle' | 'searching' | 'locked' | 'frozen';

interface UseAutoCaptureOpts {
  enabled: boolean;
  onLocked: () => void;
}

function beep(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.12;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    /* áudio indisponível — segue silencioso */
  }
}

export function useAutoCapture(
  videoRef: React.RefObject<HTMLVideoElement>,
  { enabled, onLocked }: UseAutoCaptureOpts,
) {
  const [analysis, setAnalysis] = useState<FrameAnalysis | null>(null);
  const [lockProgress, setLockProgress] = useState(0); // 0..1
  const [status, setStatus] = useState<AutoStatus>('idle');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);

  const streakRef = useRef(0);
  const attemptsRef = useRef(0);
  const lastRef = useRef(0);
  const rafRef = useRef(0);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const onLockedRef = useRef(onLocked);
  onLockedRef.current = onLocked;

  const fireLocked = useCallback(() => {
    setStatus('frozen');
    try {
      (navigator.vibrate as unknown as ((p: number) => boolean) | undefined)?.(80);
    } catch {
      /* sem vibração */
    }
    beep();
    onLockedRef.current();
  }, []);

  useEffect(() => {
    if (!enabled) {
      cancelAnimationFrame(rafRef.current);
      setStatus('idle');
      setLockProgress(0);
      setTorchOn(false);
      setZoomSupported(false);
      setZoom(1);
      setMaxZoom(1);
      attemptsRef.current = 0;
      streakRef.current = 0;
      return;
    }
    if (!sampleCanvasRef.current) {
      sampleCanvasRef.current = document.createElement('canvas');
    }
    const canvas = sampleCanvasRef.current;
    setStatus('searching');

    const loop = (t: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (t - lastRef.current < SAMPLE_MS) return;
      lastRef.current = t;
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || video.readyState < 2) return;
      const scale = SAMPLE_W / video.videoWidth;
      const sw = SAMPLE_W;
      const sh = Math.max(1, Math.round(video.videoHeight * scale));
      if (canvas.width !== sw || canvas.height !== sh) {
        canvas.width = sw;
        canvas.height = sh;
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, sw, sh);
      let img: ImageData;
      try {
        img = ctx.getImageData(0, 0, sw, sh);
      } catch {
        return;
      }
      const px = img.data;
      const gray = new Uint8Array(sw * sh);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        gray[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
      }
      const a = analyzeFrame(gray, sw, sh, DEFAULT_THRESHOLDS);
      setAnalysis(a);
      if (a.locked) {
        streakRef.current += 1;
        setLockProgress(Math.min(1, streakRef.current / LOCK_STREAK));
        if (streakRef.current >= LOCK_STREAK) {
          streakRef.current = 0;
          setLockProgress(0);
          setStatus('locked');
          fireLocked();
          return;
        }
      } else {
        streakRef.current = 0;
        setLockProgress(0);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, videoRef, fireLocked]);

  // Detecta suporte à lanterna e ao zoom quando o stream existe
  // (Android/Chrome expõem via getCapabilities; iOS não — segue oculto)
  useEffect(() => {
    if (!enabled) return;
    attemptsRef.current = 0;
    const id = window.setInterval(() => {
      attemptsRef.current += 1;
      const track = (videoRef.current?.srcObject as MediaStream | null)
        ?.getVideoTracks?.()?.[0] as MediaStreamTrack | undefined;
      try {
        const caps = track?.getCapabilities?.() as unknown as {
          torch?: boolean; zoom?: { min?: number; max?: number };
        } | undefined;
        if (caps?.torch) {
          setTorchSupported(true);
        }
        if (caps?.zoom && typeof caps.zoom.max === 'number' && caps.zoom.max > 1) {
          setZoomSupported(true);
          setMaxZoom(caps.zoom.max);
        }
      } catch {
        /* ignora */
      }
      if (attemptsRef.current > 15) window.clearInterval(id);
    }, 800);
    return () => window.clearInterval(id);
  }, [enabled, videoRef]);

  const toggleTorch = useCallback(async () => {
    const track = (videoRef.current?.srcObject as MediaStream | null)
      ?.getVideoTracks?.()?.[0] as (MediaStreamTrack & { applyConstraints?: (c: unknown) => Promise<void> }) | undefined;
    if (!track?.applyConstraints) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }, [torchOn, videoRef]);

  const setZoomLevel = useCallback(async (z: number) => {
    const track = (videoRef.current?.srcObject as MediaStream | null)
      ?.getVideoTracks?.()?.[0] as (MediaStreamTrack & { applyConstraints?: (c: unknown) => Promise<void> }) | undefined;
    if (!track?.applyConstraints) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: z }] } as unknown as MediaTrackConstraints);
      setZoom(z);
    } catch {
      setZoomSupported(false);
    }
  }, [videoRef]);

  const reset = useCallback(() => {
    streakRef.current = 0;
    setLockProgress(0);
    setStatus('searching');
  }, []);

  return {
    analysis, lockProgress, status,
    torchOn, torchSupported, toggleTorch,
    zoomSupported, zoom, maxZoom, setZoomLevel, reset,
  };
}
