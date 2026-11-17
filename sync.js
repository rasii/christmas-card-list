// Sync: keeps the list the same on every device, through the sync server
// (worker/worker.js, on Cloudflare).
//
// Local-first: the list lives on the device and works offline; sync runs in
// the background and merges, it never wipes. The server holds one file per
// account, the whole list: {records: [...]}. A sync reads it, merges it with
// this device's list family by family (whichever copy changed a family last
// wins; deleted families stay deleted), and writes the result back only over
// the version it read (If-Match), so a device that lost a race merges again.
//
// On this device: "sync" {url, code, name} (absent = sync off).
window.Sync = (function(){
  "use strict";

  // the sync server's address (the Worker's workers.dev address); when set,
  // nobody has to type it
  var DEFAULT_URL = "https://card-list-sync.rstigall-4f5.workers.dev";

  var cfg = null, hooks = {}, running = false, again = false, timer = 0;
  var st = { state: "off", last: 0, message: null };

  function err(code){ var e = new Error(code); e.code = code; return e; }
  function status(patch){
    for(var k in patch) st[k] = patch[k];
    if(hooks.status){ try{ hooks.status(JSON.parse(JSON.stringify(st))); }catch(e){} }
  }
  function cleanUrl(u){
    u = String(u || "").trim().replace(/\/+$/, "");
    if(!u) throw err("url");
    if(!/^https?:\/\//i.test(u)) u = "https://" + u;
    return u;
  }

  // o: {method, body, headers}; conn: {url, code} when not signed in yet
  function call(path, o, conn){
    o = o || {}; conn = conn || cfg;
    var headers = Object.assign({}, o.headers || {});
    if(conn.code) headers.Authorization = "Bearer " + conn.code;
    return fetch(conn.url + path, { method: o.method || "GET", headers: headers, body: o.body, cache: "no-store" })
      .catch(function(){ throw err("network"); });
  }
  function failure(res){
    return res.json().catch(function(){ return {}; }).then(function(j){ throw err(j.error || "http-" + res.status); });
  }

  // ---------------- one sync ----------------
  function once(){
    return call("/data").then(function(res){
      if(res.status === 404) return { records: [], etag: null };
      if(!res.ok) return failure(res);
      var etag = res.headers.get("ETag");
      return res.json().then(function(doc){ return { records: Array.isArray(doc && doc.records) ? doc.records : [], etag: etag }; });
    }).then(function(remote){
      // no waiting between reading this device's list and putting the merged
      // one back, so an edit made meanwhile can't be lost
      var m = Data.merge(hooks.get(), remote.records);
      if(m.localBehind) hooks.apply(m.records);
      if(!m.remoteBehind) return true;
      var headers = { "Content-Type": "application/json" };
      if(remote.etag) headers["If-Match"] = remote.etag; else headers["X-If-Absent"] = "1";
      return call("/data", { method: "PUT", headers: headers, body: JSON.stringify({ records: m.records }) }).then(function(res){
        if(res.status === 412) return false;               // someone else wrote first: go again
        if(!res.ok) return failure(res);
        return true;
      });
    });
  }

  function run(){
    if(!cfg) return Promise.resolve();
    if(running){ again = true; return Promise.resolve(); }
    running = true; again = false;
    clearTimeout(timer);
    status({ state: "syncing", message: null });
    var tries = 0;
    function loop(){ return once().then(function(done){ return done || ++tries >= 5 ? done : loop(); }); }
    return loop().then(function(done){
      if(!done) throw err("busy");
      status({ state: "on", last: Date.now() });
    }).catch(function(e){
      if(!cfg) return;
      if(e.code === "network") status({ state: "offline" });
      else status({ state: "error", message: {
        code: "sync code no longer works", disabled: "sync account is turned off", busy: "sync is busy, will retry"
      }[e.code] || "sync problem (" + (e.code || e.message) + ")" });
    }).then(function(){
      running = false;
      if(again && cfg) schedule(500);
    });
  }

  function schedule(ms){
    if(!cfg) return;
    clearTimeout(timer);
    timer = setTimeout(run, ms == null ? 1500 : ms);
  }

  // ---------------- turning it on and off ----------------
  function turnOn(c){
    cfg = c;
    return Store.set("sync", cfg).then(function(){ status({ state: "on", last: 0, message: null }); return run(); });
  }
  function join(url, code){
    var conn;
    try{ conn = { url: cleanUrl(url || DEFAULT_URL), code: String(code || "").trim().toUpperCase() }; }catch(e){ return Promise.reject(e); }
    if(conn.code.replace(/[^A-Z0-9]/g, "").length < 16) return Promise.reject(err("code"));
    return call("/me", null, conn).then(function(res){
      if(!res.ok) return failure(res);
      return res.json();
    }).then(function(me){ return turnOn({ url: conn.url, code: conn.code, name: me.name || "" }); });
  }
  function signup(url, name, invite){
    var conn;
    try{ conn = { url: cleanUrl(url || DEFAULT_URL) }; }catch(e){ return Promise.reject(e); }
    return call("/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, invite: invite }) }, conn)
      .then(function(res){
        if(!res.ok) return failure(res);
        return res.json();
      }).then(function(r){ return turnOn({ url: conn.url, code: r.code, name: r.name || "" }); });
  }
  function off(){
    cfg = null; clearTimeout(timer);
    return Store.remove("sync").catch(function(){}).then(function(){ status({ state: "off", last: 0, message: null }); });
  }

  // h: {get() -> every record, apply(records), status(st)}
  function init(h){
    hooks = h;
    return Store.get("sync").catch(function(){ return null; }).then(function(c){
      cfg = (c && c.url && c.code) ? c : null;
      status({ state: cfg ? "on" : "off" });
      // whenever the app comes to the front or the connection comes back
      document.addEventListener("visibilitychange", function(){ if(!document.hidden) schedule(200); });
      window.addEventListener("online", function(){ schedule(200); });
      if(cfg) run();
    });
  }

  return {
    DEFAULT_URL: DEFAULT_URL,
    init: init, join: join, signup: signup, off: off,
    now: run, schedule: schedule,
    config: function(){ return cfg ? { url: cfg.url, code: cfg.code, name: cfg.name } : null; }
  };
})();
