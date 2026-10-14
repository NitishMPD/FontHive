import type { FontRecord, ProviderId } from '@shared/types'
import { makeFamilyId, makeId } from '../fonts/scanner'
import { bunnyProvider } from './bunny'
import { fontsourceProvider } from './fontsource'
import { googleProvider } from './google'
import type { CatalogFace, Provider } from './types'

export const remoteProviders: Record<'google' | 'bunny' | 'fontsource', Provider> = {
  google: googleProvider,
  bunny: bunnyProvider,
  fontsource: fontsourceProvider
}

export const providerNames: Record<ProviderId, string> = {
  google: 'Google Fonts',
  bunny: 'Bunny Fonts',
  fontsource: 'Fontsource',
  local: 'Local & network folders'
}

export function isRemoteProvider(id: ProviderId): id is 'google' | 'bunny' | 'fontsource' {
  return id === 'google' || id === 'bunny' || id === 'fontsource'
}

/**
 * Catalogue faces become library records that are known but not yet downloaded.
 * `previewUrl` (CSS) or `previewFileUrl` (direct woff2) lets the UI render them
 * immediately, while `downloadUrl` stays empty until a download is requested.
 *
 * Ids are unique by construction here: some catalogues list the same family name
 * under several slugs or types, which would otherwise collapse to one id and
 * produce duplicate React keys and inflated counts.
 */
export function catalogToRecords(provider: ProviderId, faces: CatalogFace[]): FontRecord[] {
  const now = Date.now()
  const byId = new Map<string, FontRecord>()

  for (const face of faces) {
    const id = makeId(provider, face.postScriptName)
    if (byId.has(id)) continue

    byId.set(id, {
      id,
      provider,
      family: face.family,
      subfamily: face.subfamily,
      fullName: face.fullName,
      postScriptName: face.postScriptName,
      format: 'ttf' as const,
      weight: face.weight,
      style: face.style,
      category: face.category,
      axes: face.axes,
      previewUrl: face.previewUrl,
      previewFileUrl: face.previewFileUrl,
      previewFallbackUrl: face.previewFallbackUrl,
      cached: false,
      active: false,
      familyId: makeFamilyId(provider, face.family),
      version: face.version,
      license: face.license,
      designer: face.designer,
      collections: [],
      tags: [],
      addedAt: now
    })
  }

  return [...byId.values()]
}

export * from './types'
