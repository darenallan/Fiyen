/**
 * Jeu d'icônes en SVG inline.
 *
 * Pas d'emoji : leur rendu varie d'un téléphone à l'autre, ils ne prennent pas
 * la couleur du texte et ne se redimensionnent pas proprement. Pas de librairie
 * non plus — une poignée de tracés pèse moins qu'une dépendance sur un réseau
 * mobile lent.
 */
type Props = { className?: string };

export function IconeColis({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </svg>
  );
}

export function IconeListe({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

export function IconeProfil({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function IconeMoto({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M15 17.5h-6l-2.5-5H4M12 6h3l2 4M9 12.5 12 6" />
    </svg>
  );
}

export function IconeAlerte({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </svg>
  );
}

export function IconeBoussole({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5Z" />
    </svg>
  );
}

export function IconeVerrou({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function IconeCheck({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function IconeMaison({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

export function IconeHorloge({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" />
    </svg>
  );
}

export function IconePlus({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconeCarnet({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2Z" />
      <path d="M9 3v18M13 9h3" />
    </svg>
  );
}

export function IconeFleche({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconeRetour({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

export function IconeEpingle({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

export function IconeCroix({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconeEquipe({ className = 'icone' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11.2A3.2 3.2 0 1 0 17 4.8M18 20h3.5a5.5 5.5 0 0 0-3.2-5" />
    </svg>
  );
}
