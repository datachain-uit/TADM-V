export type NoticeMessage = { kind: 'ok' | 'error'; text: string }

export default function Notice({ message }: { message: NoticeMessage | null }) {
  if (!message) return null
  return <div className={`notice notice-${message.kind}`}>{message.text}</div>
}
