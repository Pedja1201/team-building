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
