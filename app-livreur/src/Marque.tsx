/**
 * Logotype purement typographique : l'identité repose sur la police étendue
 * en capitales et l'or cuivré, sans symbole graphique.
 */
export function Marque({ taille = 'normal' }: { taille?: 'normal' | 'grand' }) {
  const grand = taille === 'grand';
  return (
    <div>
      <div className="marque" style={grand ? { fontSize: 38, letterSpacing: '0.26em' } : undefined}>
        Fiyen
      </div>
      <div className="marque-sous">{grand ? 'Delivery' : 'Livreur'}</div>
    </div>
  );
}
