import type { ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
  position?: 'top' | 'bottom';
}

/** Dica contextual (hover e foco). */
export default function Tooltip({ label, children, position = 'top' }: Props) {
  return (
    <span className="relative inline-flex group/tooltip">
      {children}
      <span
        role="tooltip"
        className={`absolute z-50 pointer-events-none whitespace-nowrap hidden group-hover/tooltip:block group-focus-within/tooltip:block bg-navy-900 text-white text-xs font-medium px-2 py-1 rounded-md shadow-modal ${
          position === 'top' ? 'bottom-full mb-1.5 left-1/2 -translate-x-1/2' : 'top-full mt-1.5 left-1/2 -translate-x-1/2'
        }`}
      >
        {label}
      </span>
    </span>
  );
}
