import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { swPlugin } from './scripts/sw-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), swPlugin()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 3000 },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 700 },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
})
