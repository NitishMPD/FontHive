import type { FontManagerApi } from '@shared/types'

declare global {
  interface Window {
    api: FontManagerApi
  }
}

export {}
