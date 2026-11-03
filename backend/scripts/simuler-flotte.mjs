/**
 * Simulateur de flotte pour la démonstration — positions GPS **simulées**.
 *
 *   node backend/scripts/simuler-flotte.mjs              # Aminata + Issouf
 *   node backend/scripts/simuler-flotte.mjs --avec-salif # + Salif
 *
 * Fait avancer des livreurs du jeu de démo dans Ouagadougou en déposant une
 * position toutes les 4 s, par la même route que l'app mobile
 * (POST /api/livreurs/me/positions). Le serveur ne fait aucune différence :
 * vue flotte du dashboard, suivi destinataire et suivi partenaire bougent
 * comme avec de vrais téléphones.
 *
 * Salif est exclu par défaut : pendant la démo, c'est lui qu'on pilote depuis
 * l'app livreur, et deux sources de positions pour un même livreur le feraient
 * sauter d'un point à l'autre sur la carte.
 *
 * Ctrl+C pour arrêter. Les livreurs disparaissent de la carte « en ligne »
 * 30 s après (TTL de présence).
 */
const API = process.env.API ?? 'http://localhost:8090';
const MDP = 'motdepasse123';
const INTERVALLE_MS = 4000;

const P = {
  pharmacie: [12.3712, -1.5199],
  ouaga2000: [12.3176, -1.4932],
  roodWoko: [12.3683, -1.5236],
  koulouba: [12.3745, -1.5205],
  zoneBois: [12.3858, -1.4893],
  gounghin: [12.3655, -1.5452],
  citeAn3: [12.3728, -1.5127],
};

// Chaque livreur suit un itinéraire ; `boucle` le fait repartir en sens
// inverse une fois arrivé, sinon il reste sur place (course arrivée).
const LIVREURS = [
  { nom: 'Aminata Zongo', tel: '+22670001002', trajet: [P.pharmacie, P.ouaga2000], pas: 70, boucle: false },
  { nom: 'Issouf Sawadogo', tel: '+22670001006', trajet: [P.roodWoko, P.koulouba, P.zoneBois], pas: 90, boucle: true },
];
if (process.argv.includes('--avec-salif')) {
  LIVREURS.push({ nom: 'Salif Traoré', tel: '+22670001001', trajet: [P.gounghin, P.citeAn3], pas: 60, boucle: false });
}

async function connexion(tel) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telephone: tel, mot_de_passe: MDP }),
  });
  if (!r.ok) throw new Error(`connexion ${tel} → ${r.status} (jeu de démo chargé ?)`);
  return (await r.json()).token;
}

/** Points intermédiaires le long d'un itinéraire à plusieurs étapes. */
function echantillonner(trajet, pas) {
  const pts = [];
  for (let s = 0; s < trajet.length - 1; s++) {
    const [a, b] = [trajet[s], trajet[s + 1]];
    const n = Math.max(2, Math.round(pas / (trajet.length - 1)));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // Léger zigzag : un trajet en ligne droite parfaite trahirait la simulation.
      const z = Math.sin(i / 3) * 0.0004;
      pts.push([a[0] + (b[0] - a[0]) * t + z, a[1] + (b[1] - a[1]) * t - z]);
    }
  }
  pts.push(trajet[trajet.length - 1]);
  return pts;
}

async function main() {
  try {
    await fetch(`${API}/health/live`);
  } catch {
    console.error(`API injoignable sur ${API}.`);
    process.exit(1);
  }

  for (const l of LIVREURS) {
    l.jeton = await connexion(l.tel);
    l.points = echantillonner(l.trajet, l.pas);
    l.i = 0;
    l.sens = 1;
  }
  console.log(`Simulation GPS : ${LIVREURS.map((l) => l.nom).join(', ')} — Ctrl+C pour arrêter.`);

  const tic = async () => {
    for (const l of LIVREURS) {
      const [lat, lon] = l.points[l.i];
      const envoyer = () =>
        fetch(`${API}/api/livreurs/me/positions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${l.jeton}` },
          body: JSON.stringify({ positions: [{ latitude: lat, longitude: lon }] }),
        });
      try {
        let r = await envoyer();
        if (r.status === 401) {
          // Jeton d'accès expiré (30 min) : on se reconnecte simplement.
          l.jeton = await connexion(l.tel);
          r = await envoyer();
        }
        if (!r.ok) console.warn(`  ${l.nom} : ${r.status}`);
      } catch (e) {
        console.warn(`  ${l.nom} : ${e.message}`);
      }

      const fin = l.points.length - 1;
      if (l.boucle) {
        if (l.i + l.sens > fin || l.i + l.sens < 0) l.sens = -l.sens;
        l.i += l.sens;
      } else if (l.i < fin) {
        l.i++;
      }
    }
  };

  await tic();
  setInterval(tic, INTERVALLE_MS);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
