import type { Column } from '.'

export default function TableHeading<T>({ columns }: { columns: Column<T>[] }) {
  return (
    <thead>
      <tr>
        {columns.map((column) => (
          <th key={column.header}>{column.header}</th>
        ))}
      </tr>
    </thead>
  )
}
