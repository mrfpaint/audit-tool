/**
 * Internal Audit Report Builder — Cloudflare Worker
 * =================================================
 * The same shape as the Agreement Dashboard's worker:
 *
 *   browser --(team password)--> Worker --(bridge token)--> Apps Script --> Google Sheet
 *
 * index.html is public (it sits on GitHub Pages), so it holds no credentials
 * and cannot reach the Sheet. This Worker is the only thing that can: it checks
 * the team password, issues a signed 8-hour token, and forwards authenticated
 * calls to the Apps Script bridge. The Sheet itself is never link-shared.
 *
 * Secrets (set with `wrangler secret put <NAME>`):
 *   TEAM_PASSWORD   the password the audit team types on the sign-in screen
 *   TOKEN_SECRET    random string used to sign session tokens (any 32+ chars)
 *   BRIDGE_TOKEN    shared secret that the Apps Script deployment also holds
 *   SHEET_ENDPOINT  the Apps Script web-app /exec URL
 *
 * Plain vars (wrangler.toml [vars]):
 *   ALLOWED_ORIGINS  comma-separated list of origins allowed to call this
 *                    Worker, e.g. "https://mrfpaint.github.io,http://127.0.0.1:8791"
 */

const TOKEN_TTL_SECONDS = 8 * 60 * 60;   // 8 hours, matching the Agreement Dashboard

/* Actions the browser may invoke. Anything not listed is rejected outright, so
   a new Apps Script handler is never reachable until it is named here. */
const ACTIONS = new Set([
  'version',                     // reports the deployed Apps Script version
  'config', 'saveConfig',
  'listAudits', 'saveAudit', 'deleteAudit',
  'listObs', 'saveObs', 'deleteObs'
]);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST')    return json({ error: 'Method not allowed' }, 405, cors);

    const url = new URL(request.url);
    if (url.pathname !== '/api') return json({ error: 'Not found' }, 404, cors);

    /* Reject cross-origin callers that are not on the allow-list. A request with
       no Origin header (curl, server-to-server) is allowed through so the
       endpoint stays testable; the token check below is the real gate. */
    if (origin && !allowedOrigins(env).includes(origin)) {
      return json({ error: 'Origin not allowed' }, 403, cors);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400, cors); }

    const action = String(body?.action || '');

    /* ---- login: password in, signed token out ---- */
    if (action === 'login') {
      if (!env.TEAM_PASSWORD || !env.TOKEN_SECRET) {
        return json({ error: 'Server not configured' }, 500, cors);
      }
      if (!safeEqual(String(body.password || ''), env.TEAM_PASSWORD)) {
        /* Small delay blunts brute-forcing a single shared password. */
        await new Promise(r => setTimeout(r, 400));
        return json({ error: 'Wrong password.' }, 401, cors);
      }
      const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
      return json({ token: await signToken({ exp }, env.TOKEN_SECRET), exp }, 200, cors);
    }

    /* ---- everything else needs a valid, unexpired token ---- */
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!await verifyToken(token, env.TOKEN_SECRET)) {
      return json({ error: 'Session expired — please sign in again.' }, 401, cors);
    }
    if (!ACTIONS.has(action)) return json({ error: 'Unknown action' }, 400, cors);

    /* ---- forward to the Apps Script bridge ---- */
    if (!env.SHEET_ENDPOINT || !env.BRIDGE_TOKEN) {
      return json({ error: 'Sheet bridge not configured' }, 500, cors);
    }
    try {
      const upstream = await fetch(env.SHEET_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, bridgeToken: env.BRIDGE_TOKEN }),
        redirect: 'follow'                       // Apps Script /exec always redirects once
      });
      const text = await upstream.text();
      let data;
      try { data = JSON.parse(text); }
      catch {
        /* Apps Script returns an HTML error page when the deployment is
           misconfigured — surface something actionable instead of a parse error. */
        return json({ error: 'Sheet bridge returned a non-JSON response. Check the Apps Script deployment.' }, 502, cors);
      }
      return json(data, upstream.ok ? 200 : 502, cors);
    } catch (err) {
      return json({ error: 'Could not reach the Sheet bridge.' }, 502, cors);
    }
  }
};

/* ------------------------------------------------------------------ helpers */

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}
function corsHeaders(origin, env) {
  const list = allowedOrigins(env);
  const allow = list.includes(origin) ? origin : (list[0] || '');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors }
  });
}
/* Length-independent comparison so a wrong password does not leak how much of
   it matched. (Differing lengths still return early — that is acceptable here.) */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Session token = base64url(payload) "." base64url(HMAC-SHA256(payload)).
   Stateless, so there is nothing to store or invalidate server-side; rotating
   TOKEN_SECRET signs everyone out. */
async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function signToken(payload, secret) {
  const body = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return body + '.' + b64u(sig);
}
async function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return false;
  try {
    /* Verify the signature against the raw body bytes. Re-serialising the
       decoded payload and re-signing it would also "work" but depends on
       JSON.stringify reproducing the exact original bytes — verify directly. */
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify(
      'HMAC', key, b64uDecode(sig), new TextEncoder().encode(body)
    );
    if (!ok) return false;
    const { exp } = JSON.parse(new TextDecoder().decode(b64uDecode(body)));
    return typeof exp === 'number' && exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
/* base64url -> ArrayBuffer */
function b64uDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
