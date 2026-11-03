// Tests de la logique d'enregistrement push, sans téléphone ni Expo.
//
//   cd app-livreur-mobile && npm test
//
// Node 24 lit directement le TypeScript de `src/push.ts` (types effacés).
// Ce qui est vérifié ici : l'ordre des appels exigé par Expo v57, le refus
// de permission, l'absence de projet EAS, les pannes réseau, et qu'aucun
// jeton malformé n'est envoyé au serveur. Ce qui ne l'est pas : la réception
// réelle d'une notification, qui demande un téléphone (voir PRESENTATION.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enregistrerPush, messagePourLeLivreur } from '../src/push.ts';

const JETON = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

function dependances(surcharges = {}) {
  const journal = [];
  const d = {
    plateforme: 'android',
    projectId: '00000000-0000-0000-0000-000000000000',
    creerCanal: async () => journal.push('canal'),
    permissionActuelle: async () => (journal.push('lecture permission'), 'undetermined'),
    demanderPermission: async () => (journal.push('demande permission'), 'granted'),
    obtenirJeton: async (projectId) => (journal.push(`jeton ${projectId}`), JETON),
    enregistrerSurServeur: async (jeton, plateforme) => journal.push(`serveur ${jeton} ${plateforme}`),
    ...surcharges,
  };
  return { d, journal };
}

test('Android : canal créé avant la permission et le jeton, puis jeton envoyé au serveur', async () => {
  const { d, journal } = dependances();
  const etat = await enregistrerPush(d);
  assert.deepEqual(etat, { etat: 'active', jeton: JETON });
  assert.deepEqual(journal, [
    'canal',
    'lecture permission',
    'demande permission',
    'jeton 00000000-0000-0000-0000-000000000000',
    `serveur ${JETON} android`,
  ]);
});

test('permission déjà accordée : on ne redemande pas', async () => {
  const { d, journal } = dependances({ permissionActuelle: async () => 'granted' });
  await enregistrerPush(d);
  assert.ok(!journal.includes('demande permission'));
});

test('permission refusée : ni jeton ni appel serveur, et un message pour le livreur', async () => {
  const { d, journal } = dependances({ demanderPermission: async () => 'denied' });
  const etat = await enregistrerPush(d);
  assert.equal(etat.etat, 'refusee');
  assert.ok(!journal.some((l) => l.startsWith('jeton') || l.startsWith('serveur')));
  assert.match(messagePourLeLivreur(etat), /réglages/);
});

test('sans projet EAS : état « non configurée », pas d’échec silencieux', async () => {
  const { d, journal } = dependances({ projectId: undefined });
  const etat = await enregistrerPush(d);
  assert.equal(etat.etat, 'non_configuree');
  assert.match(etat.raison, /projectId/);
  assert.ok(!journal.some((l) => l.startsWith('serveur')));
  // Problème de configuration : rien à dire au livreur.
  assert.equal(messagePourLeLivreur(etat), null);
});

test('réseau coupé au moment de joindre Expo : erreur rattrapable, rien d’envoyé', async () => {
  const { d, journal } = dependances({ obtenirJeton: async () => { throw new Error('Network request failed'); } });
  const etat = await enregistrerPush(d);
  assert.equal(etat.etat, 'erreur');
  assert.ok(!journal.some((l) => l.startsWith('serveur')));
  assert.ok(messagePourLeLivreur(etat));
});

test('APK sans Firebase : « non configurée », pas un message d’erreur au livreur', async () => {
  const { d, journal } = dependances({
    obtenirJeton: async () => {
      throw new Error("Default FirebaseApp is not initialized in this process bf.fiyen.livreur. Make sure to call FirebaseApp.initializeApp(Context) first.");
    },
  });
  const etat = await enregistrerPush(d);
  assert.equal(etat.etat, 'non_configuree');
  assert.match(etat.raison, /google-services/);
  assert.equal(messagePourLeLivreur(etat), null);
  assert.ok(!journal.some((l) => l.startsWith('serveur')));
});

test('jeton au format inattendu : jamais envoyé au serveur', async () => {
  const { d, journal } = dependances({ obtenirJeton: async () => 'pas-un-jeton' });
  const etat = await enregistrerPush(d);
  assert.equal(etat.etat, 'erreur');
  assert.ok(!journal.some((l) => l.startsWith('serveur')));
});

test('serveur injoignable : erreur, à retenter', async () => {
  const { d } = dependances({ enregistrerSurServeur: async () => { throw new Error('502'); } });
  assert.equal((await enregistrerPush(d)).etat, 'erreur');
});

test('web : indisponible, sans demander de permission', async () => {
  const { d, journal } = dependances({ plateforme: 'web' });
  assert.equal((await enregistrerPush(d)).etat, 'indisponible');
  assert.deepEqual(journal, []);
});

test('iOS : pas de canal Android', async () => {
  const { d, journal } = dependances({ plateforme: 'ios' });
  await enregistrerPush(d);
  assert.ok(!journal.includes('canal'));
});
