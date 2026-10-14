import { useApp } from '../store'

export default function StatusBar(): React.JSX.Element {
  const progress = useApp((s) => s.progress)
  const busy = useApp((s) => s.busy)
  const fonts = useApp((s) => s.fonts)
  const selection = useApp((s) => s.selection)

  const visible = useApp((s) => s.filters)
  void visible

  const message = busy ?? progress?.message ?? 'Ready'

  return (
    <footer className="statusbar">
      <span>{message}</span>

      {progress && progress.total > 0 && (
        <div className="progress">
          <div style={{ width: `${Math.round((progress.completed / progress.total) * 100)}%` }} />
        </div>
      )}

      <div style={{ flex: 1 }} />

      {selection.length > 1 && <span>{selection.length} selected</span>}
      <span>{fonts.length.toLocaleString()} faces indexed</span>
    </footer>
  )
}
