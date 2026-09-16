import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createWorker } from '../hosting/worker.mjs';
const worker = createWorker({ '/admin.html': { data: btoa('private admin') } });
const identity = { 'oai-authenticated-user-id': 'site-scoped-owner', 'oai-authenticated-user-email': 'owner@example.com' };
const req = (path, headers = identity, options = {}) => new Request('https://example.com' + path, { headers, ...options });
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
