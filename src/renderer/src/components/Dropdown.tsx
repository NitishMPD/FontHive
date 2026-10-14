import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

interface Props {
  label: string
  count?: number
  closeOnPick?: boolean
  children: React.ReactNode
}

export default function Dropdown({ label, count = 0, closeOnPick, children }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="dd" ref={ref}>
      <button className={`dd-btn ${count ? 'on' : ''}`} onClick={() => setOpen(!open)}>
        {label}
        {count > 0 && <span className="dd-count">{count}</span>}
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div className="dd-menu" onClick={closeOnPick ? () => setOpen(false) : undefined}>
          {children}
        </div>
      )}
    </div>
  )
}
