export default function Loading({ isLoading, error }: { isLoading: boolean; error: string | null }) {
  if (isLoading) return <p className="muted">Loading…</p>
  if (error) return <div className="notice notice-error">{error}</div>
  return null
}
