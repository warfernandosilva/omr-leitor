import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import Skeleton from './Skeleton';
import Pagination from './Pagination';

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => ReactNode;
  /** Habilita ordenação nesta coluna (exige sortValue). */
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  minWidth?: number;
  /** Exibe linhas esqueleto no formato final. */
  loading?: boolean;
  /** Conteúdo quando não há linhas. */
  empty?: ReactNode;
  /** Ativa paginação interna com N linhas por página. */
  pageSize?: number;
  onRowClick?: (row: T) => void;
  /** Render alternativo em cartões no mobile (<md). Sem ele, a tabela rola. */
  mobileCard?: (row: T) => ReactNode;
  ariaLabel?: string;
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null;

function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'pt-BR');
}

/** Tabela densa com ordenação, paginação, skeleton e fallback em cartões no mobile. */
export default function DataTable<T>({
  columns, rows, rowKey, minWidth = 640,
  loading = false, empty, pageSize, onRowClick, mobileCard, ariaLabel = 'Tabela de dados',
}: Props<T>) {
  const [sort, setSort] = useState<Sort>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [rows.length, pageSize]);

  const toggleSort = (col: Column<T>) => {
    if (!col.sortable || !col.sortValue) return;
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: 'asc' };
      if (prev.dir === 'asc') return { key: col.key, dir: 'desc' };
      return null;
    });
  };

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => compare(get(a), get(b)) * dir);
  }, [rows, sort, columns]);

  const totalPages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages);
  const visible = pageSize ? sorted.slice((safePage - 1) * pageSize, safePage * pageSize) : sorted;

  const onRowKey = (row: T) => (e: KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && onRowClick) {
      e.preventDefault();
      onRowClick(row);
    }
  };

  const sortIcon = (col: Column<T>) => {
    if (!col.sortable || !col.sortValue) return null;
    if (!sort || sort.key !== col.key) {
      return <ChevronsUpDown size={14} className="inline ml-1 text-gray-400" aria-hidden />;
    }
    return sort.dir === 'asc'
      ? <ArrowUp size={14} className="inline ml-1 text-brand-500" aria-hidden />
      : <ArrowDown size={14} className="inline ml-1 text-brand-500" aria-hidden />;
  };

  if (loading) {
    return (
      <div role="status" aria-label="Carregando tabela" className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-gray-500 dark:text-gray-400">
        {empty ?? 'Nenhum registro encontrado.'}
      </div>
    );
  }

  return (
    <div>
      {mobileCard ? (
        <div className="md:hidden space-y-2">
          {visible.map((row, i) => (
            <div key={rowKey(row, i)} className="border border-line dark:border-gray-800 rounded-xl p-3 bg-white dark:bg-gray-900">
              {mobileCard(row)}
            </div>
          ))}
        </div>
      ) : null}
      <div className={`overflow-x-auto -mx-6 px-6 ${mobileCard ? 'hidden md:block' : ''}`}>
        <table className="w-full text-sm" style={{ minWidth }} aria-label={ariaLabel}>
          <thead className="sticky top-0 bg-white dark:bg-gray-900 z-10">
            <tr className="border-b border-line dark:border-gray-800">
              {columns.map((c) => (
                <th key={c.key} className={`table-th ${c.className ?? ''}`}>
                  {c.sortable && c.sortValue ? (
                    <button
                      onClick={() => toggleSort(c)}
                      aria-label={`Ordenar por ${c.header}`}
                      className="inline-flex items-center font-semibold uppercase tracking-wide hover:text-ink dark:hover:text-white"
                    >
                      {c.header}
                      {sortIcon(c)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? onRowKey(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={`border-b border-gray-50 dark:border-gray-800 transition-colors ${
                  onRowClick ? 'cursor-pointer hover:bg-brand-50 dark:hover:bg-gray-800/60' : 'hover:bg-surface dark:hover:bg-gray-800/60'
                }`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`table-td ${c.className ?? ''}`}>{c.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageSize ? (
        <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
      ) : null}
    </div>
  );
}
