import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { BrouillonPreuve, Course } from './api';
import { IconeAlerte, IconeRetour } from './composants/Icones';

/**
 * Écran de remise : ce que le livreur recueille sur le pas de la porte.
 *
 * Tout est **facultatif**. Une remise n'est pas conditionnée à une signature :
 * un écran qui ne prend pas le tracé, un appareil photo qui refuse de démarrer,
 * un destinataire pressé — dans tous ces cas, le colis a quand même été remis.
 * Exiger la preuve ne la ferait pas apparaître, elle créerait une incitation à
 * la fabriquer.
 *
 * Le nom du réceptionnaire est mis en premier parce que c'est le moins coûteux
 * et le plus utile : c'est un nom qui clôt une contestation, pas une image
 * floue.
 */

/** Côté le plus long d'une photo après redimensionnement. 1024 px suffit à
 *  reconnaître un colis devant une porte, et divise le poids par dix. */
const COTE_MAX_PHOTO = 1024;

/** Qualité JPEG. 0,7 est le seuil au-delà duquel le gain visuel ne se voit plus
 *  sur un écran de téléphone, alors que le poids continue de monter. */
const QUALITE_PHOTO = 0.7;

type Mode = 'aucun' | 'signature' | 'photo';

export function EcranRemise({
  course,
  onValider,
  onRetour,
  enCours,
}: {
  course: Course;
  onValider: (preuve: BrouillonPreuve | null) => void;
  onRetour: () => void;
  enCours: boolean;
}) {
  const [nom, setNom] = useState('');
  const [mode, setMode] = useState<Mode>('signature');
  const [photo, setPhoto] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const signature = useRef<SignatureHandle>(null);

  function valider() {
    setErreur(null);

    const preuve: BrouillonPreuve = { capture_le: new Date().toISOString() };
    const nomPropre = nom.trim();
    if (nomPropre) preuve.nom_receptionnaire = nomPropre;

    if (mode === 'signature') {
      const trace = signature.current?.exporter();
      if (trace) {
        preuve.type_media = 'signature';
        preuve.media_mime = 'image/png';
        preuve.media_base64 = trace;
      }
    } else if (mode === 'photo' && photo) {
      preuve.type_media = 'photo';
      preuve.media_mime = 'image/jpeg';
      preuve.media_base64 = photo;
    }

    // Rien du tout : le serveur refuserait une preuve vide, et l'envoyer pour
    // se faire dire non ferait perdre un aller-retour sur un réseau lent.
    if (!preuve.nom_receptionnaire && !preuve.media_base64) {
      onValider(null);
      return;
    }
    onValider(preuve);
  }

  async function choisirPhoto(fichier: File) {
    setErreur(null);
    try {
      setPhoto(await redimensionner(fichier));
    } catch {
      setErreur("Cette image n'a pas pu être préparée. Réessayez ou passez à la signature.");
    }
  }

  return (
    <div className="app">
      <button type="button" className="lien retour sans-impression" onClick={onRetour}>
        <IconeRetour />
        Retour
      </button>

      <div className="heros">
        <p className="surtitre">Remise du colis</p>
        <h1>{course.adresse_arrivee}</h1>
      </div>

      {erreur && (
        <div className="bandeau-erreur" role="alert">
          <IconeAlerte className="icone-inline" />
          <span>{erreur}</span>
        </div>
      )}

      <div className="carte">
        <label>
          Qui a reçu le colis ?
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Nom de la personne"
            autoComplete="off"
            maxLength={120}
          />
        </label>
        <p className="aide">
          Facultatif, mais c’est ce qui règle une contestation le plus simplement.
        </p>
      </div>

      <div className="carte">
        <div className="onglets-preuve" role="tablist" aria-label="Type de preuve">
          {(['signature', 'photo', 'aucun'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`onglet-preuve${mode === m ? ' actif' : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'signature' ? 'Signature' : m === 'photo' ? 'Photo' : 'Sans image'}
            </button>
          ))}
        </div>

        {mode === 'signature' && <Signature ref={signature} />}

        {mode === 'photo' && (
          <div className="zone-photo">
            {photo ? (
              <>
                <img src={`data:image/jpeg;base64,${photo}`} alt="Aperçu de la photo prise" />
                <button type="button" className="contour" onClick={() => setPhoto(null)}>
                  Reprendre
                </button>
              </>
            ) : (
              <label className="bouton-fichier">
                {/* `capture` ouvre l'appareil photo arrière plutôt que la
                    galerie : à la porte, c'est le colis qu'on photographie. */}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void choisirPhoto(f);
                  }}
                />
                Prendre une photo
              </label>
            )}
          </div>
        )}

        {mode === 'aucun' && (
          <p className="aide">
            La livraison sera enregistrée sans image. Le nom du réceptionnaire, s’il est
            renseigné, reste conservé.
          </p>
        )}
      </div>

      <button onClick={valider} disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Confirmer la livraison'}
      </button>
    </div>
  );
}

interface SignatureHandle {
  /** Rend le PNG en base64, ou null si rien n'a été tracé. */
  exporter: () => string | null;
}

/**
 * Canevas de signature.
 *
 * Pointer events plutôt que touch + mouse séparés : un seul jeu de
 * gestionnaires couvre le doigt, le stylet et la souris, et évite le double
 * événement que les navigateurs mobiles émettent pour compatibilité.
 */
function Signature({ ref }: { ref: React.RefObject<SignatureHandle | null> }) {
    const toile = useRef<HTMLCanvasElement>(null);
    const traceEnCours = useRef(false);
    const [vide, setVide] = useState(true);

    useEffect(() => {
      const c = toile.current;
      if (!c) return;

      // Le canevas est dessiné à la résolution réelle de l'écran puis réduit
      // par le CSS : sans cela, un tracé sur un écran à 3× serait flou une fois
      // imprimé sur le reçu.
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      const largeur = c.clientWidth;
      const hauteur = c.clientHeight;
      c.width = largeur * ratio;
      c.height = hauteur * ratio;

      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#16332a';
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        exporter() {
          if (vide || !toile.current) return null;
          // `toDataURL` rend « data:image/png;base64,… » ; le serveur attend
          // le base64 seul.
          return toile.current.toDataURL('image/png').split(',')[1] ?? null;
        },
      }),
      [vide]
    );

    function position(e: React.PointerEvent<HTMLCanvasElement>) {
      const r = e.currentTarget.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function commencer(e: React.PointerEvent<HTMLCanvasElement>) {
      const ctx = toile.current?.getContext('2d');
      if (!ctx) return;
      // La capture garde le tracé continu quand le doigt sort du cadre : sans
      // elle, un trait qui déborde repart d'un point sans lien avec le geste.
      // Elle lève si le pointeur n'est plus actif — un cas de bordure qui ne
      // doit pas empêcher de signer.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* sans capture, le tracé s'interrompt au bord : mieux que rien */
      }
      traceEnCours.current = true;
      const { x, y } = position(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    }

    function tracer(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!traceEnCours.current) return;
      const ctx = toile.current?.getContext('2d');
      if (!ctx) return;
      const { x, y } = position(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (vide) setVide(false);
    }

    function finir() {
      traceEnCours.current = false;
    }

    function effacer() {
      const c = toile.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      setVide(true);
    }

    return (
      <div className="bloc-signature">
        <canvas
          ref={toile}
          className="toile-signature"
          onPointerDown={commencer}
          onPointerMove={tracer}
          onPointerUp={finir}
          onPointerCancel={finir}
          aria-label="Zone de signature du réceptionnaire"
        />
        <div className="pied-signature">
          <span className="aide">{vide ? 'Faire signer ici' : 'Signature enregistrée'}</span>
          <button type="button" className="lien" onClick={effacer} disabled={vide}>
            Effacer
          </button>
        </div>
      </div>
  );
}

/**
 * Réduit une photo avant l'envoi.
 *
 * Une photo de téléphone fait deux à cinq mégaoctets ; le serveur en refuse
 * plus de 512 Ko, et surtout un forfait mobile burkinabè ne se dépense pas en
 * pixels invisibles sur un reçu. Le redimensionnement se fait ici, avant de
 * toucher au réseau.
 */
async function redimensionner(fichier: File): Promise<string> {
  const bitmap = await createImageBitmap(fichier);
  const facteur = Math.min(1, COTE_MAX_PHOTO / Math.max(bitmap.width, bitmap.height));

  const toile = document.createElement('canvas');
  toile.width = Math.round(bitmap.width * facteur);
  toile.height = Math.round(bitmap.height * facteur);

  const ctx = toile.getContext('2d');
  if (!ctx) throw new Error('canvas indisponible');
  ctx.drawImage(bitmap, 0, 0, toile.width, toile.height);
  bitmap.close();

  return toile.toDataURL('image/jpeg', QUALITE_PHOTO).split(',')[1] ?? '';
}
