/**
 * Tracé de course : route en pointillés, portion parcourue en trait plein, et
 * point lumineux positionné selon l'avancement réel.
 *
 * Motif signature de la direction artistique. La progression vient du statut de
 * la course, pas d'une estimation inventée.
 */
const TRACE = 'M10 62 C 60 62, 70 16, 120 21 S 200 11 230 16';

/** Longueur approximative du chemin, pour animer la portion parcourue. */
const LONGUEUR = 240;

export function Route({ progression }: { progression: number }) {
  const fraction = Math.min(Math.max(progression, 0), 100) / 100;

  return (
    <svg
      className="route"
      viewBox="0 0 240 78"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Trajet parcouru à ${Math.round(progression)} %`}
    >
      <path className="route-trace" d={TRACE} />
      <path
        className="route-faite"
        d={TRACE}
        strokeDasharray={LONGUEUR}
        strokeDashoffset={LONGUEUR * (1 - fraction)}
      />
      <circle className="route-point" r="5" style={{ offsetDistance: `${fraction * 100}%` }} />
    </svg>
  );
}
