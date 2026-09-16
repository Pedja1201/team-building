import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../hosting/worker.mjs';

const worker = createWorker({ '/index.html': { data: btoa('page'), type: 'text/html' } });
const request = (body, headers = {}) => new Request('https://example.com/api/registrations', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
test('saves only a trimmed email through a bound query', async () => {
  let saved;
  const env = { DB: { prepare(sql) { assert.match(sql, /VALUES \(\?\)/); return { bind(email) { saved = email; return { async run() {} }; } }; } } };
  const response = await worker.fetch(request({ email: ' Person@example.com ' }), env);
  assert.equal(response.status, 200);
  assert.equal(saved, 'Person@example.com');
});
test('rejects passwords, bad email, large body and cross-origin writes', async () => {
  for (const payload of [{ email: 'x@y.com', password: 'secret' }, { email: 'bad' }, { email: 'x'.repeat(3000) }]) {
    assert.equal((await worker.fetch(request(payload), {})).status, 400);
  }
  assert.equal((await worker.fetch(request({ email: 'x@y.com' }, { Origin: 'https://other.com' }), {})).status, 403);
});
test('database failure is reported rather than showing success', async () => {
  assert.equal((await worker.fetch(request({ email: 'x@y.com' }), {})).status, 503);
});
test('serves public pages while keeping source and databases unavailable', async () => {
  assert.equal(await (await worker.fetch(new Request('https://example.com/'), {})).text(), 'page');
  for (const path of ['/registrations.sqlite3', '/server.py', '/.git/config', '/api/registrations']) {
    assert.equal((await worker.fetch(new Request('https://example.com' + path), {})).status, 404);
  }
});
