import { IconeListe, IconePlus, IconeProfil } from './Icones';

export type Onglet = 'commandes' | 'commander' | 'profil';

/**
 * Navigation basse de l'espace partenaire.
 *
 * Trois entrées, alignées sur ce que fait un partenaire : suivre ses
 * livraisons, en commander une, gérer son compte. **Pas d'onglet « Explorer »
 * ni « Panier »** : il n'y a ni catalogue ni commerce dans ce produit.
 *
 * « Commander » est au centre et mis en avant : c'est l'action pour laquelle
 * l'application existe, pas une destination parmi d'autres.
 *
 * L'onglet actif est signalé par la couleur **et** par un trait supérieur, pour
 * rester identifiable sans percevoir la teinte.
 */
export function NavBas({
  actif,
  onChange,
}: {
  actif: Onglet;
  onChange: (o: Onglet) => void;
}) {
  return (
    <nav className="nav-bas" aria-label="Navigation principale">
      <button
        className={actif === 'commandes' ? 'actif' : ''}
        onClick={() => onChange('commandes')}
        aria-current={actif === 'commandes' ? 'page' : undefined}
      >
        <IconeListe />
        Commandes
      </button>

      <button className="nav-action" onClick={() => onChange('commander')}>
        <span className="nav-action-pastille">
          <IconePlus />
        </span>
        Commander
      </button>

      <button
        className={actif === 'profil' ? 'actif' : ''}
        onClick={() => onChange('profil')}
        aria-current={actif === 'profil' ? 'page' : undefined}
      >
        <IconeProfil />
        Profil
      </button>
    </nav>
  );
}
