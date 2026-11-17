// Christmas Card List sync server: a Cloudflare Worker with one R2 bucket.
//
// Setup (see worker/README.md): bind an R2 bucket as BUCKET and set one
// secret, INVITE_CODE (lets someone create a sync account).
//
// In the bucket:
//   accounts/<acct>.json   {id, name, created, disabled, codeHash}
//   codes/<sha256(code)>   the account id a sync code opens
//   u/<acct>/list.json     that account's list: {records: [...]}
//
// Each account has its own sync code; it only ever opens its own list. The
// app does the merging; this server stores the file and checks codes.
//
// To turn an account off, edit its accounts/<acct>.json in the R2 bucket
// and set "disabled": true.

const MAX_BYTES = 4 * 1024 * 1024;        // the whole list (it's about 100 KB)
const ORIGINS = ["https://rasii.github.io"];

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req.headers.get("Origin") || "");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res;
    try { res = await route(req, env); }
    catch (e) { res = json({ error: e.code || "server" }, e.status || 500); }
    res = new Response(res.body, res);              // headers may be immutable
    for (const k in cors) res.headers.set(k, cors[k]);
    return res;
  }
};

function corsHeaders(origin) {
  const ok = ORIGINS.indexOf(origin) >= 0 || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match, X-If-Absent",
    "Access-Control-Expose-Headers": "ETag",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  } : { "Vary": "Origin" };
}

function json(v, status, headers) {
  return new Response(JSON.stringify(v), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, headers || {}) });
}
function fail(status, code) { const e = new Error(code); e.status = status; e.code = code; return e; }

async function route(req, env) {
  const url = new URL(req.url), path = url.pathname.replace(/\/+$/, "") || "/", m = req.method;
  if (!env.BUCKET) throw fail(500, "no-bucket");

  if (path === "/" && m === "GET") return json({ app: "card-list-sync", ok: true });
  if (path === "/signup" && m === "POST") return signup(req, env);

  const acct = await auth(req, env);
  if (path === "/me" && m === "GET") return json({ name: acct.name });
  if (path === "/data" && m === "GET") return getList(env, acct);
  if (path === "/data" && m === "PUT") return putList(req, env, acct);
  throw fail(404, "not-found");
}

// ---------------- codes and accounts ----------------
const ALPHA = "ABCDEFGHJKMNPQRSTVWXYZ23456789";     // no 0/O, 1/I/L, U
function randomCode(n) {
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  let s = ""; for (let i = 0; i < n; i++) s += ALPHA[b[i] % ALPHA.length];
  return s;
}
function pretty(code) { return code.match(/.{1,4}/g).join("-"); }
function normal(code) { return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(x => x.toString(16).padStart(2, "0")).join("");
}
async function same(a, b) { return (await sha("x" + a)) === (await sha("x" + b)); }   // no early exit on the secret
async function readJson(env, key) { const o = await env.BUCKET.get(key); return o ? o.json() : null; }
function writeJson(env, key, v) { return env.BUCKET.put(key, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } }); }

async function signup(req, env) {
  const body = await req.json().catch(() => ({}));
  if (!env.INVITE_CODE) throw fail(403, "closed");
  if (!(await same(normal(body.invite), normal(env.INVITE_CODE)))) throw fail(403, "invite");
  const name = String(body.name || "").trim().slice(0, 60) || "Family";
  const code = randomCode(20), codeHash = await sha(code);
  const acct = { id: "a" + randomCode(12).toLowerCase(), name, created: Date.now(), disabled: false, codeHash };
  await writeJson(env, "accounts/" + acct.id + ".json", acct);
  await env.BUCKET.put("codes/" + codeHash, acct.id);
  return json({ code: pretty(code), name });
}

async function auth(req, env) {
  const h = req.headers.get("Authorization") || "";
  const code = normal(h.replace(/^Bearer\s+/i, ""));
  if (!code || code.length < 16) throw fail(401, "code");
  const id = await env.BUCKET.get("codes/" + (await sha(code)));
  if (!id) throw fail(401, "code");
  const acct = await readJson(env, "accounts/" + (await id.text()) + ".json");
  if (!acct) throw fail(401, "code");
  if (acct.disabled) throw fail(403, "disabled");
  return acct;
}

// ---------------- the list ----------------
async function getList(env, acct) {
  const o = await env.BUCKET.get("u/" + acct.id + "/list.json");
  if (!o) throw fail(404, "not-found");
  return new Response(o.body, { headers: { "Content-Type": "application/json", "ETag": o.httpEtag, "Cache-Control": "no-store" } });
}

async function putList(req, env, acct) {
  const key = "u/" + acct.id + "/list.json";
  const text = await req.text();
  if (text.length > MAX_BYTES) throw fail(413, "too-big");
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw fail(400, "bad-json"); }
  if (!doc || !Array.isArray(doc.records)) throw fail(400, "bad-json");
  // written only over the version the app read, so two devices can't overwrite each other
  const opts = { httpMetadata: { contentType: "application/json" } };
  const ifMatch = req.headers.get("If-Match");
  if (ifMatch) opts.onlyIf = { etagMatches: ifMatch.replace(/^W\//, "").replace(/"/g, "") };
  else if (req.headers.get("X-If-Absent")) { if (await env.BUCKET.head(key)) throw fail(412, "conflict"); }
  else throw fail(428, "need-version");
  const o = await env.BUCKET.put(key, text, opts);
  if (!o) throw fail(412, "conflict");
  return json({ ok: true }, 200, { "ETag": o.httpEtag });
}
