// The list's data: what a family record looks like, and the plain functions
// that work on records (no screen code here).
//
// A record:
//   id        made once, never changes
//   t         when it was last changed (ms); the newer copy wins when syncing
//   del       true = deleted (only id, t and del are kept)
//   last, first, kids
//   street, city, state, zip
//   home, cell
//   addrUpdated   "YYYY-MM-DD" or ""
//   sent, recvd, chexYears   years, newest first
//   card, chex, announce     the three "send" checkboxes
window.Data = (function(){
  "use strict";

  var TEXT = ["last", "first", "kids", "street", "city", "state", "zip", "home", "cell", "addrUpdated"];
  var YEARS = ["sent", "recvd", "chexYears"];
  var FLAGS = ["card", "chex", "announce"];

  function blank(){
    var r = { id: newId(), t: 0 };
    TEXT.forEach(function(k){ r[k] = ""; });
    YEARS.forEach(function(k){ r[k] = []; });
    FLAGS.forEach(function(k){ r[k] = false; });
    return r;
  }

  function newId(){
    var b = new Uint8Array(9); crypto.getRandomValues(b);
    return "f" + Array.from(b).map(function(x){ return x.toString(36).padStart(2, "0"); }).join("");
  }

  // "2024, 2022,2023" -> [2024, 2023, 2022]
  function parseYears(s){
    var seen = {}, out = [];
    String(s || "").split(/[^0-9]+/).forEach(function(p){
      var n = parseInt(p, 10);
      if(n && !seen[n]){ seen[n] = 1; out.push(n); }
    });
    return out.sort(function(a, b){ return b - a; });
  }
  function yearsText(a){ return (a || []).join(", "); }
  function yearsShort(a, n){
    a = a || [];
    return a.length <= n ? a.join(", ") : a.slice(0, n).join(", ") + " +" + (a.length - n);
  }
  function addYear(a, y){ return parseYears((a || []).concat([y]).join(",")); }

  // The Christmas the list is being worked on: cards are still being logged
  // in January and February, so those months count as the year before.
  function seasonYear(now){
    var d = new Date((now || Date.now()) - 60 * 86400000);
    return d.getFullYear();
  }

  function fullName(r){
    if(r.last && r.first) return r.last + ", " + r.first;
    return r.last || r.first || "(no name)";
  }
  function mailName(r){ return [r.first, r.last].filter(Boolean).join(" "); }
  function cityLine(r){
    var s = r.city || "";
    if(r.city && (r.state || r.zip)) s += ", ";
    return (s + [r.state, r.zip].filter(Boolean).join(" ")).trim();
  }
  function fullAddress(r){ return [r.street, cityLine(r)].filter(Boolean).join(", "); }

  function today(){
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function showDate(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? (+m[2]) + "/" + (+m[3]) + "/" + m[1] : (iso || "");
  }

  function byName(a, b){
    return (a.last || "").localeCompare(b.last || "", undefined, { sensitivity: "base" }) ||
           (a.first || "").localeCompare(b.first || "", undefined, { sensitivity: "base" });
  }

  // ---------------- the old program's file ----------------
  function hash(s){
    var h = 0x811c9dc5;
    for(var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  // "12/21/22" -> "2022-12-21"
  function oldDate(s){
    var m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s*$/.exec(s || "");
    if(!m) return null;
    var y = +m[3];
    if(m[3].length === 2) y += y < 70 ? 2000 : 1900;
    return y + "-" + String(+m[1]).padStart(2, "0") + "-" + String(+m[2]).padStart(2, "0");
  }

  // The XML written by the Windows program. Returns {records, warnings}.
  // Ids are made from the name and address, so importing the same file
  // twice (or on two devices) gives the same families, not copies.
  function importXml(text){
    var doc = new DOMParser().parseFromString(text, "application/xml");
    if(doc.getElementsByTagName("parsererror").length) throw new Error("That file isn't readable XML.");
    var root = doc.documentElement;
    if(!root || root.nodeName !== "address_book") throw new Error("That isn't a Christmas Card List file.");
    var maxYear = new Date().getFullYear() + 1;
    var records = [], warnings = [], used = {};

    function child(node, name){
      for(var c = node.firstElementChild; c; c = c.nextElementSibling) if(c.nodeName === name) return c;
      return null;
    }
    function attr(node, name){ return node ? (node.getAttribute(name) || "").trim() : ""; }
    function years(node, name){
      var box = child(node, name), s = [];
      if(box) for(var c = box.firstElementChild; c; c = c.nextElementSibling) if(c.nodeName === "year") s.push(attr(c, "value"));
      return parseYears(s.join(","));
    }

    for(var n = root.firstElementChild; n; n = n.nextElementSibling){
      if(n.nodeName !== "name") continue;
      var phone = child(n, "phone"), addr = child(n, "address");
      var r = {
        id: "", t: 1,
        last: attr(n, "lastName"), first: attr(n, "firstName"), kids: attr(n, "kidsNames"),
        street: attr(addr, "street"), city: attr(addr, "city"), state: attr(addr, "state"), zip: attr(addr, "zipCode"),
        home: attr(phone, "home"), cell: attr(phone, "cell"),
        addrUpdated: "",
        sent: years(n, "yearsSent"), recvd: years(n, "yearsReceived"), chexYears: years(n, "yearsChex"),
        card: !!parseInt(attr(n, "sendChristmasCard"), 10),
        chex: !!parseInt(attr(n, "giveChex"), 10),
        announce: !!parseInt(attr(n, "sendAnnouncement"), 10)
      };
      var key = hash([r.last, r.first, r.street, r.zip].join("|").toLowerCase());
      used[key] = (used[key] || 0) + 1;
      r.id = "x" + key + (used[key] > 1 ? "-" + used[key] : "");

      var raw = attr(n, "dateAddressUpdated");
      if(raw){
        var iso = oldDate(raw);
        if(iso) r.addrUpdated = iso;
        else { r.addrUpdated = raw; warnings.push(fullName(r) + ": address-updated date \"" + raw + "\" kept as written"); }
      }
      [["sent", "Years Sent"], ["recvd", "Years Received"], ["chexYears", "Years Chex"]].forEach(function(p){
        r[p[0]].forEach(function(y){
          if(y < 1980 || y > maxYear) warnings.push(fullName(r) + ": " + p[1] + " has \"" + y + "\"");
        });
      });
      records.push(r);
    }
    return { records: records, warnings: warnings };
  }

  // ---------------- exports ----------------
  function csvCell(v){
    v = String(v == null ? "" : v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function csv(rows){
    var s = rows.map(function(row){ return row.map(csvCell).join(","); }).join("\r\n") + "\r\n";
    // tell Word and Excel it's UTF-8, but only when it matters
    return (/[^\x00-\x7f]/.test(s) ? "﻿" : "") + s;
  }
  // the mail-merge file: the same columns the Windows program wrote
  function labelsCsv(list){
    return csv([["FirstName", "LastName", "Address", "City", "State", "Zip"]].concat(
      list.map(function(r){ return [r.first, r.last, r.street, r.city, r.state, r.zip]; })));
  }

  // ---------------- syncing ----------------
  function valid(r){ return r && typeof r === "object" && typeof r.id === "string" && r.id && typeof r.t === "number"; }

  // Two copies of the list -> one. Each family is taken from whichever copy
  // changed it last; a deleted family stays deleted unless edited later.
  // Says which side is now behind.
  function merge(local, remote){
    var map = {}, L = {}, R = {}, localBehind = false, remoteBehind = false;
    local.forEach(function(r){ if(valid(r)){ L[r.id] = r; map[r.id] = r; } });
    remote.forEach(function(r){
      if(!valid(r)) return;
      R[r.id] = r;
      var mine = L[r.id];
      if(!mine || r.t > mine.t){ map[r.id] = r; localBehind = true; }
    });
    Object.keys(L).forEach(function(id){ if(!R[id] || L[id].t > R[id].t) remoteBehind = true; });
    return { records: Object.keys(map).map(function(id){ return map[id]; }), localBehind: localBehind, remoteBehind: remoteBehind };
  }

  return {
    TEXT: TEXT, YEARS: YEARS, FLAGS: FLAGS,
    blank: blank, newId: newId,
    parseYears: parseYears, yearsText: yearsText, yearsShort: yearsShort, addYear: addYear, seasonYear: seasonYear,
    fullName: fullName, mailName: mailName, cityLine: cityLine, fullAddress: fullAddress,
    today: today, showDate: showDate, byName: byName,
    importXml: importXml, csv: csv, labelsCsv: labelsCsv, merge: merge
  };
})();
