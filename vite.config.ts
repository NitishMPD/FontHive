import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@': resolve(__dirname, 'src/renderer/src') } },
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true, target: 'es2022' },
  clearScreen: false
})
