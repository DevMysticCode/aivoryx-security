import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';

export interface DataTableColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Rows per page for the built-in client-side pagination. Default 25. */
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 25;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  pageSize = DEFAULT_PAGE_SIZE,
}: DataTableProps<T>) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  // Every list in this product is backed by real, possibly-growing data —
  // without this a result set that shrinks below the current page (e.g.
  // after a filter or delete) would strand the viewer on a blank page.
  useEffect(() => {
    if (page > 0 && page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {columns.map((column) => (
                <th key={column.header} className="px-4 py-3">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={
                  onRowClick
                    ? 'cursor-pointer border-b border-border last:border-0 hover:bg-muted/50'
                    : 'border-b border-border last:border-0'
                }
              >
                {columns.map((column) => (
                  <td key={column.header} className={column.className ?? 'px-4 py-3'}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, rows.length)} of {rows.length}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
