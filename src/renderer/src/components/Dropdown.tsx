import { useEffect, useRef, useState } from 'react'
import { usePresence } from '../lib/usePresence'
import Icon, { type IconName } from './Icon'

interface Props {
  label: string
  icon?: IconName
  count?: number
  closeOnPick?: boolean
  children: React.ReactNode
}

export default function Dropdown({ label, icon, count = 0, closeOnPick, children }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { item: mounted, leaving } = usePresence(open || null, 120)

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
        {icon && <Icon name={icon} size={15} />}
        {label}
        {count > 0 && <span className="dd-count">{count}</span>}
        <Icon name="chevron" size={13} />
      </button>
      {mounted && (
        <div className={`dd-menu ${leaving ? 'leaving' : ''}`} onClick={closeOnPick ? () => setOpen(false) : undefined}>
          {children}
        </div>
      )}
    </div>
  )
}
