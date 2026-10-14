import type { FontRecord } from '@shared/types'

/**
 * Fonts are loaded lazily, one face at a time, only when a card becomes visible.
 * Local and downloaded files are served over the `rea-font://` protocol; remote
 * catalogue faces use the provider's CSS endpoint where one exists.
 */
const injected = new Set<string>()

function localFamilyName(font: FontRecord): string {
  return `rea-${font.id.replace(/[^a-z0-9]+/gi, '_')}`
}

function injectFace(css: string, key: string): void {
  if (injected.has(key)) return
  injected.add(key)
  const style = document.createElement('style')
  style.dataset.reaFace = key
  style.textContent = css
  document.head.appendChild(style)
}

/**
 * Ensure the face backing `font` is available to the renderer and return the CSS
 * `font-family` value the preview should use.
 */
export function ensureFontLoaded(font: FontRecord): string {
  // 1. A real file on disk — highest fidelity, works offline.
  if (font.filePath) {
    const family = localFamilyName(font)
    injectFace(
      `@font-face{font-family:'${family}';src:url('rea-font://font/${encodeURIComponent(
        font.id
      )}');font-weight:${font.weight};font-style:${font.style};font-display:swap;}`,
      family
    )
    return family
  }

  // 2. Provider CSS endpoint (Google/Bunny) declares the family itself.
  if (font.previewUrl) {
    if (!injected.has(font.previewUrl)) {
      injected.add(font.previewUrl)
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = font.previewUrl
      link.dataset.reaFace = font.previewUrl
      document.head.appendChild(link)
    }
    return `'${font.family}'`
  }

  // 3. A direct remote woff2 (Fontsource).
  if (font.previewFileUrl) {
    const family = localFamilyName(font)
    injectFace(
      `@font-face{font-family:'${family}';src:url('${font.previewFileUrl}') format('woff2');font-weight:${font.weight};font-style:${font.style};font-display:swap;}`,
      family
    )
    return family
  }

  // 4. Nothing available locally or remotely — fall back to the UI font.
  return "'Inter', 'Segoe UI', system-ui, sans-serif"
}

/** Build a `font-variation-settings` string from axis overrides. */
export function variationSettings(
  font: FontRecord,
  values: Record<string, number>
): string | undefined {
  if (!font.axes?.length) return undefined
  const parts: string[] = []
  for (const axis of font.axes) {
    const value = values[axis.tag] ?? axis.default
    parts.push(`"${axis.tag}" ${value}`)
  }
  return parts.length ? parts.join(', ') : undefined
}

export function defaultAxisValues(font: FontRecord): Record<string, number> {
  const out: Record<string, number> = {}
  for (const axis of font.axes ?? []) out[axis.tag] = axis.default
  return out
}
