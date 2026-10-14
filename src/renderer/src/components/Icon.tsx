import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import {
  ArrowSquareOut,
  ArrowsClockwise,
  ArrowsDownUp,
  ArrowsLeftRight,
  Books,
  CaretDown,
  Check,
  DownloadSimple,
  Eye,
  Folder,
  Funnel,
  Gear,
  Globe,
  Heart,
  Info,
  MagnifyingGlass,
  Moon,
  Plus,
  Power,
  Rows,
  SidebarSimple,
  Sparkle,
  SquaresFour,
  Stack,
  Star,
  Sun,
  Trash,
  WarningCircle,
  X
} from '@phosphor-icons/react'

const ICONS = {
  library: Books,
  globe: Globe,
  folder: Folder,
  settings: Gear,
  star: Star,
  check: Check,
  plus: Plus,
  trash: Trash,
  download: DownloadSimple,
  refresh: ArrowsClockwise,
  close: X,
  sparkle: Sparkle,
  eye: Eye,
  layers: Stack,
  external: ArrowSquareOut,
  heart: Heart,
  grid: SquaresFour,
  list: Rows,
  chevron: CaretDown,
  sun: Sun,
  moon: Moon,
  filter: Funnel,
  sort: ArrowsDownUp,
  power: Power,
  sidebar: SidebarSimple,
  alert: WarningCircle,
  info: Info,
  swap: ArrowsLeftRight,
  search: MagnifyingGlass
} satisfies Record<string, PhosphorIcon>

export type IconName = keyof typeof ICONS

interface IconProps {
  name: IconName
  size?: number
  className?: string
  filled?: boolean
}

export default function Icon({ name, size = 15, className, filled }: IconProps): React.JSX.Element {
  const Glyph = ICONS[name]
  return (
    <Glyph
      size={size}
      className={className}
      weight={filled ? 'fill' : 'regular'}
      aria-hidden="true"
      style={{ flex: 'none' }}
    />
  )
}
