import type { CSSProperties } from 'react'
import { toastDuration, useApp } from '../store'
import Icon, { type IconName } from './Icon'

const TONE_ICON: Record<string, IconName> = { error: 'alert', success: 'check', info: 'info' }

export default function Toasts(): React.JSX.Element {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.tone} ${toast.leaving ? 'leaving' : ''}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          <Icon name={TONE_ICON[toast.tone]} size={17} className="toast-icon" />
          <span className="toast-text">{toast.text}</span>
          <button className="icon-btn toast-close" title="Dismiss" onClick={() => dismiss(toast.id)}>
            <Icon name="close" size={13} />
          </button>
          <span
            className="toast-timer"
            style={{ '--dur': `${toastDuration(toast.tone)}ms` } as CSSProperties}
          />
        </div>
      ))}
    </div>
  )
}
