// The app: the list on screen, the edit form, the menu, exports and printing.
// Records and the functions on them are in data.js; saving is store.js;
// syncing is sync.js.
(function(){
  "use strict";

  var $ = function(id){ return document.getElementById(id); };
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var recs = {};                    // id -> record, deleted ones included
  var filter = "all", query = "";
  var sort = { key: "name", dir: 1 };
  var editing = null;               // the record in the edit form
  var isNew = false, origAddr = "", addrTouched = false;
  var syncSt = { state: "off" };

  // ---------------- the list in memory and on the device ----------------
  function live(){ return Object.keys(recs).map(function(id){ return recs[id]; }).filter(function(r){ return !r.del; }); }
  function all(){ return Object.keys(recs).map(function(id){ return recs[id]; }); }
  function stamp(r){ r.t = Math.max(Date.now(), (r.t || 0) + 1); return r; }
  function save(){
    return Store.set("list", { records: all() }).catch(function(){
      toast("Couldn't save on this device. Check its storage isn't full.");
    });
  }
  function changed(){ save(); render(); Sync.schedule(1500); }
  function setAll(list){ recs = {}; list.forEach(function(r){ recs[r.id] = r; }); }

  // ---------------- small helpers ----------------
  var toastTimer = 0;
  function toast(text){
    var t = $("toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.hidden = true; }, 4000);
  }

  // a message with OK (and Cancel when asking); resolves true on OK
  function ask(title, body, o){
    o = o || {};
    return new Promise(function(resolve){
      var d = $("msgDlg");
      $("msgTitle").textContent = title;
      $("msgBody").textContent = body;
      $("msgOk").textContent = o.ok || "OK";
      $("msgOk").className = "btn " + (o.danger ? "danger" : "primary");
      $("msgCancel").hidden = !o.cancel;
      var done = function(v){ $("msgOk").onclick = $("msgCancel").onclick = d.onclose = null; if(d.open) d.close(); resolve(v); };
      $("msgOk").onclick = function(){ done(true); };
      $("msgCancel").onclick = function(){ done(false); };
      d.onclose = function(){ done(false); };
      d.showModal();
    });
  }

  function pickFile(accept){
    return new Promise(function(resolve){
      var f = $("filePick");
      f.value = ""; f.accept = accept;
      f.onchange = function(){ if(f.files[0]) resolve(f.files[0]); };
      f.click();
    });
  }

  function download(name, text, type){
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 10000);
  }

  function phoneLinks(r){
    var out = [];
    if(r.home) out.push('<a href="tel:' + esc(r.home.replace(/[^0-9+]/g, "")) + '">' + esc(r.home) + " (H)</a>");
    if(r.cell) out.push('<a href="tel:' + esc(r.cell.replace(/[^0-9+]/g, "")) + '">' + esc(r.cell) + " (C)</a>");
    return out.join("");
  }
  function phoneText(r){
    return [r.home && r.home + " (H)", r.cell && r.cell + " (C)"].filter(Boolean).join(" / ");
  }

  // ---------------- the list on screen ----------------
  var SORTS = {
    name: Data.byName,
    kids: text("kids"),
    address: function(a, b){ return Data.fullAddress(a).localeCompare(Data.fullAddress(b)); },
    phone: function(a, b){ return phoneText(a).localeCompare(phoneText(b)); },
    card: flag("card"), chex: flag("chex"), announce: flag("announce"),
    sent: latest("sent"), recvd: latest("recvd"), chexYears: latest("chexYears"),
    addrUpdated: function(a, b){ return (b.addrUpdated || "").localeCompare(a.addrUpdated || ""); }
  };
  function text(k){ return function(a, b){ return (!a[k] - !b[k]) || a[k].localeCompare(b[k]); }; }   // blanks last
  function flag(k){ return function(a, b){ return (b[k] ? 1 : 0) - (a[k] ? 1 : 0); }; }                // ticked first
  function latest(k){ return function(a, b){ return (b[k][0] || 0) - (a[k][0] || 0) || b[k].length - a[k].length; }; }

  function shown(){
    var q = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var list = live().filter(function(r){
      if(filter !== "all" && !r[filter]) return false;
      if(!q.length) return true;
      var hay = [r.last, r.first, r.kids, r.street, r.city, r.state, r.zip, r.home, r.cell].join(" ").toLowerCase();
      return q.every(function(w){ return hay.indexOf(w) >= 0; });
    });
    var cmp = SORTS[sort.key] || Data.byName;
    return list.sort(function(a, b){ return sort.dir * cmp(a, b) || Data.byName(a, b); });
  }

  function render(){
    var everyone = live(), list = shown();
    $("nAll").textContent = everyone.length;
    $("nCard").textContent = everyone.filter(function(r){ return r.card; }).length;
    $("nChex").textContent = everyone.filter(function(r){ return r.chex; }).length;
    $("nAnnounce").textContent = everyone.filter(function(r){ return r.announce; }).length;

    $("cards").innerHTML = list.map(function(r){
      var badges = (r.card ? '<span class="badge card">Card</span>' : "") +
                   (r.chex ? '<span class="badge chex">Chex</span>' : "") +
                   (r.announce ? '<span class="badge announce">Announcement</span>' : "");
      var street = esc(r.street), city = esc(Data.cityLine(r));
      var years = [r.sent.length && "Sent " + Data.yearsShort(r.sent, 3), r.recvd.length && "Received " + Data.yearsShort(r.recvd, 3)].filter(Boolean).join(" · ");
      return '<li data-id="' + esc(r.id) + '">' +
        '<div class="fam-top"><span class="fam-name">' + esc(Data.fullName(r)) + "</span>" + badges + "</div>" +
        (r.kids ? '<div class="fam-kids">' + esc(r.kids) + "</div>" : "") +
        (street || city ? '<div class="fam-addr">' + street + (street && city ? "<br>" : "") + city + "</div>" : "") +
        (r.home || r.cell ? '<div class="fam-phone">' + phoneLinks(r) + "</div>" : "") +
        (years ? '<div class="fam-years">' + esc(years) + "</div>" : "") +
        "</li>";
    }).join("");

    $("rows").innerHTML = list.map(function(r){
      function years(k){ var s = Data.yearsText(r[k]); return '<td class="years" title="' + esc(s) + '">' + esc(s) + "</td>"; }
      function tick(k){ return '<td class="tick ' + k + '">' + (r[k] ? "✓" : "") + "</td>"; }
      return '<tr data-id="' + esc(r.id) + '">' +
        '<td class="name">' + esc(Data.fullName(r)) + "</td>" +
        '<td class="kids">' + esc(r.kids) + "</td>" +
        '<td class="addr">' + esc(Data.fullAddress(r)) + "</td>" +
        '<td class="nw">' + [r.home && esc(r.home) + " (H)", r.cell && esc(r.cell) + " (C)"].filter(Boolean).join("<br>") + "</td>" +
        tick("card") + years("sent") + years("recvd") +
        tick("chex") + years("chexYears") +
        tick("announce") +
        '<td class="nw">' + esc(Data.showDate(r.addrUpdated)) + "</td>" +
        "</tr>";
    }).join("");

    Array.prototype.forEach.call(document.querySelectorAll("#grid th"), function(th){
      th.className = (th.classList.contains("c") ? "c " : "") + (th.dataset.s === sort.key ? (sort.dir > 0 ? "up" : "down") : "");
    });

    var none = !list.length;
    $("empty").hidden = !none;
    $("grid").style.display = none ? "none" : "";
    if(none){
      $("emptyText").textContent = everyone.length ? "Nobody matches." : "No families yet. Add one, import the list from the Windows program, or turn on Sync (in the ⋯ menu) if the list is already on another device.";
      $("emptyImport").hidden = !!everyone.length;
    }
    renderStatus();
  }

  function ago(t){
    var m = Math.round((Date.now() - t) / 60000);
    if(m < 1) return "just now";
    if(m < 60) return m + " min ago";
    if(m < 1440) return Math.round(m / 60) + " hr ago";
    return new Date(t).toLocaleDateString();
  }
  function syncText(){
    var s = syncSt;
    if(s.state === "off") return "sync is off";
    if(s.state === "syncing") return "syncing…";
    if(s.state === "error") return s.message || "sync problem";
    if(s.state === "offline") return "offline" + (s.last ? " · synced " + ago(s.last) : "");
    return s.last ? "synced " + ago(s.last) : "sync is on";
  }
  function renderStatus(){
    var n = live().length, shownN = shown().length;
    var count = (filter !== "all" || query.trim()) ? shownN + " of " + n + " families" : n + (n === 1 ? " family" : " families");
    $("status").textContent = count + " · " + syncText();
    $("status").className = syncSt.state === "error" ? "bad" : "";
    $("menuSync").textContent = syncText();
  }

  // header and search bar stay put; the table's headings sit under them
  function layout(){
    var h = document.querySelector("header").offsetHeight, t = document.querySelector(".tools").offsetHeight;
    document.documentElement.style.setProperty("--top1", h + "px");
    document.documentElement.style.setProperty("--top2", (h + t) + "px");
  }

  // ---------------- add / edit ----------------
  var FIELDS = ["last", "first", "kids", "street", "city", "state", "zip", "home", "cell"];
  var ADDR = ["street", "city", "state", "zip"];
  function addrOf(get){ return ADDR.map(get).join("|").toLowerCase(); }

  function openEdit(r){
    isNew = !r;
    editing = r || Data.blank();
    $("editTitle").textContent = isNew ? "New family" : Data.fullName(editing);
    FIELDS.forEach(function(k){ $("f_" + k).value = editing[k] || ""; });
    Data.YEARS.forEach(function(k){ $("f_" + k).value = Data.yearsText(editing[k]); });
    Data.FLAGS.forEach(function(k){ $("f_" + k).checked = !!editing[k]; });
    $("f_addrNow").checked = false; addrTouched = false;
    origAddr = addrOf(function(k){ return (editing[k] || "").trim(); });
    $("addrWhen").textContent = editing.addrUpdated ? "(last: " + Data.showDate(editing.addrUpdated) + ")" : "";
    var y = Data.seasonYear();
    Array.prototype.forEach.call(document.querySelectorAll(".yr"), function(b){ b.textContent = "+ " + y; b.dataset.y = y; });
    $("deleteBtn").hidden = isNew;
    $("saveAnotherBtn").hidden = !isNew;
    $("editDlg").showModal();
    if(isNew) $("f_last").focus(); else $("saveBtn").focus();
  }

  // the form -> the record; false if there's nothing to save
  function readForm(){
    var next = {};
    FIELDS.forEach(function(k){ next[k] = $("f_" + k).value.trim(); });
    Data.YEARS.forEach(function(k){ next[k] = Data.parseYears($("f_" + k).value); });
    Data.FLAGS.forEach(function(k){ next[k] = $("f_" + k).checked; });
    next.addrUpdated = $("f_addrNow").checked ? Data.today() : (editing.addrUpdated || "");
    if(!next.last && !next.first){ toast("Enter a name first."); $("f_last").focus(); return false; }
    var same = !isNew && Object.keys(next).every(function(k){ return JSON.stringify(next[k]) === JSON.stringify(editing[k]); });
    if(!same){
      Object.keys(next).forEach(function(k){ editing[k] = next[k]; });
      recs[editing.id] = stamp(editing);
      changed();
    }
    return true;
  }

  function wireEdit(){
    $("editForm").addEventListener("submit", function(e){
      e.preventDefault();
      if(readForm()) $("editDlg").close();
    });
    $("saveAnotherBtn").onclick = function(){
      if(readForm()){ $("editDlg").close(); openEdit(null); }
    };
    $("cancelBtn").onclick = function(){ $("editDlg").close(); };
    $("deleteBtn").onclick = function(){
      var r = editing;
      ask("Delete this family?", Data.fullName(r) + "\n" + Data.fullAddress(r), { ok: "Delete", cancel: true, danger: true }).then(function(yes){
        if(!yes) return;
        recs[r.id] = stamp({ id: r.id, t: r.t, del: true });
        $("editDlg").close();
        changed();
        toast("Deleted " + Data.fullName(r) + ".");
      });
    };
    // "+ 2026" beside each list of years
    Array.prototype.forEach.call(document.querySelectorAll(".yr"), function(b){
      b.onclick = function(){
        var inp = $(b.dataset.for);
        inp.value = Data.yearsText(Data.addYear(Data.parseYears(inp.value), +b.dataset.y));
      };
    });
    // changing the address ticks "updated today" (untick it if it was only a typo fix)
    ADDR.forEach(function(k){
      $("f_" + k).addEventListener("input", function(){
        if(addrTouched) return;
        $("f_addrNow").checked = addrOf(function(k2){ return $("f_" + k2).value.trim(); }) !== origAddr;
      });
    });
    $("f_addrNow").addEventListener("change", function(){ addrTouched = true; });
  }

  // ---------------- exports and printing ----------------
  function picked(k){ return live().filter(function(r){ return r[k]; }).sort(Data.byName); }

  function exportLabels(k, name, what){
    var list = picked(k);
    if(!list.length){ ask("Nothing to export", "Nobody has \"" + what + "\" ticked."); return; }
    var noAddr = list.filter(function(r){ return !r.street; });
    download(name, Data.labelsCsv(list), "text/csv");
    ask("Saved " + name,
      list.length + " families, in your Downloads folder. Use it as the recipient list for a mail merge." +
      (noAddr.length ? "\n\nNo street address for:\n" + noAddr.map(Data.fullName).join("\n") : ""));
  }

  function printPage(html){
    $("print").innerHTML = html;
    setTimeout(function(){ window.print(); }, 50);
  }

  function printChex(){
    var list = picked("chex");
    if(!list.length){ ask("Nothing to print", "Nobody has \"Chex\" ticked."); return; }
    printPage("<h1>Chex Mix " + Data.seasonYear() + "</h1>" +
      '<p class="sub">' + list.length + " families</p>" +
      '<div class="checklist">' + list.map(function(r){ return "<div><i></i><span>" + esc(Data.fullName(r)) + "</span></div>"; }).join("") + "</div>");
  }

  function printAll(){
    var list = shown();
    if(!list.length){ ask("Nothing to print", "The list is empty."); return; }
    var title = { all: "Christmas Card List", card: "Christmas cards", chex: "Chex", announce: "Announcements" }[filter];
    printPage("<h1>" + title + "</h1>" +
      '<p class="sub">' + list.length + " families · printed " + new Date().toLocaleDateString() + "</p>" +
      '<table class="full"><thead><tr><th>Name / Address</th><th>Phone</th><th>Card</th><th>Chex</th><th>Years sent</th><th>Years received</th></tr></thead><tbody>' +
      list.map(function(r){
        return "<tr><td><b>" + esc(Data.fullName(r)) + "</b>" + (r.kids ? " (" + esc(r.kids) + ")" : "") +
          (r.street ? "<br>" + esc(r.street) : "") + (Data.cityLine(r) ? "<br>" + esc(Data.cityLine(r)) : "") + "</td>" +
          "<td>" + [r.home && esc(r.home) + " (H)", r.cell && esc(r.cell) + " (C)"].filter(Boolean).join("<br>") + "</td>" +
          '<td class="t">' + (r.card ? "✓" : "") + '</td><td class="t">' + (r.chex ? "✓" : "") + "</td>" +
          "<td>" + esc(Data.yearsText(r.sent)) + "</td><td>" + esc(Data.yearsText(r.recvd)) + "</td></tr>";
      }).join("") + "</tbody></table>");
  }

  // ---------------- mark a year for everyone ticked ----------------
  function openYear(){
    $("y_year").value = Data.seasonYear();
    $("y_card").textContent = "Years sent, for the " + picked("card").length + " families with Christmas card ticked";
    $("y_chex").textContent = "Years Chex given, for the " + picked("chex").length + " families with Chex ticked";
    document.querySelector('input[name="y_what"][value="card"]').checked = true;
    $("yearDlg").showModal();
  }
  function wireYear(){
    $("yearForm").addEventListener("submit", function(e){
      e.preventDefault();
      var y = parseInt($("y_year").value, 10);
      if(!(y >= 1980 && y <= new Date().getFullYear() + 1)){ toast("Enter a year like " + Data.seasonYear() + "."); return; }
      var what = document.querySelector('input[name="y_what"]:checked').value;
      var field = what === "card" ? "sent" : "chexYears", n = 0;
      picked(what).forEach(function(r){
        if(r[field].indexOf(y) >= 0) return;
        r[field] = Data.addYear(r[field], y); stamp(r); n++;
      });
      $("yearDlg").close();
      if(n) changed();
      toast(n ? "Added " + y + " to " + n + " families." : "Everyone ticked already has " + y + ".");
    });
  }

  // ---------------- import, backup, restore ----------------
  function importXmlText(text){
    var res = Data.importXml(text), added = 0, here = 0, gone = 0;
    res.records.forEach(function(r){
      var mine = recs[r.id];
      if(!mine){ recs[r.id] = r; added++; }
      else if(mine.del) gone++;
      else here++;
    });
    if(added) changed();
    return { added: added, here: here, gone: gone, warnings: res.warnings };
  }
  function importOld(){
    pickFile(".xml,text/xml,application/xml").then(function(f){ return f.text(); }).then(function(text){
      var r = importXmlText(text);
      var msg = "Added " + r.added + " families.";
      if(r.here) msg += "\n" + r.here + " were already in the list and were left as they are.";
      if(r.gone) msg += "\n" + r.gone + " had been deleted here and were not brought back.";
      if(r.warnings.length) msg += "\n\nWorth a look:\n" + r.warnings.join("\n");
      ask("Import finished", msg);
    }).catch(function(e){ ask("Couldn't import", e.message || String(e)); });
  }

  function backup(){
    var name = "christmas-card-list-" + Data.today() + ".json";
    download(name, JSON.stringify({ app: "christmas-card-list", format: 1, saved: new Date().toISOString(), records: live() }, null, 1), "application/json");
    toast("Saved " + name + " to Downloads.");
  }
  function restore(){
    pickFile(".json,application/json").then(function(f){ return f.text(); }).then(function(text){
      var doc;
      try{ doc = JSON.parse(text); }catch(e){ throw new Error("That file isn't a backup from this app."); }
      if(!doc || doc.app !== "christmas-card-list" || !Array.isArray(doc.records)) throw new Error("That file isn't a backup from this app.");
      var list = doc.records.filter(function(r){ return r && typeof r.id === "string" && r.id && !r.del; });
      return ask("Restore this backup?",
        "The list will go back to the " + list.length + " families in the backup saved " + new Date(doc.saved).toLocaleString() +
        ".\n\nIt replaces the " + live().length + " families here now" + (syncSt.state !== "off" ? ", on every synced device." : "."),
        { ok: "Restore", cancel: true, danger: true }).then(function(yes){
        if(!yes) return;
        var keep = {};
        list.forEach(function(r){
          var b = Data.blank(), prev = recs[r.id];
          Data.TEXT.forEach(function(k){ b[k] = typeof r[k] === "string" ? r[k] : ""; });
          Data.YEARS.forEach(function(k){ b[k] = Data.parseYears((Array.isArray(r[k]) ? r[k] : []).join(",")); });
          Data.FLAGS.forEach(function(k){ b[k] = !!r[k]; });
          b.id = r.id; b.t = prev ? prev.t : 0;
          recs[r.id] = stamp(b); keep[r.id] = 1;
        });
        all().forEach(function(r){ if(!keep[r.id] && !r.del) recs[r.id] = stamp({ id: r.id, t: r.t, del: true }); });
        changed();
        toast("Restored " + list.length + " families.");
      });
    }).catch(function(e){ ask("Couldn't restore", e.message || String(e)); });
  }

  // ---------------- sync screen ----------------
  var syncTab = "join";
  function openSync(){
    var c = Sync.config();
    $("syncOff").hidden = !!c; $("syncOn").hidden = !c;
    if(c){
      $("s_show").textContent = c.code;
      $("s_state").textContent = (c.name ? c.name + " · " : "") + syncText();
    }else{
      $("s_err").textContent = "";
      $("s_url").value = Sync.DEFAULT_URL;
      $("s_urlRow").hidden = !!Sync.DEFAULT_URL;
    }
    $("syncDlg").showModal();
  }
  var SYNC_ERRORS = {
    code: "That sync code isn't right.", invite: "That invite code isn't right.", disabled: "This sync account has been turned off.",
    closed: "The sync server isn't taking new accounts.", network: "Couldn't reach the sync server. Check the address and your connection.",
    url: "Enter the sync server's address."
  };
  function wireSync(){
    Array.prototype.forEach.call(document.querySelectorAll("#syncTabs button"), function(b){
      b.onclick = function(){
        syncTab = b.dataset.t;
        Array.prototype.forEach.call(document.querySelectorAll("#syncTabs button"), function(x){ x.classList.toggle("on", x === b); });
        $("syncJoin").hidden = syncTab !== "join"; $("syncNew").hidden = syncTab !== "new";
        $("s_err").textContent = "";
      };
    });
    $("s_go").onclick = function(){
      var url = $("s_url").value.trim(), go = $("s_go");
      $("s_err").textContent = ""; go.disabled = true;
      var p = syncTab === "join" ? Sync.join(url, $("s_code").value) : Sync.signup(url, $("s_name").value, $("s_invite").value);
      p.then(function(){ $("s_code").value = $("s_invite").value = ""; $("syncDlg").close(); openSync(); })
       .catch(function(e){ $("s_err").textContent = SYNC_ERRORS[e.code] || "Something went wrong (" + (e.code || e.message) + ")."; })
       .then(function(){ go.disabled = false; });
    };
    $("s_now").onclick = function(){ Sync.now(); };
    $("s_off").onclick = function(){
      ask("Turn off sync on this device?", "The list stays on this device, and on the sync server for your other devices. Keep the sync code if you'll want to turn it back on.", { ok: "Turn off", cancel: true, danger: true })
        .then(function(yes){ if(yes) Sync.off().then(function(){ $("syncDlg").close(); }); });
    };
  }

  // ---------------- wiring ----------------
  function wire(){
    $("addBtn").onclick = function(){ openEdit(null); };
    $("menuBtn").onclick = function(){ $("menuDlg").showModal(); };
    $("emptyImport").onclick = importOld;
    $("search").addEventListener("input", function(){ query = this.value; render(); });

    $("chips").addEventListener("click", function(e){
      var b = e.target.closest("button"); if(!b) return;
      filter = b.dataset.f;
      Array.prototype.forEach.call($("chips").children, function(x){ x.classList.toggle("on", x === b); });
      render(); window.scrollTo(0, 0);
    });

    function rowClick(e){
      if(e.target.closest("a")) return;                     // a phone number: let it dial
      var row = e.target.closest("[data-id]");
      if(row && recs[row.dataset.id]) openEdit(recs[row.dataset.id]);
    }
    $("cards").addEventListener("click", rowClick);
    $("rows").addEventListener("click", rowClick);

    document.querySelector("#grid thead").addEventListener("click", function(e){
      var th = e.target.closest("th"); if(!th) return;
      if(sort.key === th.dataset.s) sort.dir = -sort.dir; else sort = { key: th.dataset.s, dir: 1 };
      render();
    });

    $("menuDlg").addEventListener("click", function(e){
      var b = e.target.closest("[data-a]"); if(!b) return;
      $("menuDlg").close();
      var a = b.dataset.a;
      if(a === "labels-card") exportLabels("card", "christmas-cards-" + Data.seasonYear() + ".csv", "Christmas card");
      else if(a === "labels-announce") exportLabels("announce", "announcements.csv", "Announcement");
      else if(a === "print-chex") printChex();
      else if(a === "print-all") printAll();
      else if(a === "mark-year") openYear();
      else if(a === "sync") openSync();
      else if(a === "backup") backup();
      else if(a === "restore") restore();
      else if(a === "import") importOld();
    });

    // Cancel / Done buttons, and a click on the dimmed background, close a dialog
    Array.prototype.forEach.call(document.querySelectorAll("dialog"), function(d){
      d.addEventListener("click", function(e){
        if(e.target.closest("[data-close]")){ e.preventDefault(); d.close(); }
        else if(e.target === d && d.id !== "editDlg") d.close();
      });
    });

    wireEdit(); wireYear(); wireSync();
    window.addEventListener("resize", layout);
    $("ver").textContent = self.APP_VERSION;
  }

  // a new version of the app is fetched in the background; switch to it when
  // the app is next put away or brought back, never in the middle of typing
  function offline(){
    if(!("serviceWorker" in navigator) || location.protocol === "file:") return;
    var had = !!navigator.serviceWorker.controller, fresh = false;
    navigator.serviceWorker.register("sw.js").catch(function(){});
    navigator.serviceWorker.addEventListener("controllerchange", function(){ if(had) fresh = true; had = true; });
    document.addEventListener("visibilitychange", function(){
      if(fresh && !document.querySelector("dialog[open]")) location.reload();
    });
  }

  function start(){
    wire(); layout();
    Store.get("list").catch(function(){ return null; }).then(function(d){
      var early = all();                                   // anything added before the list finished loading
      setAll((d && d.records) || []);
      early.forEach(function(r){ recs[r.id] = r; });
      render();
      return Sync.init({
        get: all,
        apply: function(list){ setAll(list); save(); render(); },
        status: function(s){ syncSt = s; renderStatus(); if($("syncDlg").open && Sync.config()) $("s_state").textContent = (Sync.config().name ? Sync.config().name + " · " : "") + syncText(); }
      });
    });
    setInterval(renderStatus, 60000);
    offline();
  }

  // for testing from the console
  window.App = { importXmlText: importXmlText, records: live };

  start();
})();
