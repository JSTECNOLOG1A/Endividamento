import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@engine': path.resolve(__dirname, './backend/src/engine'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname)],
    },
    watch: {
      // Bind mount Windows -> Docker Desktop não propaga eventos de
      // filesystem de forma confiável; sem polling o HMR fica surdo a
      // mudanças feitas no host.
      usePolling: true,
      interval: 300,
    },
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001',
        changeOrigin: true,
        timeout: 180000,
        proxyTimeout: 180000,
      },
      '/uploads': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
