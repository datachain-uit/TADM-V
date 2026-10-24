export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('en-GB') : '—'
}
