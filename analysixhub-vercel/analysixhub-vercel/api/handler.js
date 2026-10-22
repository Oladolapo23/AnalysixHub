// Vercel function: vercel.json sends every /api/* request (and pictures at /uploads/*) here.
// The shared back end lives in lib/app.js.
import { handle } from '../lib/app.js';

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    return JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// resolve-start
function resolve(rawUrl) {
  const u = new URL(rawUrl, 'http://localhost');
  let path = u.pathname;
  const p = u.searchParams.get('p');
  if (p) { path = p.startsWith('/') ? p : '/' + p; u.searchParams.delete('p'); }
  return { path, query: u.searchParams };
}
// resolve-end

export default async function handler(req, res) {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const { path, query } = resolve(req.url);
  let q = null;
  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    q = (text, params) => sql.query(text, params || []);
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
  const r = await handle({ method: req.method, path, query, headers: req.headers, body }, { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD }, q);
  res.statusCode = r.status;
  for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
  res.end(r.body);
}
