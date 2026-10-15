// AnalysixHub back end (form, admin, projects, pictures). Works with a Postgres database (Neon).
// handle() is plain JavaScript with no Vercel-specific parts, so it can be tested anywhere.

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const rand = n => hex(globalThis.crypto.getRandomValues(new Uint8Array(n)));
const sha = async s => hex(await globalThis.crypto.subtle.digest('SHA-256', enc.encode(s)));
async function pbkdf2(pw, salt) {
  const k = await globalThis.crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, k, 256));
}
function same(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const okUrl = u => (/^(https?:\/\/|\/uploads\/)/i.test(u) ? u : '');
const fail = (status, message) => Object.assign(new Error(message), { status });
const out = (status, obj, headers) => ({ status, body: JSON.stringify(obj), headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers) });

const SEED = [
  { t: 'Sales Performance Dashboard', c: 'Data', d: 'An interactive dashboard tracking revenue, regional sales and product trends.', tools: 'Python, SQL, Power BI', out: 'Cut weekly reporting time from hours to minutes.' },
  { t: 'Customer Segmentation Analysis', c: 'Data', d: 'Clustering of customer behaviour to reveal high-value groups.', tools: 'Python, Pandas, scikit-learn', out: 'Identified four segments to guide targeted campaigns.' },
  { t: 'Brand Identity for a Local Cafe', c: 'Graphic', d: 'Logo, colour system, menu cards and social media templates.', tools: 'Illustrator, Photoshop', out: 'A consistent look across print and social channels.' },
  { t: 'Promotional Campaign Flyers', c: 'Graphic', d: 'A flyer and banner set for a seasonal product launch.', tools: 'Photoshop, Canva', out: 'Ready-to-print assets delivered within the deadline.' },
  { t: 'Computer Accessories Store', c: 'Web', d: 'A responsive e-commerce landing page with product highlights.', tools: 'HTML, Tailwind CSS, JavaScript', out: 'A fast, mobile-friendly storefront.' },
  { t: 'Restaurant Ordering Website', c: 'Web', d: 'A food website with an order form that notifies the owner by email.', tools: 'HTML, JavaScript, Node.js', out: 'Customers can place orders in under a minute.' }
];

/* ---------- database (q(sql, params) returns an array of rows) ---------- */
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS enquiries (id TEXT PRIMARY KEY, created TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sessions (h TEXT PRIMARY KEY, exp BIGINT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS hits (k TEXT NOT NULL, t BIGINT NOT NULL)'
];
let initP = null;
function init(q) {
  if (!initP) initP = (async () => { for (const s of SCHEMA) await q(s); })().catch(e => { initP = null; throw e; });
  return initP;
}
async function kget(q, k, d) { const r = await q('SELECT v FROM kv WHERE k = $1', [k]); return r.length ? JSON.parse(r[0].v) : d; }
async function kset(q, k, v) { await q('INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = excluded.v', [k, JSON.stringify(v)]); }
async function getProjects(q) {
  let p = await kget(q, 'projects', null);
  if (!p) { p = SEED.map(x => Object.assign({ id: rand(6), link: '', img: '', pub: true }, x)); await kset(q, 'projects', p); }
  return p;
}
async function limited(q, key, max, ms) {
  const now = Date.now();
  await q('DELETE FROM hits WHERE t < $1', [now - 86400000]);
  const r = await q('SELECT COUNT(*) AS c FROM hits WHERE k = $1 AND t > $2', [key, now - ms]);
  if (Number(r[0].c) >= max) return true;
  await q('INSERT INTO hits (k, t) VALUES ($1, $2)', [key, now]);
  return false;
}
async function sessionHash(q, headers) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(headers.cookie || '');
  if (!m) return null;
  const h = await sha(m[1]);
  const r = await q('SELECT exp FROM sessions WHERE h = $1', [h]);
  return r.length && Number(r[0].exp) > Date.now() ? h : null;
}
async function checkPw(env, q, pw) {
  pw = String(pw || '');
  const a = await kget(q, 'auth', null);
  if (a) return same(await pbkdf2(pw, a.salt), a.hash);
  if (!env.ADMIN_PASSWORD) return false;
  return same(await sha(pw), await sha(String(env.ADMIN_PASSWORD)));
}

