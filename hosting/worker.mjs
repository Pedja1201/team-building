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

const belgradeClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function belgradeParts(date) {
  return Object.fromEntries(belgradeClock.formatToParts(date).map(part => [part.type, part.value]));
}
function belgradeTime(utc) {
  const p = belgradeParts(new Date(utc.replace(' ', 'T') + 'Z'));
  return `${p.day}.${p.month}.${p.year}. ${p.hour}:${p.minute}:${p.second}`;
}
// Resolve each local midnight separately so DST days can have 23 or 25 hours.
function belgradeBoundary(day, nextDay = false) {
  if (!day) return '';
  const target = Date.parse(day + 'T00:00:00Z') + (nextDay ? 86400000 : 0);
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const p = belgradeParts(new Date(instant));
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    instant += target - local;
  }
  return new Date(instant).toISOString().slice(0, 19).replace('T', ' ');
}

async function admin(request, env, assets) {
  const url = new URL(request.url);
  const page = url.pathname === '/admin' || url.pathname === '/admin.html';
  if (!isOwner(request, env)) {
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
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/admin/registrations/')) {
      if (request.headers.get('Origin') !== url.origin || request.headers.get('X-Admin-Action') !== 'delete-registration') return json(403, { error: 'Pristup nije dozvoljen.' });
      const id = url.pathname.slice('/api/admin/registrations/'.length);
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return json(400, { error: 'Neispravna prijava.' });
      const deleted = await env.DB.prepare('DELETE FROM registrations WHERE id = ? RETURNING id').bind(Number(id)).first();
      return deleted ? json(200, { ok: true }) : json(404, { error: 'Prijava je već obrisana.' });
    }
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
    const q = (url.searchParams.get('q') || '').trim().slice(0, 254);
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const validDate = value => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
    if (!validDate(from) || !validDate(to) || (from && to && from > to)) return json(400, { error: 'Unesite ispravan period: datum Od mora biti pre ili jednak datumu Do.' });
    const where = "instr(lower(email), lower(?)) > 0 AND (? = '' OR registered_at >= ?) AND (? = '' OR registered_at < ?)";
    const filters = [q, from, belgradeBoundary(from), to, belgradeBoundary(to, true)];
    if (url.pathname === '/api/admin/registrations') {
      const requestedPage = Math.max(1, Math.min(1000000, Number.parseInt(url.searchParams.get('page'), 10) || 1));
      const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM registrations WHERE ' + where).bind(...filters).first();
      const current = Math.min(requestedPage, Math.max(1, Math.ceil(count.total / 50)));
      const result = await env.DB.prepare('SELECT id, email, registered_at FROM registrations WHERE ' + where + ' ORDER BY registered_at DESC, id DESC LIMIT 50 OFFSET ?').bind(...filters, (current - 1) * 50).all();
      return json(200, { rows: result.results.map(row => ({ ...row, registered_at_local: belgradeTime(row.registered_at) })), total: count.total, page: current, pageSize: 50 });
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
            if (first) { controller.enqueue(encoder.encode('\uFEFF"Email adresa","Vreme prijave (Europe/Belgrade)"\r\n')); first = false; }
            const { results } = await env.DB.prepare('SELECT id, email, registered_at FROM registrations WHERE id > ? AND id <= ? AND ' + where + ' ORDER BY id LIMIT 250').bind(cursor, upper.last, ...filters).all();
            for (const row of results) controller.enqueue(encoder.encode(csvCell(row.email) + ',' + csvCell(belgradeTime(row.registered_at)) + '\r\n'));
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
