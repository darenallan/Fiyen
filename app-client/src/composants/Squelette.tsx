/**
 * Squelettes de chargement.
 *
 * Ils reproduisent la forme du contenu à venir : la mise en page ne se décale
 * pas à l'arrivée des données, ce qui compte d'autant plus que le réseau peut
 * être lent. `aria-busy` signale l'attente aux lecteurs d'écran, qui n'ont que
 * faire de l'animation.
 */
export function SqueletteCourse() {
  return (
    <div className="carte" aria-busy="true" aria-label="Chargement de votre livraison">
      <div className="squelette" style={{ width: 96, height: 26, borderRadius: 999 }} />
      <div className="squelette" style={{ width: '72%', height: 26, marginTop: 16 }} />
      <div style={{ marginTop: 20 }}>
        <div className="squelette squelette-ligne" style={{ width: '86%' }} />
        <div className="squelette squelette-ligne" style={{ width: '64%' }} />
      </div>
    </div>
  );
}

export function SqueletteEtapes() {
  return (
    <div className="carte" aria-busy="true">
      <div className="squelette squelette-ligne" style={{ width: 110, marginBottom: 20 }} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="squelette" style={{ width: 16, height: 16, borderRadius: '50%' }} />
          <div className="squelette squelette-ligne" style={{ width: `${58 - i * 7}%`, margin: 0 }} />
        </div>
      ))}
    </div>
  );
}