/* ---------- cleaning ---------- */
const SOCIAL = ['instagram', 'tiktok', 'facebook', 'linkedin'];
function cleanSettings(s) {
  const o = {}; s = s || {};
  if ('email' in s) o.email = str(s.email, 120);
  if ('whatsapp' in s) o.whatsapp = str(s.whatsapp, 30);
  SOCIAL.forEach(k => { if (k in s) o[k] = /^https?:\/\//i.test(str(s[k], 400)) ? str(s[k], 400) : ''; });
  ['photo', 'logo', 'logoIcon'].forEach(k => { if (k in s) o[k] = okUrl(str(s[k], 300)); });
  return o;
}
function cleanProject(p) {
  p = p || {};
  return {
    id: /^[a-f0-9]{12}$/.test(p.id) ? p.id : rand(6),
    t: str(p.t, 120) || 'Untitled project',
    c: ['Data', 'Graphic', 'Web'].includes(p.c) ? p.c : 'Data',
    d: str(p.d, 600), tools: str(p.tools, 200), out: str(p.out, 300),
    link: okUrl(str(p.link, 400)), img: okUrl(str(p.img, 300)), pub: !!p.pub
  };
}
function cleanEnquiry(e) {
  e = e || {};
  const o = { id: /^[a-f0-9]{12}$/.test(e.id) ? e.id : rand(6), created: str(e.created || e.date, 40) || new Date().toISOString(), status: ['New', 'In progress', 'Completed'].includes(e.status) ? e.status : 'New' };
  ['name', 'email', 'phone', 'company', 'service', 'budget', 'deadline', 'source'].forEach(k => o[k] = str(e[k], 200));
  o.desc = str(e.desc, 4000);
  return o;
}
function parse(text, max) {
  if (text.length > max) throw fail(413, 'File too large');
  try { return JSON.parse(text || '{}'); } catch (e) { throw fail(400, 'Invalid data'); }
}
const enqRow = r => { const o = JSON.parse(r.data); o.id = r.id; o.date = r.created; o.status = r.status; delete o.created; return o; };
async function saveEnqs(q, list) {
  for (let i = 0; i < list.length; i += 50) {
    const part = list.slice(i, i + 50), vals = [], ph = [];
    part.forEach((e, j) => { ph.push('($' + (j * 4 + 1) + ', $' + (j * 4 + 2) + ', $' + (j * 4 + 3) + ', $' + (j * 4 + 4) + ')'); vals.push(e.id, e.created, e.status, JSON.stringify(e)); });
    await q('INSERT INTO enquiries (id, created, status, data) VALUES ' + ph.join(', '), vals);
  }
}

/* ---------- routes ---------- */
async function route(req, env, q) {
  const p = req.path.replace(/\/+$/, ''), m = req.method, h = req.headers;
  const ip = str(h['x-real-ip'] || (h['x-forwarded-for'] || '').split(',')[0], 60) || 'unknown';

  const img = p === '/api/img' || /^\/uploads\/[a-f0-9]{24}$/.test(p);
  if (m === 'GET' && img) {
    const id = String(req.query.get('id') || p.split('/').pop());
    if (!/^[a-f0-9]{24}$/.test(id)) return out(404, { error: 'Not found' });
    const r = await q('SELECT mime, data FROM files WHERE id = $1', [id]);
    if (!r.length) return out(404, { error: 'Not found' });
    return { status: 200, body: Buffer.from(r[0].data, 'base64'), headers: { 'Content-Type': r[0].mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } };
  }

  if (m !== 'GET' && !/application\/json/.test(h['content-type'] || '')) return out(415, { error: 'JSON required' });

  if (m === 'GET' && p === '/api/content') return out(200, await kget(q, 'content', { text: {}, settings: {} }));
  if (m === 'GET' && p === '/api/projects') return out(200, (await getProjects(q)).filter(x => x.pub));

  if (m === 'POST' && p === '/api/enquiries') {
    if (await limited(q, 'enq' + ip, 10, 3600000)) return out(429, { error: 'Too many enquiries. Please try again later.' });
    const e = cleanEnquiry(parse(req.body, 20000));
    e.id = rand(6); e.created = new Date().toISOString(); e.status = 'New';
    if (!e.name || !e.email || !e.service || !e.desc) return out(400, { error: 'Please fill in all required fields.' });
    const n = await q('SELECT COUNT(*) AS c FROM enquiries');
    if (Number(n[0].c) >= 5000) return out(503, { error: 'Inbox is full. Please contact us on WhatsApp.' });
    await saveEnqs(q, [e]);
    return out(200, { ok: true });
  }

  if (m === 'POST' && p === '/api/login') {
    if (await limited(q, 'login' + ip, 6, 900000)) return out(429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const b = parse(req.body, 2000);
    if (!env.ADMIN_PASSWORD && !(await kget(q, 'auth', null))) return out(500, { error: 'Admin password is not set. Add ADMIN_PASSWORD in the Vercel settings and redeploy.' });
    if (str(b.username, 50) !== 'admin' || !(await checkPw(env, q, b.password))) return out(401, { error: 'Incorrect username or password.' });
    const t = rand(32);
    await q('DELETE FROM sessions WHERE exp < $1', [Date.now()]);
    await q('INSERT INTO sessions (h, exp) VALUES ($1, $2)', [await sha(t), Date.now() + 12 * 3600000]);
    return out(200, { ok: true }, { 'Set-Cookie': 'sid=' + t + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200' });
  }
  if (m === 'POST' && p === '/api/logout') {
    const s = await sessionHash(q, h);
    if (s) await q('DELETE FROM sessions WHERE h = $1', [s]);
    return out(200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
  }

  const me = await sessionHash(q, h);
  if (!me) return out(401, { error: 'Please sign in.' });

  if (m === 'GET' && p === '/api/admin/me') return out(200, { user: 'admin' });
  if (m === 'GET' && p === '/api/admin/projects') return out(200, await getProjects(q));
  if (m === 'PUT' && p === '/api/admin/projects') {
    const b = parse(req.body, 1000000);
    if (!Array.isArray(b.projects) || b.projects.length > 200) return out(400, { error: 'Invalid projects' });
    const list = b.projects.map(cleanProject); await kset(q, 'projects', list);
    return out(200, { projects: list });
  }
  if (m === 'PUT' && p === '/api/admin/content') {
    const b = parse(req.body, 1000000), cur = await kget(q, 'content', { text: {}, settings: {} });
    if (b.text && typeof b.text === 'object') {
      const t = {};
      Object.keys(b.text).forEach(k => { if (/^t\d{1,4}$/.test(k) && typeof b.text[k] === 'string') t[k] = b.text[k].slice(0, 3000); });
      cur.text = t;
    }
    if (b.settings) cur.settings = Object.assign(cur.settings || {}, cleanSettings(b.settings));
    await kset(q, 'content', cur);
    return out(200, cur);
  }

  if (m === 'GET' && p === '/api/admin/enquiries') return out(200, (await q('SELECT id, created, status, data FROM enquiries ORDER BY created DESC')).map(enqRow));
  const em = /^\/api\/admin\/enquiries\/([a-f0-9]{12})$/.exec(p);
  if (em && m === 'PATCH') {
    const b = parse(req.body, 2000);
    if (!['New', 'In progress', 'Completed'].includes(b.status)) return out(400, { error: 'Invalid status' });
    const r = await q('UPDATE enquiries SET status = $1 WHERE id = $2 RETURNING id', [b.status, em[1]]);
    if (!r.length) return out(404, { error: 'Not found' });
    return out(200, { ok: true });
  }
  if (em && m === 'DELETE') { await q('DELETE FROM enquiries WHERE id = $1', [em[1]]); return out(200, { ok: true }); }

  if (m === 'POST' && p === '/api/admin/upload') {
    const b = parse(req.body, 2400000), d = String(b.data || '');
    const mm = /^data:image\/(jpeg|png|webp|gif);base64,/.exec(d.slice(0, 40));
    if (!mm) return out(400, { error: 'Please choose a JPG, PNG, WebP or GIF image.' });
    const raw = d.slice(mm[0].length);
    if (raw.length > 1700000) return out(413, { error: 'Image is too big. Please choose a smaller one.' });
    if (!/^[A-Za-z0-9+/]+=*$/.test(raw)) return out(400, { error: 'Invalid image.' });
    const head = Buffer.from(raw.slice(0, 16), 'base64').toString('latin1');
    const magic = { jpeg: head.startsWith('\xff\xd8'), png: head.startsWith('\x89PNG'), gif: head.startsWith('GIF8'), webp: head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP' };
    if (!magic[mm[1]]) return out(400, { error: 'This file is not a real image.' });
    const id = rand(12);
    await q('INSERT INTO files (id, mime, data) VALUES ($1, $2, $3)', [id, 'image/' + mm[1], raw]);
    return out(200, { url: '/uploads/' + id });
  }

  if (m === 'POST' && p === '/api/admin/password') {
    const b = parse(req.body, 2000);
    if (!(await checkPw(env, q, b.current))) return out(400, { error: 'Current password is incorrect.' });
    if (String(b.next || '').length < 10) return out(400, { error: 'New password must be at least 10 characters.' });
    const salt = rand(16);
    await kset(q, 'auth', { salt, hash: await pbkdf2(String(b.next), salt) });
    await q('DELETE FROM sessions WHERE h <> $1', [me]);
    return out(200, { ok: true });
  }

  if (m === 'GET' && p === '/api/admin/backup') {
    return out(200, { content: await kget(q, 'content', { text: {}, settings: {} }), projects: await getProjects(q), enquiries: (await q('SELECT id, created, status, data FROM enquiries ORDER BY created DESC')).map(enqRow) });
  }
  if (m === 'POST' && p === '/api/admin/restore') {
    const b = parse(req.body, 4000000);
    if (!b.content || !Array.isArray(b.projects) || !Array.isArray(b.enquiries)) return out(400, { error: 'This is not a valid backup file.' });
    await kset(q, 'content', { text: b.content.text && typeof b.content.text === 'object' ? b.content.text : {}, settings: cleanSettings(b.content.settings) });
    await kset(q, 'projects', b.projects.slice(0, 200).map(cleanProject));
    await q('DELETE FROM enquiries');
    await saveEnqs(q, b.enquiries.slice(0, 2000).map(cleanEnquiry));
    return out(200, { ok: true });
  }
  return out(404, { error: 'Not found' });
}

/* req: { method, path, query (URLSearchParams), headers (lowercase keys), body (string) }  env: { ADMIN_PASSWORD }  q: database function or null */
export async function handle(req, env, q) {
  if (!q) return out(500, { error: 'Database is not connected. In Vercel open Storage, create a Neon database, connect it to this project, then redeploy.' });
  try {
    await init(q);
    return await route(req, env, q);
  } catch (e) {
    if (e && e.status) return out(e.status, { error: e.message });
    console.error(e);
    return out(500, { error: 'Something went wrong.' });
  }
}
