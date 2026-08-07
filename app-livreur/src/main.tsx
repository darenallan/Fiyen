import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Le service worker rend la coquille de l'app disponible hors ligne. En dev il
// est inutile (Vite sert tout depuis le réseau) et masquerait le rechargement à
// chaud, donc on ne l'enregistre qu'en production.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // enregistrement impossible : l'app reste pleinement utilisable en ligne
    })
  })
}
