import { IconeMoto, IconeListe, IconeProfil } from './Icones';

export type Onglet = 'service' | 'courses' | 'profil';

/**
 * Navigation basse du livreur.
 *
 * Trois onglets, alignés sur ce qu'il fait réellement : gérer son service,
 * traiter ses courses, gérer son compte. Une pastille signale une course en
 * attente d'action lorsqu'il n'est pas sur l'onglet Courses.
 *
 * L'onglet actif est signalé par la couleur **et** par un trait supérieur, pour
 * rester identifiable sans percevoir la teinte.
 */
export function NavBas({
  actif,
  onChange,
  coursesEnAttente,
}: {
  actif: Onglet;
  onChange: (o: Onglet) => void;
  coursesEnAttente?: number;
}) {
  const onglets: { cle: Onglet; libelle: string; Icone: typeof IconeMoto }[] = [
    { cle: 'service', libelle: 'Service', Icone: IconeMoto },
    { cle: 'courses', libelle: 'Courses', Icone: IconeListe },
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
          {cle === 'courses' && !!coursesEnAttente && actif !== 'courses' && (
            <span className="nav-point" aria-label={`${coursesEnAttente} course à traiter`} />
          )}
        </button>
      ))}
    </nav>
  );
}
