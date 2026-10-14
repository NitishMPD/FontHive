/**
 * fontkit 2.x ships no type declarations. Only the surface this app uses is
 * declared; individual faces are narrowed to a local interface in metadata.ts.
 */
declare module 'fontkit' {
  export function create(
    buffer: Buffer | Uint8Array,
    postscriptName?: string
  ): unknown

  export function openSync(path: string, postscriptName?: string): unknown

  const fontkit: {
    create: typeof create
    openSync: typeof openSync
  }

  export default fontkit
}
