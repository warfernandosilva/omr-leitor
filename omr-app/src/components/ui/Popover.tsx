import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  trigger: ReactNode;
  triggerLabel: string;
  triggerClassName?: string;
  align?: 'left' | 'right';
  panelClassName?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}

/** Painel ancorado (busca, notificações, menu do usuário). Fecha com Escape ou clique fora. */
export default function Popover({
  trigger, triggerLabel, triggerClassName, align = 'right', panelClassName = '', children,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open ]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel}
        className={triggerClassName ?? 'btn btn-secondary btn-sm'}
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={triggerLabel}
          className={`absolute z-50 mt-2 bg-white dark:bg-gray-900 border border-line dark:border-gray-700 rounded-xl shadow-modal overflow-hidden ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${panelClassName}`}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}
