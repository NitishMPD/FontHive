export default function Logo({ size = 30 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
      <path d="M16 3l11 6.3v12.4L16 28 5 21.7V9.3z" />
      <path d="M5 9.3l11 6.4 11-6.4M16 15.7V28" />
    </svg>
  )
}
