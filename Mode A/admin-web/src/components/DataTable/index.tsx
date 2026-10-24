import type { ReactNode } from 'react'
import DataRow from './DataRow'
import TableHeading from './TableHeading'

export interface Column<T> {
  header: string
  render: (row: T) => ReactNode
}

export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty = 'No data yet',
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  empty?: string
}) {
  if (rows.length === 0) return <p className="muted">{empty}</p>

  return (
    <div className="table-wrap">
      <table className="table">
        <TableHeading columns={columns} />
        <tbody>
          {rows.map((row) => (
            <DataRow key={rowKey(row)} row={row} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
