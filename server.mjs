import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';

const PORT = Number(process.env.PORT || 8080);
const UPSTREAM = (process.env.API_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
// 空 = 不注入。海外网络下上游部分接口会拒绝返回数据，那时把它设成一个国内 IP。
const REAL_IP = process.env.REAL_IP ?? '';
const ROOT = resolve(import.meta.dirname);
const SID = 'wyybok_sid';

// sid -> Map(cookieName -> cookieValue). In memory only: nothing touches disk,
// and the browser never sees the upstream credentials.
const jars = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const COOKIE_ATTRS = new Set([
  'path', 'expires', 'max-age', 'domain', 'httponly', 'secure',
  'samesite', 'version', 'comment', 'priority', 'partitioned',
]);

// Album art has to be same-origin for canvas colour sampling to be allowed.
const IMAGE_HOSTS = /(^|\.)(music\.126\.net|music\.127\.net)$/;

function parseCookieHeader(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

// Accepts either a single Set-Cookie header or the concatenated `cookie`
// string that the upstream login endpoints return in their JSON body.
function ingestCookieText(jar, text) {
  if (!text) return;
  const parts = String(text).split(/[;,]\s*(?=[A-Za-z0-9_!#$%&'*+\-.^`|~]+\s*=)/);
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name || COOKIE_ATTRS.has(name.toLowerCase())) continue;
    if (!value || value === 'deleteMe') jar.delete(name);
    else jar.set(name, value);
  }
}

function resolveSession(req, res) {
  const existing = parseCookieHeader(req.headers.cookie)[SID];
  if (existing && jars.has(existing)) return existing;
  const sid = existing && /^[\w-]{8,64}$/.test(existing) ? existing : randomUUID();
  jars.set(sid, new Map());
  res.setHeader('Set-Cookie', `${SID}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  return sid;
}

function readBody(req) {
  return new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        fail(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => done(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function proxy(req, res, requestUrl, sid) {
  const jar = jars.get(sid);
  const path = requestUrl.pathname.slice('/api'.length) || '/';
  const target = new URL(UPSTREAM + path);
  for (const [key, value] of requestUrl.searchParams) target.searchParams.append(key, value);
  if (REAL_IP && !target.searchParams.has('realIP')) target.searchParams.set('realIP', REAL_IP);
  target.searchParams.set('timestamp', String(Date.now()));

  const headers = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
  };
  const cookieHeader = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookieHeader) headers.Cookie = cookieHeader;

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await readBody(req);
    if (!body.length) body = undefined;
    const type = req.headers['content-type'];
    if (type) headers['Content-Type'] = type;
  }

  let upstream;
  try {
    upstream = await fetch(target, { method: req.method, headers, body, redirect: 'follow' });
  } catch (err) {
    sendJson(res, 502, {
      code: -1,
      message: `无法连接音乐 API (${UPSTREAM})：${err.message}`,
    });
    return;
  }

  for (const raw of upstream.headers.getSetCookie()) ingestCookieText(jar, raw);

  const text = await upstream.text();
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  let payload = text;

  if (contentType.includes('json')) {
    try {
      const data = JSON.parse(text);
      // Login endpoints hand back the session as a plain string in the body.
      // Absorb it, then strip it so it never reaches browser JavaScript.
      if (data && typeof data === 'object') {
        if (typeof data.cookie === 'string') {
          ingestCookieText(jar, data.cookie);
          delete data.cookie;
        }
        if (data.data && typeof data.data === 'object' && typeof data.data.cookie === 'string') {
          ingestCookieText(jar, data.data.cookie);
          delete data.data.cookie;
        }
        if (typeof data.token === 'string') delete data.token;
      }
      payload = JSON.stringify(data);
    } catch {
      payload = text;
    }
  }

  if (path === '/logout') jars.set(sid, new Map());

  res.writeHead(upstream.status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function proxyImage(res, requestUrl) {
  const raw = requestUrl.searchParams.get('url');
  let target;
  try {
    target = new URL(raw);
  } catch {
    res.writeHead(400).end('bad url');
    return;
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    res.writeHead(400).end('bad protocol');
    return;
  }
  if (!IMAGE_HOSTS.test(target.hostname)) {
    res.writeHead(403).end('host not allowed');
    return;
  }
  try {
    const upstream = await fetch(target, { headers: { Accept: 'image/*' } });
    if (!upstream.ok) {
      res.writeHead(upstream.status).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.writeHead(502).end(err.message);
  }
}

async function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html';
  const full = resolve(join(ROOT, normalize(rel)));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const file = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const sid = resolveSession(req, res);

  try {
    if (requestUrl.pathname === '/api/__session') {
      sendJson(res, 200, { hasSession: jars.get(sid).has('MUSIC_U') });
      return;
    }
    if (requestUrl.pathname === '/api/__session/reset') {
      jars.set(sid, new Map());
      sendJson(res, 200, { ok: true });
      return;
    }
    if (requestUrl.pathname === '/api/__img') {
      await proxyImage(res, requestUrl);
      return;
    }
    if (requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/')) {
      await proxy(req, res, requestUrl, sid);
      return;
    }
    await serveStatic(res, requestUrl.pathname);
  } catch (err) {
    if (res.headersSent) res.destroy();
    else sendJson(res, 500, { code: -1, message: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`▶ 紫听歌嘞 PURPLE MUSIC   http://127.0.0.1:${PORT}`);
  console.log(`  api proxy /api/*  ->  ${UPSTREAM}`);
  console.log(`  凭证仅保存在本进程内存中，重启即失效。`);
});
