import type { Annonce } from '../useEvenements';
import { IconeCheck, IconeCroix, IconeMoto } from './Icones';

/**
 * Bandeaux d'avancement, empilés en bas de l'écran.
 *
 * En bas et non en haut : sur un téléphone, le pouce y arrive, et le haut est
 * occupé par le titre de l'écran en cours.
 *
 * `aria-live="polite"` plutôt que `assertive` : l'annonce est utile mais
 * n'interrompt pas ce que la personne est en train de faire.
 */
export function Annonces({
  annonces,
  onEcarter,
}: {
  annonces: Annonce[];
  onEcarter: (id: string) => void;
}) {
  if (annonces.length === 0) return null;

  return (
    <div className="annonces" role="status" aria-live="polite">
      {annonces.map((a) => (
        <div key={a.id} className={`annonce annonce-${a.statut}`}>
          <span className="annonce-icone" aria-hidden="true">
            {a.statut === 'livree' ? (
              <IconeCheck className="icone-mini" />
            ) : a.statut === 'annulee' ? (
              <IconeCroix className="icone-mini" />
            ) : (
              <IconeMoto className="icone-mini" />
            )}
          </span>
          <span className="annonce-texte">
            <span className="annonce-numero">{a.numero}</span>
            {a.texte}
          </span>
          <button
            type="button"
            className="annonce-fermer"
            onClick={() => onEcarter(a.id)}
            aria-label={`Masquer l’annonce ${a.numero}`}
          >
            <IconeCroix className="icone-mini" />
          </button>
        </div>
      ))}
    </div>
  );
}
