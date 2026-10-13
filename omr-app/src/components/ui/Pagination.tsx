import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

/** Paginação com janela numerada (1 … atual … última). */
export default function Pagination({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null;

  const go = (p: number) => {
    const clamped = Math.min(totalPages, Math.max(1, p));
    if (clamped !== page) onChange(clamped);
  };

  const window_: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(totalPages, page + 2); p++) window_.push(p);
  const showFirst = window_[0] > 1;
  const showLast = window_[window_.length - 1] < totalPages;

  const numBtn = (p: number) => (
    <button
      key={p}
      onClick={() => go(p)}
      aria-label={`Página ${p}`}
      aria-current={p === page ? 'page' : undefined}
      className={`min-w-[36px] min-h-[36px] px-2 rounded-lg text-sm font-medium transition-colors ${
        p === page
          ? 'bg-brand-500 text-white'
          : 'text-gray-600 hover:bg-surface dark:text-gray-300 dark:hover:bg-gray-800'
      }`}
    >
      {p}
    </button>
  );

  return (
    <nav aria-label="Paginação" className="flex items-center justify-center gap-1 mt-4">
      <button
        onClick={() => go(page - 1)}
        disabled={page === 1}
        aria-label="Página anterior"
        className="btn-icon"
      >
        <ChevronLeft size={18} />
      </button>
      {showFirst ? (
        <>
          {numBtn(1)}
          {window_[0] > 2 ? <span className="text-gray-400 px-1" aria-hidden>…</span> : null}
        </>
      ) : null}
      {window_.map(numBtn)}
      {showLast ? (
        <>
          {window_[window_.length - 1] < totalPages - 1 ? <span className="text-gray-400 px-1" aria-hidden>…</span> : null}
          {numBtn(totalPages)}
        </>
      ) : null}
      <button
        onClick={() => go(page + 1)}
        disabled={page === totalPages}
        aria-label="Próxima página"
        className="btn-icon"
      >
        <ChevronRight size={18} />
      </button>
    </nav>
  );
}
