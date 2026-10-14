import { useEffect, useId, useRef, useState } from 'react';
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

/**
 * Combobox acessível: digita, filtra (pai), sugere, clica.
 * Substitui o <datalist> nativo — que não abre no iOS Safari e é
 * inconsistente no Android — por uma lista clicável controlada.
 */
export default function Autocomplete({
  id, value, onValueChange, options, onPick,
  placeholder, invalid = false, ariaLabel, emptyText,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const listId = `${id ?? reactId}-listbox`;
  const active = activeIndex >= 0 && activeIndex < options.length ? options[activeIndex] : null;

  // Fecha ao clicar fora ou com Esc (mesmo padrão do Popover).
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Mantém o índice destacado dentro dos limites quando a lista muda.
  useEffect(() => {
    if (!open) setActiveIndex(-1);
    else setActiveIndex((i) => (options.length === 0 ? -1 : Math.min(Math.max(i, -1), options.length - 1)));
  }, [open, options.length]);

  const pick = (o: AutocompleteOption) => {
    onPick(o);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
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
        onChange={(e) => { onValueChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel ?? placeholder}
          className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg border border-line dark:border-gray-700 bg-white dark:bg-gray-900 shadow-modal"
        >
          {options.map((o, i) => (
            <li key={o.id} id={`${listId}-${o.id}`} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
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
        </ul>
      )}
    </div>
  );
}
