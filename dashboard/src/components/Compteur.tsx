import { useEffect, useRef, useState } from 'react';

/**
 * Compteur animé de 0 à `valeur`.
 *
 * L'animation dure moins de 700 ms et n'est qu'un habillage : la valeur finale
 * est atteinte quoi qu'il arrive, et `prefers-reduced-motion` la donne
 * directement — le chiffre n'est jamais faussé ni retardé pour l'utilisateur.
 */
export function Compteur({ valeur }: { valeur: number }) {
  const [affichee, setAffichee] = useState(valeur);
  const precedenteRef = useRef(valeur);

  useEffect(() => {
    const depart = precedenteRef.current;
    precedenteRef.current = valeur;

    if (depart === valeur) return;

    const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduit) {
      setAffichee(valeur);
      return;
    }

    const duree = 650;
    const debut = performance.now();
    let frame = 0;

    const avancer = (t: number) => {
      const p = Math.min((t - debut) / duree, 1);
      // Sortie douce : le chiffre ralentit en approchant de sa valeur.
      const eased = 1 - Math.pow(1 - p, 3);
      setAffichee(Math.round(depart + (valeur - depart) * eased));
      if (p < 1) frame = requestAnimationFrame(avancer);
    };

    frame = requestAnimationFrame(avancer);
    return () => cancelAnimationFrame(frame);
  }, [valeur]);

  return <>{affichee}</>;
}
