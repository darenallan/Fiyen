// Construit le dashboard de démonstration en UN fichier HTML autonome
// (dist-demo/fiyen-demo.html), à envoyer à un prospect : il s'ouvre d'un
// double-clic, sans serveur ni compte. Seules les tuiles de la carte
// demandent internet.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('..', import.meta.url));
const dist = join(racine, 'dist-demo');

execSync('npx tsc -b && npx vite build', {
  cwd: racine,
  stdio: 'inherit',
  env: { ...process.env, VITE_DEMO: '1' },
});

let html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = join(dist, 'assets');
const fichiers = readdirSync(assets);

// Feuilles de style → <style>
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+)"[^>]*>/g, (_, nom) => {
  const css = readFileSync(join(assets, nom), 'utf8');
  return `<style>${css}</style>`;
});

// Script module → <script type="module"> en ligne. « </script » dans le code
// fermerait la balise : on l'échappe.
html = html.replace(/<script type="module"[^>]*src="\.\/assets\/([^"]+)"[^>]*><\/script>/g, (_, nom) => {
  const js = readFileSync(join(assets, nom), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});

html = html
  .replace('<html lang="en">', '<html lang="fr">')
  .replace(/<link rel="icon"[^>]*>/, '')
  .replace(/<title>[^<]*<\/title>/, '<title>Fiyen — Dashboard compagnie (démonstration)</title>');

// Tout fichier de assets/ encore cité (attribut ou import() dans le JS) serait
// introuvable une fois le HTML envoyé seul.
const restants = fichiers.filter((f) => !/\.(css|js)$/.test(f) || html.includes(f));
const jsSepares = fichiers.filter((f) => f.endsWith('.js'));
if (jsSepares.length > 1) throw new Error(`Plusieurs paquets JS : ${jsSepares.join(', ')}`);
if (restants.length) throw new Error(`Fichiers non intégrés : ${restants.join(', ')}`);

const sortie = join(dist, 'fiyen-demo.html');
writeFileSync(sortie, html);
console.log(`\n${sortie}  ${(html.length / 1024).toFixed(0)} Ko  (${fichiers.length} fichiers intégrés)`);
