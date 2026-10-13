import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  onNavigate?: () => void;
}

interface Props {
  items: Crumb[];
}

/** Trilha de navegação (grupo > página). Último item = página atual. */
export default function Breadcrumbs({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${c.label}-${i}`}>
              {i > 0 ? (
                <ChevronRight size={14} className="text-gray-400" aria-hidden />
              ) : null}
              <li>
                {last || !c.onNavigate ? (
                  <span aria-current={last ? 'page' : undefined} className={last ? 'font-medium text-ink dark:text-white' : 'text-gray-500'}>
                    {c.label}
                  </span>
                ) : (
                  <button onClick={c.onNavigate} className="text-gray-500 hover:text-brand-600 dark:text-gray-400 dark:hover:text-brand-200">
                    {c.label}
                  </button>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
