import type { Column } from '.'

export default function DataRow<T>({ row, columns }: { row: T; columns: Column<T>[] }) {
  return (
    <tr>
      {columns.map((column) => (
        <td key={column.header}>{column.render(row)}</td>
      ))}
    </tr>
  )
}
