import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: number | string;
  disabled?: boolean;
}

interface Props {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}

/** Abas com navegação por teclado (setas). */
export default function Tabs({ tabs, active, onChange, ariaLabel = 'Abas' }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const enabled = tabs.filter((t) => !t.disabled);
    const idx = enabled.findIndex((t) => t.id === active);
    const next = e.key === 'ArrowRight'
      ? enabled[(idx + 1) % enabled.length]
      : enabled[(idx - 1 + enabled.length) % enabled.length];
    if (next) {
      onChange(next.id);
      const btn = listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`);
      btn?.focus();
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="flex gap-1 border-b border-line dark:border-gray-800 overflow-x-auto"
    >
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            data-tab={t.id}
            aria-selected={selected}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors min-h-[44px] disabled:opacity-40 ${
              selected
                ? 'border-brand-500 text-brand-600 dark:text-brand-200'
                : 'border-transparent text-gray-500 hover:text-ink dark:text-gray-400 dark:hover:text-white'
            }`}
          >
            {t.icon ? <span className="inline-flex" aria-hidden>{t.icon}</span> : null}
            {t.label}
            {t.badge !== undefined ? (
              <span className="badge-neutral badge">{t.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
