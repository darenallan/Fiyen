// Parcours complet du mode démo, sans téléphone ni serveur.
// Node exécute le TypeScript de src/demo.ts en retirant les types.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_DEMO = '1';
const demo = await import('../src/demo.ts');

const appel = (path, method = 'GET', body) =>
  demo.repondreDemo(path, { method, body: body ? JSON.stringify(body) : undefined });

test('le mode démo est actif avec EXPO_PUBLIC_DEMO=1', () => {
  assert.equal(demo.MODE_DEMO, true);
});

test('mauvais identifiants refusés, bons identifiants acceptés', async () => {
  await assert.rejects(appel('/api/auth/login', 'POST', { telephone: '+22600000000', mot_de_passe: 'x' }), { status: 401 });
  const r = await appel('/api/auth/login', 'POST', { telephone: '+22670000001', mot_de_passe: 'demo' });
  const payload = JSON.parse(Buffer.from(r.token.split('.')[1], 'base64url').toString());
  assert.equal(payload.role, 'livreur');
  assert.ok(payload.exp * 1000 > Date.now() + 1000 * 60 * 60 * 24 * 300);
});

test('parcours : service, course livrée, nouvelle course assignée', { timeout: 20000 }, async () => {
  await appel('/api/auth/login', 'POST', { telephone: '+22670000001', mot_de_passe: 'demo' });
  let courses = await appel('/api/courses/mes-courses');
  const active = courses.find((c) => c.statut === 'assignee');
  assert.ok(active, 'une course à récupérer au départ');

  // Hors service : impossible de commencer.
  await assert.rejects(appel(`/api/courses/${active.id}/statut`, 'PATCH', { statut: 'recuperee' }), { status: 409 });

  assert.equal((await appel('/api/livreurs/me/statut', 'PATCH', { statut: 'dispo' })).statut, 'dispo');
  await appel(`/api/courses/${active.id}/statut`, 'PATCH', { statut: 'recuperee' });
  assert.equal((await appel('/api/livreurs/me')).statut, 'en_course');

  // Saut d'étape refusé, comme le backend.
  await assert.rejects(appel(`/api/courses/${active.id}/statut`, 'PATCH', { statut: 'livree' }), { status: 409 });
  // Pas de fin de service en pleine course.
  await assert.rejects(appel('/api/livreurs/me/statut', 'PATCH', { statut: 'offline' }), { status: 409 });

  await appel(`/api/courses/${active.id}/statut`, 'PATCH', { statut: 'en_route' });
  await appel(`/api/courses/${active.id}/statut`, 'PATCH', { statut: 'livree' });
  assert.equal((await appel('/api/livreurs/me')).statut, 'dispo');

  await new Promise((r) => setTimeout(r, 8600));
  courses = await appel('/api/courses/mes-courses');
  const nouvelle = courses.find((c) => c.statut === 'assignee');
  assert.ok(nouvelle && nouvelle.id !== active.id, 'la compagnie confie une nouvelle course');
});

test('chat masqué : le client répond', { timeout: 10000 }, async () => {
  await appel('/api/auth/login', 'POST', { telephone: '+22670000001', mot_de_passe: 'demo' });
  const session = await appel('/api/courses/FY-1021/masquage');
  assert.equal(session.active, true);
  const histo = await appel(`/api/masquage/${session.session_id}/messages`);
  assert.equal(histo.length, 1);

  const recus = [];
  const stop = demo.chatDemo.abonner(session.session_id, (m) => recus.push(m));
  demo.chatDemo.envoyer(session.session_id, 'Je suis devant le portail');
  await new Promise((r) => setTimeout(r, 2600));
  stop();
  assert.deepEqual(recus.map((m) => m.expediteur), ['livreur', 'destinataire']);
  assert.match(recus[1].contenu, /descends/);
});
