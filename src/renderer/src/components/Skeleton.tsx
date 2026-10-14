import TitleBar from './TitleBar'

/** Shown while the library loads, shaped like the real layout so nothing jumps when it arrives. */
export default function Skeleton(): React.JSX.Element {
  return (
    <div className="shell">
      <TitleBar />
      <div className="app">
        <aside className="sidebar">
          <div className="nav">
            {Array.from({ length: 9 }, (_, i) => (
              <div className="skel" key={i} style={{ height: 38, margin: '6px 4px', width: i % 3 === 2 ? '60%' : 'auto' }} />
            ))}
          </div>
        </aside>
        <div className="main">
          <div className="toolbar">
            <div className="skel" style={{ height: 38 }} />
          </div>
          <div className="skel-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="skel-card" key={i}>
                <div className="skel" style={{ height: 16, width: '40%' }} />
                <div className="skel" style={{ height: 44, width: '85%', marginTop: 22 }} />
                <div className="skel" style={{ height: 14, marginTop: 20 }} />
                <div className="skel" style={{ height: 14, width: '70%', marginTop: 8 }} />
                <div className="skel" style={{ height: 26, width: '50%', marginTop: 24 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
