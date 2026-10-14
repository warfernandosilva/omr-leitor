import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Input from './Input';

export interface AutocompleteOption {
  id: string | number;
  label: string;
  sublabel?: string | null;
  badge?: string | null;
}

interface Props {
  id?: string;
  value: string;
  onValueChange: (v: string) => void;
  /** Opções já filtradas pelo pai (a lista exibida é exatamente esta). */
  options: AutocompleteOption[];
  onPick: (o: AutocompleteOption) => void;
  placeholder?: string;
  invalid?: boolean;
  ariaLabel?: string;
  /** Linha não-selecionável quando não há opções. */
  emptyText?: string;
}

interface Pos {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Combobox acessível: digita, filtra (pai), sugere, clica.
 * Substitui o <datalist> nativo — que não abre no iOS Safari e é
 * inconsistente no Android — por uma lista clicável controlada.
 *
 * A lista é portaled para <body> e posicionada em `fixed` ancorada no campo:
 * assim ela nunca é cortada por ancestors com overflow/transform e fica acima
 * do teclado virtual no mobile (abre para cima quando falta espaço abaixo).
 */
export default function Autocomplete({
  id, value, onValueChange, options, onPick,
  placeholder, invalid = false, ariaLabel, emptyText,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pos, setPos] = useState<Pos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const reactId = useId();
  const listId = `${id ?? reactId}-listbox`;
  const active = activeIndex >= 0 && activeIndex < options.length ? options[activeIndex] : null;

  // Ancora a lista na posição real do campo (viewport). Abre para cima quando
  // o espaço abaixo é menor que o acima — onde o teclado virtual costuma estar.
  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const below = vh - r.bottom;
    const above = r.top;
    const openAbove = below < 240 && above > below;
    setPos({
      left: Math.max(8, r.left),
      width: Math.min(Math.max(120, r.width), vw - 16),
      top: openAbove ? undefined : r.bottom + 6,
      bottom: openAbove ? vh - r.top + 6 : undefined,
      maxHeight: Math.max(96, Math.min(240, (openAbove ? above : below) - 12)),
    });
  }, []);

  const openList = useCallback(() => { place(); setOpen(true); }, [place]);

  // Fecha ao clicar fora ou com Esc; reposiciona com scroll/resize (mobile).
  useEffect(() => {
    if (!open) { setPos(null); return; }
    place();
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current && rootRef.current.contains(t)) return;
      if (listRef.current && listRef.current.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < -8 || r.top > (window.innerHeight || 0) + 8) setOpen(false);
      else place();
    };
    const onResize = () => place();
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, place]);

  const pick = (o: AutocompleteOption) => {
    onPick(o);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      if (options.length === 0) return;
      setActiveIndex((i) => {
        const d = e.key === 'ArrowDown' ? 1 : -1;
        const next = i < 0 ? (d > 0 ? 0 : options.length - 1) : i + d;
        return (next + options.length) % options.length;
      });
    } else if (e.key === 'Enter') {
      if (open && active) { e.preventDefault(); pick(active); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <Input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        invalid={invalid}
        placeholder={placeholder}
        value={value}
        ref={inputRef}
        onChange={(e) => { onValueChange(e.target.value); openList(); }}
        onFocus={() => { openList(); if (value) inputRef.current?.select(); }}
        onClick={() => { openList(); inputRef.current?.select(); }}
        onKeyDown={handleKeyDown}
      />
      {open && pos && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel ?? placeholder}
          style={{
            position: 'fixed',
            left: pos.left,
            width: pos.width,
            top: pos.top,
            bottom: pos.bottom,
            maxHeight: pos.maxHeight,
            zIndex: 60,
          }}
          className="overflow-y-auto rounded-lg border border-line dark:border-gray-700 bg-white dark:bg-gray-900 shadow-modal"
        >
          {options.map((o, i) => (
            <li key={o.id} id={`${listId}-${o.id}`} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onClick={() => pick(o)}
                onFocus={() => setActiveIndex(i)}
                className={`flex w-full min-h-[44px] flex-col items-start gap-0.5 px-3 py-2 text-left text-sm ${
                  i === activeIndex
                    ? 'bg-brand-50 dark:bg-brand-700/20'
                    : 'hover:bg-surface dark:hover:bg-gray-800'
                }`}
              >
                <span className="font-medium text-ink dark:text-gray-100">{o.label}</span>
                {(o.sublabel || o.badge) && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {o.sublabel}
                    {o.sublabel && o.badge ? ' · ' : ''}
                    {o.badge && <span className="font-medium text-warning-600 dark:text-warning-100">{o.badge}</span>}
                  </span>
                )}
              </button>
            </li>
          ))}
          {options.length === 0 && emptyText && (
            <li aria-disabled="true" className="px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">
              {emptyText}
            </li>
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}
