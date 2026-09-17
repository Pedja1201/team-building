import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createWorker } from '../hosting/worker.mjs';
const worker = createWorker({ '/admin.html': { data: btoa('private admin') } });
const identity = { 'oai-authenticated-user-id': 'site-scoped-owner', 'oai-authenticated-user-email': 'owner@example.com' };
const req = (path, headers = identity, options = {}) => new Request('https://example.com' + path, { headers, ...options });
test('date filter includes both whole Belgrade days and matches CSV', async () => {
  const { db, env } = database();
  const insert = db.prepare('INSERT INTO registrations (email, registered_at) VALUES (?, ?)');
  for (const [name, date] of [['before', '2026-09-16 21:59:59'], ['start', '2026-09-16 22:00:00'], ['end', '2026-09-17 21:59:59'], ['after', '2026-09-17 22:00:00']]) insert.run(name + '@example.com', date);
  const list = async params => (await worker.fetch(req('/api/admin/registrations?' + params), env)).json();
  assert.equal((await list('from=2026-09-17&to=2026-09-17')).total, 2);
  assert.equal((await list('from=2026-09-17')).total, 3);
  assert.equal((await list('to=2026-09-17')).total, 3);
  assert.equal((await list('from=2026-09-17&to=2026-09-17&q=start&page=5')).page, 1);
  assert.equal((await list('from=2026-09-19')).total, 0);
  const csv = await (await worker.fetch(req('/api/admin/export.csv?from=2026-09-17&to=2026-09-17&q=end'), env)).text();
  assert.match(csv, /end@example.com/); assert.doesNotMatch(csv, /start@example.com|before@example.com|after@example.com/);
  for (const params of ['from=2026-02-30', 'to=garbage', 'from=2026-09-18&to=2026-09-17']) {
    for (const path of ['/api/admin/registrations', '/api/admin/export.csv']) assert.equal((await worker.fetch(req(path + '?' + params), env)).status, 400);
  }
  db.close();
});
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('drizzle/0000_colossal_jack_flag.sql', 'utf8'));
  const DB = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = args => ({ bind: (...v) => bound(v), first: async () => stmt.get(...args), all: async () => ({ results: stmt.all(...args) }), run: async () => stmt.run(...args) });
      return bound([]);
    },
    async batch(statements) { return Promise.all(statements.map(s => s.run())); },
  };
  return { db, env: { DB, ADMIN_EMAIL: 'owner@example.com' } };
}
test('Belgrade filters and display handle winter and both DST transitions', async () => {
  for (const [day, start, end, local] of [
    ['2026-01-15', '2026-01-14 23:00:00', '2026-01-15 23:00:00', '15.01.2026. 00:00:00'],
    ['2026-03-29', '2026-03-28 23:00:00', '2026-03-29 22:00:00', '29.03.2026. 00:00:00'],
    ['2026-10-25', '2026-10-24 22:00:00', '2026-10-25 23:00:00', '25.10.2026. 00:00:00'],
  ]) {
    const { db, env } = database();
    const insert = db.prepare('INSERT INTO registrations (email, registered_at) VALUES (?, ?)');
    const before = value => new Date(Date.parse(value.replace(' ', 'T') + 'Z') - 1000).toISOString().slice(0, 19).replace('T', ' ');
    insert.run('before@example.com', before(start)); insert.run('start@example.com', start);
    insert.run('last@example.com', before(end)); insert.run('after@example.com', end);
    const list = await (await worker.fetch(req(`/api/admin/registrations?from=${day}&to=${day}`), env)).json();
    assert.equal(list.total, 2);
    assert.equal(list.rows.find(row => row.email === 'start@example.com').registered_at_local, local);
    const csv = await (await worker.fetch(req(`/api/admin/export.csv?from=${day}&to=${day}`), env)).text();
    assert.ok(csv.includes(local)); assert.match(csv, /Europe\/Belgrade/);
    assert.doesNotMatch(csv, /before@example.com|after@example.com/);
    db.close();
  }
});
test('deletion requires owner and same-origin action and removes only the selected record', async () => {
  const { db, env } = database();
  const insert = db.prepare('INSERT INTO registrations (email) VALUES (?)');
  insert.run('delete@example.com'); insert.run('keep@example.com');
  const headers = { ...identity, Origin: 'https://example.com', 'X-Admin-Action': 'delete-registration' };
  const remove = (id, h = headers, method = 'DELETE') => worker.fetch(req('/api/admin/registrations/' + id, h, { method }), env);
  assert.equal((await remove(1, {})).status, 401);
  assert.equal((await remove(1, { ...headers, 'oai-authenticated-user-email': 'other@example.com' })).status, 403);
  assert.equal((await remove(1, { ...headers, Origin: 'https://other.com' })).status, 403);
  assert.equal((await remove(1, identity)).status, 403);
  assert.equal((await remove(1, { ...identity, Origin: 'https://example.com' })).status, 403);
  assert.equal((await remove(1, headers, 'GET')).status, 404);
  for (const id of ['0', '-1', '1 OR 1=1', '9007199254740992']) assert.equal((await remove(id)).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM registrations').get().n, 2);
  assert.equal((await remove(1)).status, 200);
  assert.equal((await remove(1)).status, 404);
  const list = await (await worker.fetch(req('/api/admin/registrations'), env)).json();
  assert.equal(list.total, 1); assert.equal(list.rows[0].email, 'keep@example.com'); assert.equal(list.rows[0].id, 2);
  const csv = await (await worker.fetch(req('/api/admin/export.csv'), env)).text();
  assert.doesNotMatch(csv, /delete@example.com/); assert.match(csv, /keep@example.com/);
  db.close();
});
test('admin page, data, export and import reject anonymous and other users', async () => {
  for (const path of ['/admin', '/admin.html', '/api/admin/registrations', '/api/admin/export.csv', '/api/admin/import']) {
    const anon = await worker.fetch(req(path, {}), { ADMIN_EMAIL: 'owner@example.com' });
    assert.equal(anon.status, path.startsWith('/api/') ? 401 : 302);
    assert.match(anon.headers.get('cache-control'), /no-store/);
    assert.equal((await worker.fetch(req(path, { ...identity, 'oai-authenticated-user-email': 'other@example.com' }), { ADMIN_EMAIL: 'owner@example.com' })).status, 403);
  }
  assert.equal((await worker.fetch(req('/admin'), {})).status, 403);
  assert.equal((await worker.fetch(req('/api/admin/registrations', { 'oai-authenticated-user-email': 'owner@example.com' }), { ADMIN_EMAIL: 'owner@example.com' })).status, 401);
});
test('owner page, pagination, literal search and complete formula-safe CSV', async () => {
  const { db, env } = database();
  const insert = db.prepare('INSERT INTO registrations (email) VALUES (?)');
  for (let n = 0; n < 260; n++) insert.run(`person${n}@example.com`);
  insert.run('=formula@example.com'); insert.run('percent%tag@example.com');
  assert.equal(await (await worker.fetch(req('/admin.html'), env)).text(), 'private admin');
  const list = await (await worker.fetch(req('/api/admin/registrations?page=2'), env)).json();
  assert.equal(list.total, 262); assert.equal(list.rows.length, 50); assert.equal(list.page, 2);
  assert.equal((await (await worker.fetch(req('/api/admin/registrations?q=%25'), env)).json()).total, 1);
  const csv = await worker.fetch(req('/api/admin/export.csv'), env);
  assert.equal(csv.headers.get('cache-control'), 'no-store');
  const text = await csv.text();
  assert.equal(text.trim().split('\r\n').length, 263);
  assert.match(text, /"'=formula@example.com"/);
  db.close();
});
