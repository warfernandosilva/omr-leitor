import { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

export type Pt = [number, number];

/**
 * Editor de cantos (Gabarito Personalizado): o usuário arrasta 4 pontos até as
 * quinas da folha do cartão quando o alinhamento automático falha (foto torta).
 * Ordem TL, TR, BR, BL em coords normalizadas 0..1 sobre a FOTO capturada.
 */
export default function CornerEditor({
  src, onCancel, onConfirm,
}: {
  src: string;
  onCancel: () => void;
  onConfirm: (corners: Pt[]) => void;
}) {
  const [pts, setPts] = useState<Pt[]>([[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]]);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<number | null>(null);

  const move = useCallback((clientX: number, clientY: number) => {
    const box = boxRef.current;
    const i = dragRef.current;
    if (!box || i == null) return;
    const r = box.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    setPts(prev => prev.map((p, j) => (j === i ? [x, y] as Pt : p)));
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => move(e.clientX, e.clientY);
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [move]);

  const labels = ['Canto superior esquerdo', 'Canto superior direito',
                  'Canto inferior direito', 'Canto inferior esquerdo'];

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#04192E] text-white">
      <div className="flex shrink-0 items-start justify-between gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight">Ajustar cantos</h2>
          <p className="mt-0.5 text-[11px] text-white/70">
            Arraste os 4 pontos até as quinas da folha do cartão.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Fechar"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10"
        >
          <X size={20} aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-2">
        <div ref={boxRef} className="relative mx-auto w-full max-w-xl touch-none select-none">
          <img src={src} alt="Foto capturada" className="block w-full rounded-lg" draggable={false} />
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden
          >
            <polygon
              points={pts.map(p => `${p[0]},${p[1]}`).join(' ')}
              fill="rgba(11,107,251,0.18)"
              stroke="#38bdf8"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {pts.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={labels[i]}
              onPointerDown={(e) => { e.preventDefault(); dragRef.current = i; }}
              className="absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-[#0B6BFB] shadow-lg active:bg-[#0959d6]"
              style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}
            />
          ))}
        </div>
      </div>

      <div className="flex shrink-0 gap-2 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[52px] flex-1 rounded-xl bg-white/10 px-4 text-sm font-medium text-white transition-colors hover:bg-white/20"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => onConfirm(pts)}
          className="min-h-[52px] flex-1 rounded-xl bg-[#0B6BFB] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0959d6]"
        >
          Ler com estes cantos
        </button>
      </div>
    </div>
  );
}
