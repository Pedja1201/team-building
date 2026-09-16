function json(status, payload) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function register(request, env) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    return json(415, { error: 'JSON required' });
  }
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json(403, { error: 'Invalid origin' });
  let email;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Empty body');
    const parts = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) { await reader.cancel(); throw new Error('Too large'); }
      parts.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!payload || Array.isArray(payload) || Object.keys(payload).length !== 1 || typeof payload.email !== 'string') throw new Error('Invalid payload');
    email = payload.email.trim();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email');
  } catch { return json(400, { error: 'Invalid email' }); }
  try {
    await env.DB.prepare('INSERT INTO registrations (email) VALUES (?) ON CONFLICT DO NOTHING').bind(email).run();
    return json(200, { ok: true });
  } catch {
    console.error('Registration database write failed');
    return json(503, { error: 'Unable to save registration' });
  }
}

export function createWorker(assets) {
  return {
    async fetch(request, env) {
      const path = new URL(request.url).pathname;
      if (path === '/admin' || path === '/admin.html' || path.startsWith('/api/admin/')) return admin(request, env, assets);
      if (path === '/api/registrations' && request.method === 'POST') return register(request, env);
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      const asset = assets[path === '/' ? '/index.html' : path];
      if (!asset) return new Response('Not found', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0)), {
        headers: { 'Content-Type': asset.type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
      });
    },
  };
}

function isOwner(request, env) {
  return Boolean(env.ADMIN_EMAIL && request.headers.get('oai-authenticated-user-id') &&
    request.headers.get('oai-authenticated-user-email')?.toLowerCase() === env.ADMIN_EMAIL.toLowerCase());
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

async function admin(request, env, assets) {
  const url = new URL(request.url);
  const page = url.pathname === '/admin' || url.pathname === '/admin.html';
  // A short-lived deployment secret is used only to import the existing local database.
  // After migration it is removed from the runtime, disabling this authorization path.
  const migration = url.pathname === '/api/admin/import' && env.MIGRATION_TOKEN &&
    request.headers.get('Authorization') === `Bearer ${env.MIGRATION_TOKEN}`;
  if (!isOwner(request, env) && !migration) {
    if (page && !request.headers.get('oai-authenticated-user-id')) return new Response(null, {
      status: 302, headers: { Location: '/signin-with-chatgpt?return_to=%2Fadmin', 'Cache-Control': 'no-store' },
    });
    if (page) return new Response('Pristup je dozvoljen samo vlasniku sajta. Prijavite se odgovarajućim ChatGPT nalogom.', {
      status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
    return json(request.headers.get('oai-authenticated-user-id') ? 403 : 401, { error: 'Pristup nije dozvoljen.' });
  }
  const secureHeaders = { 'Cache-Control': 'no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (page && ['GET', 'HEAD'].includes(request.method)) return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(assets['/admin.html'].data), c => c.charCodeAt(0)), {
    headers: { ...secureHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  });
  try {
    if (url.pathname === '/api/admin/import' && request.method === 'POST') {
      if (!migration && request.headers.get('Origin') !== url.origin) return json(403, { error: 'Invalid origin' });
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json(415, { error: 'JSON required' });
      if (Number(request.headers.get('Content-Length')) > 32768) return json(413, { error: 'Too large' });
      const body = await request.text();
      if (body.length > 32768) return json(413, { error: 'Too large' });
      let rows;
      try { rows = JSON.parse(body); } catch { return json(400, { error: 'Invalid JSON' }); }
      if (!Array.isArray(rows) || rows.length > 100 || rows.some(r => !r || typeof r.email !== 'string' || r.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) || typeof r.registered_at !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.registered_at))) return json(400, { error: 'Invalid rows' });
      if (rows.length) await env.DB.batch(rows.map(r => env.DB.prepare('INSERT INTO registrations (email, registered_at) VALUES (?, ?) ON CONFLICT DO UPDATE SET registered_at = MIN(registrations.registered_at, excluded.registered_at)').bind(r.email, r.registered_at)));
      return json(200, { ok: true, processed: rows.length });
    }
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
    if (url.pathname === '/api/admin/registrations') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 254);
      const requestedPage = Math.max(1, Math.min(1000000, Number.parseInt(url.searchParams.get('page'), 10) || 1));
      const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM registrations WHERE instr(lower(email), lower(?)) > 0').bind(q).first();
      const current = Math.min(requestedPage, Math.max(1, Math.ceil(count.total / 50)));
      const result = await env.DB.prepare('SELECT email, registered_at FROM registrations WHERE instr(lower(email), lower(?)) > 0 ORDER BY registered_at DESC, id DESC LIMIT 50 OFFSET ?').bind(q, (current - 1) * 50).all();
      return json(200, { rows: result.results, total: count.total, page: current, pageSize: 50 });
    }
    if (url.pathname === '/api/admin/export.csv') {
      const encoder = new TextEncoder();
      // Capture an upper ID so registrations arriving during export cannot extend it indefinitely.
      const upper = await env.DB.prepare('SELECT COALESCE(MAX(id), 0) AS last FROM registrations').first();
      let cursor = 0;
      let first = true;
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            if (first) { controller.enqueue(encoder.encode('\uFEFF"Email adresa","Vreme prijave (UTC)"\r\n')); first = false; }
            const { results } = await env.DB.prepare('SELECT id, email, registered_at FROM registrations WHERE id > ? AND id <= ? ORDER BY id LIMIT 250').bind(cursor, upper.last).all();
            for (const row of results) controller.enqueue(encoder.encode(csvCell(row.email) + ',' + csvCell(row.registered_at) + '\r\n'));
            if (results.length < 250) controller.close();
            else cursor = results[results.length - 1].id;
          } catch (error) { controller.error(error); }
        },
      });
      return new Response(stream, { headers: { ...secureHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="prijave.csv"' } });
    }
    return json(404, { error: 'Not found' });
  } catch {
    console.error('Admin database operation failed');
    return json(503, { error: 'Baza trenutno nije dostupna. Pokušajte ponovo.' });
  }
}
