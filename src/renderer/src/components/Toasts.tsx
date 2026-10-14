import { useApp } from '../store'

export default function Toasts(): React.JSX.Element {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.tone} ${toast.leaving ? 'leaving' : ''}`}
          onClick={() => dismiss(toast.id)}
          role="status"
        >
          {toast.text}
        </div>
      ))}
    </div>
  )
}
