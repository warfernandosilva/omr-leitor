import type { MouseEvent as ReactMouseEvent } from 'react';

export type CaptureCorner = 'TL' | 'TR' | 'BR' | 'BL';
export interface CapturePoint { x: number; y: number }
export interface CaptureGuide { x: number; y: number; w: number; h: number }
export interface CaptureFrameAnalysis {
  locked?: boolean;
  hint?: string;
  found: number;
  corners?: Partial<Record<CaptureCorner, CapturePoint>>;
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>;
  viewRef: React.RefObject<HTMLDivElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onViewTap: (event: ReactMouseEvent<HTMLDivElement>) => void;
  autoMode: boolean;
  confirmUrl: string | null;
  showThirds: boolean;
  examModelLabel: string;
  guide: CaptureGuide;
  anchorTargets: Record<CaptureCorner, CapturePoint>;
  frameAnalysis: CaptureFrameAnalysis | null;
  searchSecs: number;
  sharpRetry: string | null;
  lockProgress: number;
  flashOn: boolean;
}

/**
 * Visor da câmera do leitor OMR: moldura, alvos das âncoras, cantos
 * detectados, prévia congelada e status de travamento.
 *
 * A lógica de captura permanece na página; este componente só apresenta.
 */
export default function CaptureViewport({
  videoRef, viewRef, canvasRef, onViewTap,
  autoMode, confirmUrl, showThirds, examModelLabel,
  guide, anchorTargets, frameAnalysis, searchSecs, sharpRetry, lockProgress, flashOn,
}: Props) {
  const corners: CaptureCorner[] = ['TL', 'TR', 'BR', 'BL'];

  return (
    <div
      ref={viewRef}
      onClick={onViewTap}
      className="relative min-h-0 w-full flex-1 overflow-hidden bg-black"
    >
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full" style={{ objectFit: 'cover' }} />

      {autoMode && !confirmUrl && (
        <span className="absolute top-2 left-2 z-10 text-[11px] font-semibold text-white bg-black/55 rounded-full px-2.5 py-1 pointer-events-none">
          {examModelLabel}
        </span>
      )}

      {showThirds && autoMode && !confirmUrl && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
          {[100 / 3, 200 / 3].map(v => (
            <g key={v} stroke="rgba(255,255,255,0.45)" strokeWidth="0.4">
              <line x1={v} y1="0" x2={v} y2="100" />
              <line x1="0" y1={v} x2="100" y2={v} />
            </g>
          ))}
        </svg>
      )}

      {autoMode && !confirmUrl && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
          <path
            d={`M0,0 H100 V100 H0 Z M${guide.x},${guide.y} H${guide.x + guide.w} V${guide.y + guide.h} H${guide.x} Z`}
            fill="rgba(0,0,0,0.5)"
            fillRule="evenodd"
          />
          <rect
            x={guide.x} y={guide.y} width={guide.w} height={guide.h} fill="none" rx="1"
            stroke={frameAnalysis?.locked ? '#22c55e' : 'rgba(255,255,255,0.9)'}
            strokeWidth="0.8"
          />
          {corners.map(k => {
            const gx = k === 'TL' || k === 'BL' ? guide.x : guide.x + guide.w;
            const gy = k === 'TL' || k === 'TR' ? guide.y : guide.y + guide.h;
            const sx = k === 'TL' || k === 'BL' ? 1 : -1;
            const sy = k === 'TL' || k === 'TR' ? 1 : -1;
            const L = 9;
            const c = frameAnalysis?.locked ? '#22c55e' : '#ffffff';
            return (
              <g key={k} stroke={c} strokeWidth="1.8" strokeLinecap="round">
                <line x1={gx} y1={gy} x2={gx + sx * L} y2={gy} />
                <line x1={gx} y1={gy} x2={gx} y2={gy + sy * L} />
              </g>
            );
          })}
          {corners.map(k => {
            const p = anchorTargets[k];
            const c = frameAnalysis?.locked ? '#22c55e' : '#fbbf24';
            return (
              <g key={`t-${k}`} stroke={c} strokeWidth="0.9" fill="none" opacity="0.95">
                <circle cx={p.x} cy={p.y} r="2.4" />
                <circle cx={p.x} cy={p.y} r="0.4" fill={c} stroke="none" />
              </g>
            );
          })}
          {corners.map(k => {
            const p = frameAnalysis?.corners?.[k];
            if (!p) return null;
            const ok = frameAnalysis?.locked;
            const x = p.x * 100, y = p.y * 100;
            const c = ok ? '#22c55e' : '#fbbf24';
            const L = 6;
            const sx = k === 'TL' || k === 'BL' ? 1 : -1;
            const sy = k === 'TL' || k === 'TR' ? 1 : -1;
            return (
              <g key={k} stroke={c} strokeWidth="1.2" strokeLinecap="round">
                <line x1={x} y1={y} x2={x + sx * L} y2={y} />
                <line x1={x} y1={y} x2={x} y2={y + sy * L} />
              </g>
            );
          })}
        </svg>
      )}

      {confirmUrl && (
        <img src={confirmUrl} alt="Prévia travada" className="absolute inset-0 w-full h-full object-cover" />
      )}

      {flashOn && <div className="absolute inset-0 bg-white pointer-events-none" />}

      {!autoMode && (
        <div className="absolute inset-4 border-2 border-dashed border-white/60 rounded-lg pointer-events-none" />
      )}

      {autoMode && !confirmUrl && searchSecs >= 8 && !frameAnalysis?.locked && (
        <p className="absolute inset-x-3 bottom-12 z-10 rounded-lg border border-amber-300/40 bg-black/60 px-2 py-1.5 text-center text-[11px] text-amber-100 pointer-events-none">
          Enquadramento difícil? Toque no <strong>obturador</strong> para forçar a captura.
        </p>
      )}

      {autoMode && !confirmUrl && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-2">
          <div className="flex items-center justify-between gap-2 text-[11px] leading-tight">
            <span className={frameAnalysis?.locked ? 'font-medium text-emerald-300' : 'text-white/90'}>
              {sharpRetry ?? (frameAnalysis ? frameAnalysis.hint : 'Apontando a câmera...')}
            </span>
            <span className="shrink-0 tabular-nums text-white/70">{frameAnalysis ? `${frameAnalysis.found}/4 cantos` : ''}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
            <div className="h-1.5 rounded-full bg-emerald-400 transition-all duration-150" style={{ width: `${Math.round(lockProgress * 100)}%` }} />
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
