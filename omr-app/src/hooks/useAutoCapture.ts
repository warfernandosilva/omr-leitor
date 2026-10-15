import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeFrame, FrameAnalysis, DEFAULT_THRESHOLDS, GuideThresholds } from '../utils/frame-guides';

// Amostragem do vídeo para análise (equilíbrio velocidade × precisão)
const SAMPLE_W = 320;
const SAMPLE_MS = 100; // ~10fps
const LOCK_STREAK = 6; // frames travados seguidos para disparar

export type AutoStatus = 'idle' | 'searching' | 'locked' | 'frozen';

interface UseAutoCaptureOpts {
  enabled: boolean;
  onLocked: () => void;
  // Limiares calibrados por modelo de gabarito (padrão: genérico)
  thresholds?: GuideThresholds;
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
  { enabled, onLocked, thresholds = DEFAULT_THRESHOLDS }: UseAutoCaptureOpts,
) {
  const [analysis, setAnalysis] = useState<FrameAnalysis | null>(null);
  const [lockProgress, setLockProgress] = useState(0); // 0..1
  const [status, setStatus] = useState<AutoStatus>('idle');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  // Painel "Ajustes": exposição e foco só aparecem quando o aparelho expõe
  // (Android/Chrome via getCapabilities; iOS/Safari não — seguem ocultos).
  const [exposureSupported, setExposureSupported] = useState(false);
  const [exposureMin, setExposureMin] = useState(-2);
  const [exposureMax, setExposureMax] = useState(2);
  const [exposureStep, setExposureStep] = useState(0.5);
  const [exposure, setExposure] = useState(0);
  const [focusSupported, setFocusSupported] = useState(false);
  const [focusPointSupported, setFocusPointSupported] = useState(false);
  const [focusAuto, setFocusAuto] = useState(true);

  const streakRef = useRef(0);
  const attemptsRef = useRef(0);
  const lastRef = useRef(0);
  const rafRef = useRef(0);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const onLockedRef = useRef(onLocked);
  onLockedRef.current = onLocked;
  const thresholdsRef = useRef(thresholds);
  thresholdsRef.current = thresholds;

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
      setExposureSupported(false);
      setExposure(0);
      setFocusSupported(false);
      setFocusPointSupported(false);
      setFocusAuto(true);
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
      const a = analyzeFrame(gray, sw, sh, thresholdsRef.current);
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

  // Detecta suporte à lanterna, zoom, exposição e foco quando o stream existe
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
          exposureCompensation?: { min?: number; max?: number; step?: number };
          focusMode?: string[];
        } | undefined;
        if (caps?.torch) {
          setTorchSupported(true);
        }
        if (caps?.zoom && typeof caps.zoom.max === 'number' && caps.zoom.max > 1) {
          setZoomSupported(true);
          setMaxZoom(caps.zoom.max);
        }
        const ec = caps?.exposureCompensation;
        if (ec && typeof ec.min === 'number' && typeof ec.max === 'number' && ec.max > ec.min) {
          setExposureSupported(true);
          setExposureMin(ec.min);
          setExposureMax(ec.max);
          if (typeof ec.step === 'number' && ec.step > 0) setExposureStep(ec.step);
          try {
            const cur = (track?.getSettings?.() as unknown as { exposureCompensation?: number } | undefined)
              ?.exposureCompensation;
            if (typeof cur === 'number') setExposure(cur);
          } catch {
            /* mantém o default */
          }
        }
        if (Array.isArray(caps?.focusMode) && caps.focusMode.length > 0) {
          setFocusSupported(true);
          // pointsOfInterest não aparece em getCapabilities; a disponibilidade
          // real é confirmada no primeiro toque (falha silenciosa desliga).
          setFocusPointSupported(true);
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

  // Exposição do sensor (brilho real — sem filtro falso no preview).
  const setExposureLevel = useCallback(async (v: number) => {
    const track = (videoRef.current?.srcObject as MediaStream | null)
      ?.getVideoTracks?.()?.[0] as (MediaStreamTrack & { applyConstraints?: (c: unknown) => Promise<void> }) | undefined;
    if (!track?.applyConstraints) return;
    try {
      await track.applyConstraints({ advanced: [{ exposureCompensation: v }] } as unknown as MediaTrackConstraints);
      setExposure(v);
    } catch {
      setExposureSupported(false);
    }
  }, [videoRef]);

  // Foco automático (contínuo) ↔ manual.
  const toggleFocusAuto = useCallback(async () => {
    const track = (videoRef.current?.srcObject as MediaStream | null)
      ?.getVideoTracks?.()?.[0] as (MediaStreamTrack & { applyConstraints?: (c: unknown) => Promise<void> }) | undefined;
    if (!track?.applyConstraints) return;
    const next = !focusAuto;
    try {
      await track.applyConstraints({ advanced: [{ focusMode: next ? 'continuous' : 'manual' }] } as unknown as MediaTrackConstraints);
      setFocusAuto(next);
    } catch {
      setFocusSupported(false);
    }
  }, [focusAuto, videoRef]);

  // Toque-para-focar: ponto normalizado 0..1 + disparo único.
  const setFocusPoint = useCallback(async (nx: number, ny: number) => {
    const track = (videoRef.current?.srcObject as MediaStream | null)
      ?.getVideoTracks?.()?.[0] as (MediaStreamTrack & { applyConstraints?: (c: unknown) => Promise<void> }) | undefined;
    if (!track?.applyConstraints) return;
    try {
      await track.applyConstraints({
        advanced: [{ pointsOfInterest: [{ x: nx, y: ny }], focusMode: 'single-shot' }],
      } as unknown as MediaTrackConstraints);
      setFocusAuto(false);
    } catch {
      setFocusPointSupported(false);
    }
  }, [videoRef]);

  return {
    analysis, lockProgress, status,
    torchOn, torchSupported, toggleTorch,
    zoomSupported, zoom, maxZoom, setZoomLevel,
    exposureSupported, exposureMin, exposureMax, exposureStep, exposure, setExposureLevel,
    focusSupported, focusPointSupported, focusAuto, toggleFocusAuto, setFocusPoint,
    reset,
  };
}
