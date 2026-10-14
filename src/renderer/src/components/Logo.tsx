import { Cube } from '@phosphor-icons/react'

export default function Logo({ size = 30 }: { size?: number }): React.JSX.Element {
  return <Cube size={size} weight="regular" aria-hidden="true" />
}
