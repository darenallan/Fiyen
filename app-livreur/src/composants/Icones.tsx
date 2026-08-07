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
