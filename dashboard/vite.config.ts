import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port fixe : l'origine doit correspondre à CORS_ORIGINS côté backend.
//
// Sans `strictPort`, un port 5173 déjà pris par un autre projet de la machine
// fait glisser Vite sur le suivant libre en silence — et ce dashboard a fini
// une fois sur le port d'une marketplace sans rapport, ce qui a fait échouer
// un test qui semblait pointer sur le bon serveur. Les trois autres apps
// (`app-livreur`, `app-client`, `app-partenaire`) ont déjà cette protection ;
// celle-ci en manquait.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
})
