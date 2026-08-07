import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port fixe : l'origine doit correspondre à CORS_ORIGINS côté backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
  },
})
