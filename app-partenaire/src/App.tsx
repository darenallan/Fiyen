import { useEffect, useState } from 'react';
import {
  assurerJetonFrais,
  deconnexionServeur,
  decodeRole,
  getToken,
  setOnUnauthorized,
  setToken,
  type Commande,
  type RolePartenaire,
} from './api';
import { Login } from './Login';
import { EcranCommandes } from './EcranCommandes';
import { EcranCommander } from './EcranCommander';
import { EcranSuivi } from './EcranSuivi';
import { EcranProfil } from './EcranProfil';
import { NavBas, type Onglet } from './composants/NavBas';
import { Annonces } from './composants/Annonces';
import { useEvenements } from './useEvenements';

/**
 * Espace des entreprises clientes.
 *
 * Trois onglets, alignés sur ce qu'un partenaire fait réellement : suivre ses
 * livraisons, en commander une, gérer son compte. Pas d'onglet « Explorer » ni
 * « Panier » — il n'y a ni catalogue ni commerce dans ce produit.
 */

type Vue =
  | { nom: 'liste' }
  | { nom: 'commander' }
  | { nom: 'suivi'; id: string };

function roleCourant(): RolePartenaire {
  const jeton = getToken();
  const role = jeton ? decodeRole(jeton) : null;
  return role === 'collaborateur' ? 'collaborateur' : 'partenaire';
}

function App() {
  const [connecte, setConnecte] = useState(() => getToken() !== null);
  const [onglet, setOnglet] = useState<Onglet>('commandes');
  const [vue, setVue] = useState<Vue>({ nom: 'liste' });
  const [role, setRole] = useState<RolePartenaire>(roleCourant);
  // Compteur de rechargement : un evenement l'incremente, ce qui fait
  // rejouer les listes sans que le hook connaisse leur contenu.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setOnUnauthorized(() => {
      setToken(null);
      setConnecte(false);
    });
  }, []);

  // Renouvellement proactif : au démarrage, toutes les 5 minutes, et au retour
  // au premier plan. Une WebSocket porte son jeton dans l'URL du handshake et
  // ne peut pas le rattraper après coup.
  useEffect(() => {
    if (!connecte) return;

    let actif = true;
    const verifier = async () => {
      const ok = await assurerJetonFrais();
      if (actif && !ok && getToken() === null) setConnecte(false);
    };

    void verifier();
    const timer = window.setInterval(verifier, 5 * 60 * 1000);
    // Un téléphone en veille gèle les minuteries : revenir sur l'onglet doit
    // relancer la vérification plutôt qu'attendre le prochain tour.
    document.addEventListener('visibilitychange', verifier);

    return () => {
      actif = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', verifier);
    };
  }, [connecte]);

  function seConnecter() {
    setRole(roleCourant());
    setConnecte(true);
    setOnglet('commandes');
    setVue({ nom: 'liste' });
  }

  function deconnecter() {
    void deconnexionServeur();
    setToken(null);
    setConnecte(false);
  }

  function commandeEnvoyee(commande: Commande) {
    // On enchaîne directement sur le suivi : ce que le partenaire veut savoir
    // juste après avoir commandé, c'est son numéro de course et où en est le
    // colis — pas revenir à une liste.
    setVue({ nom: 'suivi', id: commande.id });
    setOnglet('commandes');
  }

  if (!connecte) return <Login onConnecte={seConnecter} />;

  return <EspacePartenaire
    role={role}
    onglet={onglet}
    setOnglet={setOnglet}
    vue={vue}
    setVue={setVue}
    version={version}
    onEvenement={() => setVersion((v) => v + 1)}
    onDeconnexion={deconnecter}
    onEnvoyee={commandeEnvoyee}
  />;
}

/**
 * Separe du composant racine pour que le hook d'evenements ne s'execute
 * qu'une fois connecte : ouvrir la socket sans jeton la ferait echouer en
 * boucle avec un backoff qui grandit pour rien.
 */
function EspacePartenaire({
  role, onglet, setOnglet, vue, setVue, version, onEvenement, onDeconnexion, onEnvoyee,
}: {
  role: RolePartenaire;
  onglet: Onglet;
  setOnglet: (o: Onglet) => void;
  vue: Vue;
  setVue: (v: Vue) => void;
  version: number;
  onEvenement: () => void;
  onDeconnexion: () => void;
  onEnvoyee: (c: Commande) => void;
}) {
  const { annonces, ecarter } = useEvenements(onEvenement);

  return (
    <>
      {onglet === 'commandes' && vue.nom === 'liste' && (
        <EcranCommandes
          version={version}
          onOuvrir={(id) => setVue({ nom: 'suivi', id })}
          onCommander={() => setVue({ nom: 'commander' })}
        />
      )}

      {onglet === 'commandes' && vue.nom === 'commander' && (
        <EcranCommander adresseParDefaut="" onEnvoyee={onEnvoyee} />
      )}

      {onglet === 'commandes' && vue.nom === 'suivi' && (
        <EcranSuivi
          version={version}
          commandeID={vue.id}
          onRetour={() => setVue({ nom: 'liste' })}
        />
      )}

      {onglet === 'profil' && <EcranProfil role={role} onDeconnexion={onDeconnexion} />}

      <Annonces annonces={annonces} onEcarter={ecarter} />

      <NavBas
        actif={onglet}
        onChange={(o) => {
          setOnglet(o);
          if (o === 'commandes') setVue({ nom: 'liste' });
          if (o === 'commander') {
            setOnglet('commandes');
            setVue({ nom: 'commander' });
          }
        }}
      />
    </>
  );
}

export default App;
