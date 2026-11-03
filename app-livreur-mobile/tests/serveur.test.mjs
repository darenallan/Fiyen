// Tests du réglage de l'adresse du serveur (écran de connexion).
//
//   cd app-livreur-mobile && npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avertissement, normaliserUrlServeur, urlWebSocketDepuis } from '../src/serveurLogique.ts';

test('ce qu’on tape naturellement est accepté et nettoyé', () => {
  assert.deepEqual(normaliserUrlServeur('192.168.11.117:8090'), { ok: true, url: 'http://192.168.11.117:8090' });
  assert.deepEqual(normaliserUrlServeur('  https://api.fiyen.bf/  '), { ok: true, url: 'https://api.fiyen.bf' });
  assert.deepEqual(normaliserUrlServeur('HTTP://192.168.1.5:8090/'), { ok: true, url: 'http://192.168.1.5:8090' });
});

test('les adresses invalides sont refusées avec une raison', () => {
  for (const saisie of ['', '   ', 'ftp://192.168.1.5', 'http://', 'https://api.fiyen.bf/api', 'http://x:y@api.fiyen.bf', 'http://api.fiyen.bf/?a=1']) {
    const r = normaliserUrlServeur(saisie);
    assert.equal(r.ok, false, `accepté à tort : « ${saisie} »`);
    assert.ok(r.raison);
  }
});

test('WebSocket : http → ws, https → wss', () => {
  assert.equal(urlWebSocketDepuis('http://192.168.11.117:8090'), 'ws://192.168.11.117:8090');
  assert.equal(urlWebSocketDepuis('https://api.fiyen.bf'), 'wss://api.fiyen.bf');
});

test('avertissement seulement pour du http hors réseau local', () => {
  assert.equal(avertissement('http://192.168.11.117:8090'), null);
  assert.equal(avertissement('http://10.0.0.2:8090'), null);
  assert.equal(avertissement('https://api.fiyen.bf'), null);
  assert.match(avertissement('http://api.fiyen.bf'), /non chiffrée/);
  assert.match(avertissement('http://41.203.1.10:8090'), /non chiffrée/);
});
