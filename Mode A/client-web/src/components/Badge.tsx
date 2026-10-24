import { STATUS_LABEL } from '@/utils/labels'

export default function Badge({ status }: { status: string }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{STATUS_LABEL[status] ?? status}</span>
}
