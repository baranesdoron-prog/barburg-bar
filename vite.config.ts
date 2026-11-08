import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Shown in the app header, so it's clear which deploy is on screen.
  // Netlify sets COMMIT_REF during its builds.
  define: {
    __BUILD_SHA__: JSON.stringify((process.env.COMMIT_REF ?? 'local').slice(0, 7)),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
