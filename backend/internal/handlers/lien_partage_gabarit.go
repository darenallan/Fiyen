package handlers

// gabaritRecuPartage est séparé du reste du fichier : un template HTML est
// plus lisible comme un bloc autonome qu'entrelacé avec du Go.
//
// Fond clair par défaut plutôt que polices auto-hébergées : cette page part
// vers un téléphone quelconque sur un réseau mobile burkinabè, souvent en
// forfait de données limité — la contrainte « économie de données » du projet
// vaut ici plus que jamais, pour un document qui ne se voit qu'une fois.
const gabaritRecuPartage = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{{.Numero}} — Fiyen</title>
<style>
  :root {
    color-scheme: light;
    --creme: #f5efe1;
    --creme-2: #eae0c6;
    --vert: #16332a;
    --tx-clair-muet: #55605a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 16px 48px;
    background: var(--creme);
    color: var(--vert);
    font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    line-height: 1.45;
  }
  .recu {
    max-width: 560px;
    margin: 0 auto;
    background: #fff;
    border: 1px solid var(--creme-2);
    border-radius: 14px;
    padding: 22px 20px;
  }
  .recu-entete {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding-bottom: 14px;
    border-bottom: 2px solid var(--vert);
  }
  .recu-compagnie { font-size: 1.2rem; font-weight: 700; margin: 0; }
  .recu-partenaire { margin: 2px 0 0; color: var(--tx-clair-muet); font-size: 0.9rem; }
  .recu-reference { text-align: right; }
  .surtitre {
    font-family: ui-monospace, "Space Mono", monospace;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--tx-clair-muet);
    margin: 0;
  }
  .recu-numero { font-family: ui-monospace, "Space Mono", monospace; font-size: 1.2rem; font-weight: 700; margin: 2px 0 0; }
  .recu-trajet { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--creme-2); }
  .recu-adresse { margin: 4px 0 0; font-weight: 600; }
  .attenue { color: var(--tx-clair-muet); font-size: 0.85rem; margin: 2px 0 0; }
  .recu-bloc { padding: 12px 0; border-bottom: 1px solid var(--creme-2); }
  .recu-bloc p { margin: 0 0 6px; }
  .recu-etiquette { display: inline-block; min-width: 82px; color: var(--tx-clair-muet); font-family: ui-monospace, "Space Mono", monospace; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .recu-journal { width: 100%; border-collapse: collapse; margin-top: 6px; }
  .recu-journal td { padding: 4px 0; font-size: 0.92rem; border-bottom: 1px dotted var(--creme-2); }
  .recu-journal tr:last-child td { border-bottom: none; }
  .recu-heure { font-family: ui-monospace, "Space Mono", monospace; font-size: 0.78rem; color: var(--tx-clair-muet); white-space: nowrap; padding-right: 12px; }
  .recu-preuve-media { display: block; max-width: 100%; max-height: 220px; object-fit: contain; margin-top: 8px; border: 1px solid var(--creme-2); border-radius: 8px; background: #fff; }
  .recu-pied { padding-top: 12px; }
  .recu-pied p { margin: 0; font-size: 0.78rem; }
  .barre {
    max-width: 560px;
    margin: 14px auto 0;
    display: flex;
    justify-content: flex-end;
  }
  .barre button {
    border: 1px solid var(--vert);
    background: #fff;
    color: var(--vert);
    border-radius: 10px;
    padding: 9px 16px;
    font-size: 0.9rem;
    cursor: pointer;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .recu { border: none; border-radius: 0; padding: 0; }
    .barre { display: none; }
  }
</style>
</head>
<body>
  <article class="recu">
    <header class="recu-entete">
      <div>
        <p class="recu-compagnie">{{.CompagnieNom}}</p>
        {{with .PartenaireNom}}<p class="recu-partenaire">pour {{.}}</p>{{end}}
      </div>
      <div class="recu-reference">
        <p class="surtitre">{{titreDocument .Statut}}</p>
        <p class="recu-numero">{{.Numero}}</p>
      </div>
    </header>

    <section class="recu-trajet">
      <div>
        <p class="surtitre">Retrait</p>
        <p class="recu-adresse">{{.AdresseDepart}}</p>
        {{with .RepereDepart}}<p class="attenue">{{.}}</p>{{end}}
      </div>
      <div>
        <p class="surtitre">Livraison</p>
        <p class="recu-adresse">{{.AdresseArrivee}}</p>
        {{with .RepereArrivee}}<p class="attenue">{{.}}</p>{{end}}
        <p class="attenue" style="font-weight:600;color:var(--vert)">{{.DestinataireNom}}</p>
      </div>
    </section>

    {{if or .DescriptionColis .Instructions}}
    <section class="recu-bloc">
      {{with .DescriptionColis}}<p><span class="recu-etiquette">Colis</span>{{.}}</p>{{end}}
      {{with .Instructions}}<p><span class="recu-etiquette">Consigne</span>{{.}}</p>{{end}}
    </section>
    {{end}}

    {{with .Preuve}}
    <section class="recu-bloc">
      <p class="surtitre">Preuve de remise</p>
      {{with .NomReceptionnaire}}<p><span class="recu-etiquette">Reçu par</span>{{.}}</p>{{end}}
      <p><span class="recu-etiquette">Le</span>{{horodatage .CaptureLe}}</p>
      {{if .TypeMedia}}<img class="recu-preuve-media" src="{{$.MediaURL}}" alt="Preuve de remise">{{end}}
    </section>
    {{end}}

    <section class="recu-bloc" style="border-bottom:none;">
      <p class="surtitre">Déroulé</p>
      {{if .Journal}}
      <table class="recu-journal"><tbody>
        {{range .Journal}}
        <tr><td class="recu-heure">{{horodatage .Horodatage}}</td><td>{{etape $.Etapes .Type}}</td></tr>
        {{end}}
      </tbody></table>
      {{else}}
      <p class="attenue">Aucune étape enregistrée.</p>
      {{end}}
    </section>

    <footer class="recu-pied">
      <p class="attenue">Document émis le {{horodatage .EmisLe}}. Le tarif est celui convenu avec la compagnie de livraison ; il ne figure pas sur ce reçu.</p>
    </footer>
  </article>

  <div class="barre">
    <button type="button" onclick="window.print()">Imprimer</button>
  </div>
</body>
</html>
`
