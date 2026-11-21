import { createHash } from 'node:crypto';

export function validateClientConfig(url, key) {
  if (!url && !key) return null;
  if (!url || !key) throw new Error('Configure both Supabase URL and publishable key.');
  let legacyAnon = false;
  try { legacyAnon = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch {}
  if (!key.startsWith('sb_publishable_') && !legacyAnon) {
    throw new Error('Only a publishable key or legacy anon key may be bundled. Private keys and session tokens are forbidden.');
  }
  let backend;
  try { backend = new URL(url); } catch { throw new Error('Use a valid Supabase project URL.'); }
  if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password || backend.search || backend.hash) {
    throw new Error('Use a Supabase HTTP(S) project URL without credentials or query parameters.');
  }
  if (backend.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname)) {
    throw new Error('Hosted Supabase connections must use HTTPS.');
  }
  return backend;
}

export function securityMeta(html, backend, devPort) {
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(match => `'sha256-${createHash('sha256').update(match[1].replace(/\r\n?/g, '\n')).digest('base64')}'`);
  const connect = ["'self'"];
  if (backend) {
    connect.push(backend.origin);
    const socket = new URL(backend.origin);
    socket.protocol = backend.protocol === 'https:' ? 'wss:' : 'ws:';
    connect.push(socket.origin);
  }
  if (devPort) connect.push(`ws://127.0.0.1:${devPort}`);
  const content = [
    "default-src 'self'", `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
    `connect-src ${connect.join(' ')}`, "object-src 'none'", "base-uri 'none'",
    "form-action 'none'", "frame-src 'none'",
  ].join('; ');
  return [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content }, injectTo: 'head-prepend' },
    { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
  ];
}
