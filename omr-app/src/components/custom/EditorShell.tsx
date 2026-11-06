import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Classes extras no wrapper (ex.: centralizar o conteúdo). */
  className?: string;
}

/**
 * Posição do elemento no layout, ignorando transforms de animação.
 * `getBoundingClientRect()` incluiria o `translateY` da animação de entrada
 * do AppShell e mediria a área livre 8px menor que o real.
 */
function layoutTop(el: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}

/**
 * Área de trabalho do editor: ocupa toda a área de conteúdo disponível
 * (sem o respiro padrão do AppShell), usa a altura real da viewport e trava
 * o scroll da página — a rolagem acontece dentro do editor (canvas, painéis).
 *
 * A altura é medida em runtime porque o espaço livre depende do topbar
 * global (que muda de altura no mobile) e da barra inferior fixa.
 */
export default function EditorShell({ children, className = '' }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number>(() =>
    (typeof window === 'undefined' ? 720 : Math.max(320, window.innerHeight - 64)));

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = layoutTop(el) - window.scrollY;
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Navegação rápida"]');
    const bottom = nav ? nav.getBoundingClientRect().height : 0;
    setHeight(Math.max(320, Math.round(window.innerHeight - top - bottom)));
  }, []);

  // Trava o scroll do documento e volta ao topo: o editor vive no topo da
  // área de conteúdo e o topbar global é sticky.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    window.scrollTo(0, 0);
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  useEffect(() => {
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => measure());
    if (ref.current) ro.observe(ref.current);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [measure]);

  return (
    <div
      ref={ref}
      className={`content-flush flex min-h-0 flex-col overflow-hidden ${className}`}
      style={{ height }}
    >
      {children}
    </div>
  );
}
