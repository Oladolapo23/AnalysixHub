// Vercel function: sends every /api/* request (and pictures at /uploads/*) to the shared back end in lib/app.js
import { neon } from '@neondatabase/serverless';
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

export default async function handler(req, res) {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const u = new URL(req.url, 'http://localhost');
  let q = null;
  if (url) { const sql = neon(url); q = (text, params) => sql.query(text, params || []); }
  const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
  const r = await handle({ method: req.method, path: u.pathname, query: u.searchParams, headers: req.headers, body }, { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD }, q);
  res.statusCode = r.status;
  for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
  res.end(r.body);
}
