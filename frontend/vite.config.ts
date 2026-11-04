import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // backend/main.py: uvicorn backend.main:app --reload --port 8000
      // VITE_API_TARGET lets a scratch backend (other port, scratch DB) be
      // proxied to without touching the default live-dev wiring.
      '/api': process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8000',
    },
  },
})
