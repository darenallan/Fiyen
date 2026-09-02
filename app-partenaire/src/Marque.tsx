/**
 * Le logotype est purement typographique : l'identité repose sur la police
 * étendue en capitales et l'or cuivré, sans symbole graphique.
 */
export function Marque({ taille = 'normal' }: { taille?: 'normal' | 'grand' }) {
  const grand = taille === 'grand';
  return (
    <div>
      <div className="marque" style={grand ? { fontSize: 40, letterSpacing: '0.26em' } : undefined}>
        Fiyen
      </div>
      <div className="marque-sous">Delivery</div>
    </div>
  );
}
