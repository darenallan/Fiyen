import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import { MODE_DEMO } from './api/demo'

// La démo s'ouvre depuis un fichier local (file://) : seul le routage par
// ancre (#/courses) y fonctionne, l'historique HTML5 exige un serveur.
const Routeur = MODE_DEMO ? HashRouter : BrowserRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Routeur>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Routeur>
  </StrictMode>,
)
