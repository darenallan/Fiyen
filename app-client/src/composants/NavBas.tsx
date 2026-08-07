import { IconeColis, IconeListe, IconeProfil } from './Icones';

export type Onglet = 'suivi' | 'commandes' | 'profil';

/**
 * Navigation basse.
 *
 * Trois onglets seulement, correspondant à ce que le produit fait réellement :
 * le client ne commande pas dans un catalogue (c'est sa compagnie de livraison
 * qui crée la course), donc ni « Explorer » ni « Panier ».
 *
 * L'onglet actif est signalé par la couleur **et** par un trait supérieur, pour
 * rester identifiable sans percevoir la teinte.
 */
export function NavBas({
  actif,
  onChange,
  livraisonEnCours,
}: {
  actif: Onglet;
  onChange: (o: Onglet) => void;
  livraisonEnCours?: boolean;
}) {
  const onglets: { cle: Onglet; libelle: string; Icone: typeof IconeColis }[] = [
    { cle: 'suivi', libelle: 'Suivi', Icone: IconeColis },
    { cle: 'commandes', libelle: 'Commandes', Icone: IconeListe },
    { cle: 'profil', libelle: 'Profil', Icone: IconeProfil },
  ];

  return (
    <nav className="nav-bas" aria-label="Navigation principale">
      {onglets.map(({ cle, libelle, Icone }) => (
        <button
          key={cle}
          className={actif === cle ? 'actif' : ''}
          onClick={() => onChange(cle)}
          aria-current={actif === cle ? 'page' : undefined}
        >
          <Icone />
          {libelle}
          {cle === 'suivi' && livraisonEnCours && actif !== 'suivi' && (
            <span className="nav-point" aria-label="Livraison en cours" />
          )}
        </button>
      ))}
    </nav>
  );
}
