// The app: the list on screen, a family's page, the edit form, the This
// Christmas screen, the menu, exports and printing.
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
  var selId = null;                 // the family in the side panel (computers)
  var detailId = null;              // the family in the read-only sheet (phones)
  var allCols = false;              // computers: every column, like the Windows program
  try{ allCols = localStorage.getItem("allcols") === "1"; }catch(e){}

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
  function setAll(list){ recs = {}; list.forEach(function(r){ recs[r.id] = Data.norm(r); }); }

  // ---------------- small helpers ----------------
  var toastTimer = 0;
  function toast(text){
    var t = $("toast");
    t.textContent = text; t.hidden = false;
    // shown as a popover where the browser can, so it sits above an open dialog
    if(t.showPopover){ try{ t.hidePopover(); }catch(e){} try{ t.showPopover(); }catch(e){} }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){
      if(t.hidePopover){ try{ t.hidePopover(); }catch(e){} }
      t.hidden = true;
    }, 4000);
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

  // the last n Christmases, oldest first: 2022..2026
  function recent(n){ var y = Data.seasonYear(), a = []; for(var i = n - 1; i >= 0; i--) a.push(y - i); return a; }
  function yy(y){ return "’" + String(y).slice(2); }
  // a dot per year: filled if the family has that year
  function dots(years, have, cls){
    return '<span class="dots ' + (cls || "") + '" title="' + esc(Data.yearsText(have) || "never") + '">' +
      years.map(function(y){ return "<i" + (have.indexOf(y) >= 0 ? ' class="y"' : "") + "></i>"; }).join("") + "</span>";
  }
  function badges(r){
    return (r.card ? '<span class="badge card">Card</span>' : "") +
           (r.chex ? '<span class="badge chex">Chex</span>' : "") +
           (r.announce ? '<span class="badge announce">Announcement</span>' : "");
  }
  function letterOf(r){
    var c = (r.last || r.first || "").trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : "#";
  }
  function wide(){ return window.matchMedia("(min-width: 1100px)").matches; }

  function render(){
    var everyone = live(), list = shown(), y5 = recent(5);
    $("nAll").textContent = everyone.length;
    $("nCard").textContent = everyone.filter(function(r){ return r.card; }).length;
    $("nChex").textContent = everyone.filter(function(r){ return r.chex; }).length;
    $("nAnnounce").textContent = everyone.filter(function(r){ return r.announce; }).length;

    // phones: cards, under a heading per letter when in name order
    var grouped = sort.key === "name" && sort.dir > 0, letters = [], last = "";
    $("cards").innerHTML = list.map(function(r){
      var head = "", first = "";
      if(grouped){
        var L = letterOf(r);
        if(L !== last){ last = L; letters.push(L); head = '<li class="letter">' + L + "</li>"; first = ' data-first="' + L + '"'; }
      }
      var street = esc(r.street), city = esc(Data.cityLine(r));
      return head + '<li class="fam" data-id="' + esc(r.id) + '"' + first + ">" +
        '<div class="fam-top"><span class="fam-name">' + esc(Data.fullName(r)) + "</span>" + badges(r) + "</div>" +
        (r.kids ? '<div class="fam-kids">' + esc(r.kids) + "</div>" : "") +
        (street || city ? '<div class="fam-addr">' + street + (street && city ? "<br>" : "") + city + "</div>" : "") +
        '<div class="fam-years"><span>Sent ' + dots(y5, r.sent) + "</span><span>Received " + dots(y5, r.recvd, "r") + "</span></div>" +
        "</li>";
    }).join("");
    $("az").hidden = !(grouped && list.length > 25);
    $("az").innerHTML = letters.map(function(L){ return '<span data-l="' + L + '">' + L + "</span>"; }).join("");

    // computers: the table
    $("rows").innerHTML = list.map(function(r){
      function years(k){ var s = Data.yearsText(r[k]); return '<td class="x years" title="' + esc(s) + '">' + esc(s) + "</td>"; }
      function tick(k){ return '<td class="tick ' + k + '">' + (r[k] ? "✓" : "") + "</td>"; }
      return '<tr data-id="' + esc(r.id) + '"' + (r.id === selId ? ' class="sel"' : "") + ">" +
        '<td class="name">' + esc(Data.fullName(r)) + "</td>" +
        '<td class="x kids">' + esc(r.kids) + "</td>" +
        '<td class="addr">' + esc(Data.fullAddress(r)) + "</td>" +
        '<td class="x nw">' + [r.home && esc(r.home) + " (H)", r.cell && esc(r.cell) + " (C)"].filter(Boolean).join("<br>") + "</td>" +
        tick("card") + '<td class="k">' + dots(y5, r.sent) + "</td>" + years("sent") +
        '<td class="k">' + dots(y5, r.recvd, "r") + "</td>" + years("recvd") +
        tick("chex") + '<td class="x years" title="' + esc(Data.chexText(r)) + '">' + esc(Data.chexText(r)) + "</td>" +
        tick("announce") +
        '<td class="x nw">' + esc(Data.showDate(r.addrUpdated)) + "</td>" +
        "</tr>";
    }).join("");
    var span = " " + yy(y5[0]) + "–" + yy(y5[4]);
    $("thSent").textContent = "Sent" + span; $("thRecvd").textContent = "Received" + span;

    Array.prototype.forEach.call(document.querySelectorAll("#grid th"), function(th){
      th.classList.toggle("up", th.dataset.s === sort.key && sort.dir > 0);
      th.classList.toggle("down", th.dataset.s === sort.key && sort.dir < 0);
    });

    var none = !list.length;
    $("empty").hidden = !none;
    document.querySelector(".layout").style.display = none ? "none" : "";
    if(none){
      $("emptyText").textContent = everyone.length ? "Nobody matches." : "No families yet. Add one, import the list from the Windows program, or turn on Sync (in the ⋯ menu) if the list is already on another device.";
      $("emptyImport").hidden = !!everyone.length;
    }
    renderPanel();
    renderStatus();
  }

  // ---------------- a family, to read ----------------
  function detailHtml(r){
    var hist = recent(8), street = esc(r.street), city = esc(Data.cityLine(r));
    function row(label, cls, have, quarts){
      return '<tr class="' + cls + '"><td>' + label + "</td>" +
        hist.map(function(y){
          if(have.indexOf(y) < 0) return "<td><i></i></td>";
          var q = quarts && quarts.indexOf(y) >= 0;
          return '<td><i class="y' + (q ? " q" : "") + '" title="' + y + (quarts ? (q ? ": quart" : ": gallon") : "") + '"></i></td>';
        }).join("") + "</tr>";
    }
    function earlier(label, have){
      var e = have.filter(function(y){ return y < hist[0]; });
      return e.length ? "<div>" + label + " before " + hist[0] + ": " + esc(e.join(", ")) + "</div>" : "";
    }
    function tel(n){ return esc(n.replace(/[^0-9+]/g, "")); }
    var apple = /iP(hone|ad|od)/.test(navigator.userAgent) || navigator.platform === "MacIntel";
    var q = encodeURIComponent(Data.fullAddress(r));
    var maps = apple ? "https://maps.apple.com/?q=" + q : "https://www.google.com/maps/search/?api=1&query=" + q;
    var chex = r.chex || r.chexYears.length;
    var olderChex = Data.chexText({ chexYears: r.chexYears.filter(function(y){ return y < hist[0]; }), chexQuarts: r.chexQuarts });
    var more = earlier("Sent", r.sent) + earlier("Received", r.recvd) +
      (chex && olderChex ? "<div>Chex before " + hist[0] + ": " + esc(olderChex) + "</div>" : "");
    return "<h2>" + esc(Data.fullName(r)) + "</h2>" +
      (badges(r) ? '<div class="badges">' + badges(r) + "</div>" : "") +
      (r.kids ? '<div class="kids">' + esc(r.kids) + "</div>" : "") +
      (street || city
        ? '<div class="addr">' + street + (street && city ? "<br>" : "") + city + "</div>" +
          '<div class="row"><button class="btn small" data-act="copy">Copy address</button>' +
          '<a class="btn small" target="_blank" rel="noopener" href="' + esc(maps) + '">Open in Maps</a></div>'
        : '<div class="addr none">No address yet</div>') +
      (r.home ? '<div class="row"><span class="num">' + esc(r.home) + ' <small>home</small></span><a class="btn small" href="tel:' + tel(r.home) + '">Call</a></div>' : "") +
      (r.cell ? '<div class="row"><span class="num">' + esc(r.cell) + ' <small>cell</small></span><a class="btn small" href="tel:' + tel(r.cell) + '">Call</a><a class="btn small" href="sms:' + tel(r.cell) + '">Text</a></div>' : "") +
      "<h3>Last " + hist.length + " Christmases</h3>" +
      '<table class="hist"><tr><th></th>' + hist.map(function(y){ return "<th>" + yy(y) + "</th>"; }).join("") + "</tr>" +
      row("Sent", "s", r.sent) + row("Received", "r", r.recvd) + (chex ? row("Chex", "g", r.chexYears, r.chexQuarts) : "") + "</table>" +
      (chex ? '<div class="legend"><i class="y"></i> gallon <i class="y q"></i> quart' +
        (r.chex ? " · making a " + Data.sizeName(r) + " this year" : "") + "</div>" : "") +
      (more ? '<div class="more">' + more + "</div>" : "") +
      '<div class="foot"><small>' + (r.addrUpdated ? "Address updated " + esc(Data.showDate(r.addrUpdated)) : "") + "</small>" +
      '<button class="btn primary" data-act="edit">Edit</button></div>';
  }
  // computers: in the side panel; phones (and "All columns"): in a sheet
  function showDetail(r){
    if(wide() && !allCols){ selId = r.id; render(); }
    else { detailId = r.id; $("detailBody").innerHTML = detailHtml(r); $("detailDlg").showModal(); }
  }
  function renderPanel(){
    var r = selId && recs[selId];
    $("panel").innerHTML = r && !r.del ? '<div class="detail">' + detailHtml(r) + "</div>"
      : '<p class="hint">Select a family to see its address and history.</p>';
  }
  function detailClick(e, id){
    var b = e.target.closest("[data-act]"), r = recs[id];
    if(!b || !r) return;
    if(b.dataset.act === "edit"){
      if($("detailDlg").open) $("detailDlg").close();
      openEdit(r);
    }else if(b.dataset.act === "copy"){
      var text = [Data.mailName(r), r.street, Data.cityLine(r)].filter(Boolean).join("\n");
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(function(){ toast("Address copied."); }, function(){ toast("Couldn't copy on this device."); });
    }
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
    $("f_chexYears").value = Data.chexText(editing);
    Data.FLAGS.forEach(function(k){ $("f_" + k).checked = !!editing[k]; });
    document.querySelector('input[name="f_size"][value="' + (editing.chexSize === "Q" ? "Q" : "G") + '"]').checked = true;
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
    var cx = Data.parseChex($("f_chexYears").value);
    next.chexYears = cx.years; next.chexQuarts = cx.quarts;
    Data.FLAGS.forEach(function(k){ next[k] = $("f_" + k).checked; });
    next.chexSize = document.querySelector('input[name="f_size"]:checked').value;
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
        var inp = $(b.dataset.for), y = +b.dataset.y;
        if(b.dataset.for === "f_chexYears"){
          var cx = Data.parseChex(inp.value), q = document.querySelector('input[name="f_size"]:checked').value === "Q";
          if(cx.years.indexOf(y) < 0) cx.years.unshift(y);
          cx.quarts = cx.quarts.filter(function(x){ return x !== y; });
          if(q) cx.quarts.push(y);
          cx.years.sort(function(a, c){ return c - a; });
          inp.value = Data.chexText({ chexYears: cx.years, chexQuarts: cx.quarts });
        }
        else inp.value = Data.yearsText(Data.addYear(Data.parseYears(inp.value), y));
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

  // "30 gallons, 15 quarts"
  function chexTotals(list){
    var q = list.filter(function(r){ return r.chexSize === "Q"; }).length, g = list.length - q;
    return [g ? g + " " + Data.sizeName("G", true, g) : "", q ? q + " " + Data.sizeName("Q", true, q) : ""].filter(Boolean).join(", ") || "none";
  }
  function printChex(){
    var list = picked("chex");
    if(!list.length){ ask("Nothing to print", "Nobody has \"Chex\" ticked."); return; }
    printPage("<h1>Chex Mix " + Data.seasonYear() + "</h1>" +
      '<p class="sub">' + list.length + " families · " + chexTotals(list) + "</p>" +
      '<div class="checklist">' + list.map(function(r){
        return "<div><i></i><span>" + esc(Data.fullName(r)) + " <b>(" + (r.chexSize === "Q" ? "Q" : "G") + ")</b></span></div>";
      }).join("") + "</div>");
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
          '<td class="t">' + (r.card ? "✓" : "") + '</td><td class="t">' + (r.chex ? "✓ (" + (r.chexSize === "Q" ? "Q" : "G") + ")" : "") + "</td>" +
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
  // adds the year for everyone ticked; says how many were changed
  function markYear(what, y){
    var field = what === "card" ? "sent" : "chexYears", n = 0;
    picked(what).forEach(function(r){
      if(r[field].indexOf(y) >= 0) return;
      r[field] = Data.addYear(r[field], y);
      if(what === "chex" && r.chexSize === "Q") r.chexQuarts = (r.chexQuarts || []).concat([y]);
      stamp(r); n++;
    });
    if(n) changed();
    return n;
  }
  function wireYear(){
    $("yearForm").addEventListener("submit", function(e){
      e.preventDefault();
      var y = parseInt($("y_year").value, 10);
      if(!(y >= 1980 && y <= new Date().getFullYear() + 1)){ toast("Enter a year like " + Data.seasonYear() + "."); return; }
      var what = document.querySelector('input[name="y_what"]:checked').value;
      var n = markYear(what, y);
      $("yearDlg").close();
      toast(n ? "Added " + y + " to " + n + " families." : "Everyone ticked already has " + y + ".");
    });
  }

  // ---------------- this Christmas ----------------
  function xmasHtml(){
    var y = Data.seasonYear(), cards = picked("card"), chex = picked("chex");
    var sent = cards.filter(function(r){ return r.sent.indexOf(y) >= 0; }).length;
    var given = chex.filter(function(r){ return r.chexYears.indexOf(y) >= 0; }).length;
    var got = live().filter(function(r){ return r.recvd.indexOf(y) >= 0; }).length;
    function meter(a, b){ return '<div class="meter"><i style="width:' + (b ? Math.round(100 * a / b) : 0) + '%"></i></div>'; }
    return '<div class="xmas"><h2>Christmas ' + y + "</h2>" +
      '<div class="job r"><h3>Cards</h3><p>' + cards.length + " families ticked · " + sent + " marked sent for " + y + "</p>" + meter(sent, cards.length) +
        '<div class="btns"><button class="btn" data-x="labels">Save address labels</button>' +
        '<button class="btn" data-x="mark-card"' + (sent >= cards.length ? " disabled" : "") + ">Mark " + y + " as sent</button></div></div>" +
      '<div class="job g"><h3>Chex</h3><p>' + chex.length + " families ticked (" + chexTotals(chex) + ") · " + given + " marked given for " + y + "</p>" + meter(given, chex.length) +
        '<div class="btns"><button class="btn" data-x="print-chex">Print the checklist</button>' +
        '<button class="btn" data-x="mark-chex"' + (given >= chex.length ? " disabled" : "") + ">Mark " + y + " as given</button></div></div>" +
      '<div class="job"><h3>Cards received</h3><p style="margin:0">' + got + " so far for " + y + ". To log one, open the family, choose Edit, and use the + " + y + " button beside Years received.</p></div>" +
      "</div>";
  }
  function openXmas(){ $("xmasBody").innerHTML = xmasHtml(); $("xmasDlg").showModal(); }
  function wireXmas(){
    $("xmasBody").addEventListener("click", function(e){
      var b = e.target.closest("[data-x]"); if(!b) return;
      var x = b.dataset.x, y = Data.seasonYear();
      if(x === "labels") exportLabels("card", "christmas-cards-" + y + ".csv", "Christmas card");
      else if(x === "print-chex") printChex();
      else{
        var what = x === "mark-card" ? "card" : "chex", n = picked(what).length;
        ask("Mark " + y + (what === "card" ? " as sent?" : " as given?"),
          "Adds " + y + (what === "card" ? " to Years sent for the " + n + " families with Christmas card ticked." : " to Years Chex given for the " + n + " families with Chex ticked."),
          { ok: "Mark " + y, cancel: true }).then(function(yes){
          if(!yes) return;
          var done = markYear(what, y);
          $("xmasBody").innerHTML = xmasHtml();
          toast("Added " + y + " to " + done + " families.");
        });
      }
    });
  }

  // ---------------- import, backup, restore ----------------
  function importXmlText(text){
    var res = Data.importXml(text), added = 0, here = 0, gone = 0;
    res.records.forEach(function(r){
      var mine = recs[r.id];
      if(!mine){ recs[r.id] = Data.norm(r); added++; }
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
          b.chexSize = r.chexSize === "Q" ? "Q" : "G";
          b.chexQuarts = Array.isArray(r.chexQuarts) ? r.chexQuarts.filter(function(x){ return b.chexYears.indexOf(x) >= 0; }) : [];
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
    $("xmasBtn").onclick = openXmas;
    $("xmasLabel").textContent = "Christmas " + Data.seasonYear();
    function menuLabels(){
      $("menuSnow").textContent = Festive.isOn("snow") ? "on · tap to turn off" : "off · tap to turn on";
    }
    $("menuBtn").onclick = function(){ menuLabels(); $("menuDlg").showModal(); };
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
      if(row && recs[row.dataset.id]) showDetail(recs[row.dataset.id]);
    }
    $("cards").addEventListener("click", rowClick);
    $("rows").addEventListener("click", rowClick);
    $("rows").addEventListener("dblclick", function(e){               // as in the Windows program
      var row = e.target.closest("[data-id]");
      if(row && recs[row.dataset.id]) openEdit(recs[row.dataset.id]);
    });
    $("panel").addEventListener("click", function(e){ detailClick(e, selId); });
    $("detailBody").addEventListener("click", function(e){ detailClick(e, detailId); });

    // the A-Z strip: tap or slide to jump to a letter
    function azJump(e){
      var box = $("az").getBoundingClientRect();
      var el = document.elementFromPoint(box.left + box.width / 2, e.clientY);
      var L = el && el.dataset && el.dataset.l;
      var first = L && document.querySelector('#cards li[data-first="' + L + '"]');
      if(first) first.scrollIntoView({ block: "start" });
    }
    $("az").addEventListener("pointerdown", function(e){ $("az").setPointerCapture(e.pointerId); azJump(e); });
    $("az").addEventListener("pointermove", function(e){ if(e.buttons || e.pointerType === "touch") azJump(e); });

    // computers: the short table with the side panel, or every column
    function cols(){
      document.body.classList.toggle("allcols", allCols);
      $("colsBtn").classList.toggle("on", allCols);
    }
    cols();
    $("colsBtn").onclick = function(){
      allCols = !allCols;
      try{ localStorage.setItem("allcols", allCols ? "1" : "0"); }catch(e){}
      cols(); render(); layout();
    };

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
      else if(a === "xmas") openXmas();
      else if(a === "toggle-snow"){
        Festive.set("snow", !Festive.isOn("snow"));
        if(Festive.isOn("snow")) Festive.snow();
        toast(Festive.isOn("snow") ? "Snow will fall when the app opens." : "No snow on opening, on this device.");
      }

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

    wireEdit(); wireYear(); wireXmas(); wireSync();
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

  function snow(){
    if(new Date().getMonth() !== 11 && location.search.indexOf("snow") < 0) return;
    var h = "";
    for(var i = 0; i < 16; i++){
      h += '<i style="left:' + (i * 6.4 + Math.random() * 4).toFixed(1) + "%;animation-duration:" + (6 + Math.random() * 7).toFixed(1) +
        "s;animation-delay:-" + (Math.random() * 12).toFixed(1) + 's"></i>';
    }
    $("snow").innerHTML = h; $("snow").hidden = false;
  }

  function start(){
    wire(); layout(); snow(); Festive.open();
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
