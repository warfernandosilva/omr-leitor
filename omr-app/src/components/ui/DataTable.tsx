interface Column<T> {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => React.ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  minWidth?: number;
}

export default function DataTable<T>({ columns, rows, rowKey, minWidth = 640 }: Props<T>) {
  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead className="sticky top-0 bg-white dark:bg-gray-900 z-10">
          <tr className="border-b border-gray-200 dark:border-gray-800">
            {columns.map((c) => (
              <th key={c.key} className={`table-th ${c.className ?? ''}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
              {columns.map((c) => (
                <td key={c.key} className={`table-td ${c.className ?? ''}`}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
