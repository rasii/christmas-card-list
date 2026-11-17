// A little Christmas when the app opens: snow falling down the screen.
//
// It can also play the first few seconds of a carol, picked at random, but
// that is switched off for now (MUSIC below); the menu has no entry for it.
//
// The carols are old enough to belong to everyone, and are played here from
// their notes with a bell-like tone the browser makes itself, so there are
// no recordings or sound files.
//
// Browsers (iPhones especially) don't let a page make sound until it has
// been touched, so when the music can't start on opening it starts at the
// first tap instead, if that comes soon. Each can be turned off in the menu;
// the choice is kept on the device ("snow" and "music" in localStorage).
window.Festive = (function(){
  "use strict";

  // [name, beats a minute, "note:beats note:beats ..."]
  var CAROLS = [
    ["Jingle Bells", 210, "E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:.5 E4:4 F4:1 F4:1 F4:1.5 F4:.5 F4:1 E4:1 E4:1 E4:.5 E4:.5 E4:1 D4:1 D4:1 E4:1 D4:2 G4:2"],
    ["Deck the Halls", 170, "G4:1.5 F4:.5 E4:1 D4:1 C4:1 D4:1 E4:1 C4:1 D4:.5 E4:.5 F4:.5 D4:.5 E4:1.5 D4:.5 C4:1 B3:1 C4:2"],
    ["Joy to the World", 150, "C5:2 B4:1.5 A4:.5 G4:3 F4:1 E4:2 D4:2 C4:3 G4:1 A4:3 A4:1 B4:3 B4:1 C5:3"],
    ["Silent Night", 100, "G4:1.5 A4:.5 G4:1 E4:3 G4:1.5 A4:.5 G4:1 E4:3 D5:2 D5:1 B4:3 C5:2 C5:1 G4:3"],
    ["We Wish You a Merry Christmas", 170, "D4:1 G4:1 G4:.5 A4:.5 G4:.5 F#4:.5 E4:1 E4:1 E4:1 A4:1 A4:.5 B4:.5 A4:.5 G4:.5 F#4:1 D4:1 D4:1 B4:1 B4:.5 C5:.5 B4:.5 A4:.5 G4:1 E4:1 D4:.5 D4:.5 E4:1 A4:1 F#4:1 G4:2"],
    ["O Christmas Tree", 110, "C4:1 F4:.75 F4:.25 F4:1.5 G4:.5 A4:.75 A4:.25 A4:1.5 A4:.5 G4:.5 A4:.5 Bb4:1 E4:1 G4:1 F4:2"],
    ["Hark! The Herald Angels Sing", 140, "D4:1 G4:1 G4:1.5 F#4:.5 G4:1 B4:1 B4:1 A4:1 D5:1 D5:1 D5:1.5 C5:.5 B4:1 A4:1 B4:2"],
    ["The First Noel", 110, "F#4:.5 E4:.5 D4:1.5 E4:.5 F#4:.5 G4:.5 A4:2 B4:.5 C#5:.5 D5:1 C#5:1 B4:1 A4:2 B4:.5 C#5:.5 D5:1 C#5:1 B4:1 A4:1 B4:1 C#5:1 D5:1 A4:1 G4:1 F#4:2"],
    ["O Come, All Ye Faithful", 140, "G4:1 G4:2 D4:1 G4:1 A4:2 D4:2 B4:1 A4:1 B4:1 C5:1 B4:2 A4:2"],
    ["Good King Wenceslas", 180, "G4:1 G4:1 G4:1 A4:1 G4:1 G4:1 D4:2 E4:1 D4:1 E4:1 F#4:1 G4:2 G4:2"]
  ];
  var MUSIC = false;                // the carol on opening: off for now
  var SECONDS = 7;                  // how much of the carol is played
  var TAP_WITHIN = 30000;           // a first tap later than this stays silent

  var ctx = null, last = "";

  function pref(k){ try{ return localStorage.getItem(k) !== "off"; }catch(e){ return true; } }
  function setPref(k, on){ try{ localStorage.setItem(k, on ? "on" : "off"); }catch(e){} }

  // ---------------- the music ----------------
  var STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function freq(name){
    var m = /^([A-G])([#b]?)(\d)$/.exec(name);
    var n = STEP[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12 * (+m[3] + 1);
    return 440 * Math.pow(2, (n - 69) / 12);
  }
  function bell(f, at, len){
    var ring = Math.max(len * 1.7, 0.9);
    [[f, "triangle", 0.2], [f * 2, "sine", 0.06], [f * 3, "sine", 0.02]].forEach(function(p){
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = p[1]; o.frequency.value = p[0];
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(p[2], at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + ring);
      o.connect(g); g.connect(ctx.destination);
      o.start(at); o.stop(at + ring + 0.05);
    });
  }
  function play(carol){
    var beat = 60 / carol[1], t = 0, at = ctx.currentTime + 0.08;
    carol[2].split(" ").forEach(function(n){
      var p = n.split(":"), len = parseFloat(p[1]) * beat;
      if(t < SECONDS) bell(freq(p[0]), at + t, len);
      t += len;
    });
  }
  function pick(){
    try{ last = localStorage.getItem("carol") || ""; }catch(e){}
    var c;
    do{ c = CAROLS[Math.floor(Math.random() * CAROLS.length)]; }while(c[0] === last);
    last = c[0];
    try{ localStorage.setItem("carol", last); }catch(e){}
    return c;
  }
  function audio(){
    var AC = window.AudioContext || window.webkitAudioContext;
    if(!ctx && AC){ try{ ctx = new AC(); }catch(e){} }
    return ctx;
  }
  // plays one carol now if sound is allowed, else at the first tap (if soon)
  function music(){
    if(!audio()) return;
    var done = false, opened = Date.now();
    function go(){ if(done || ctx.state !== "running") return; done = true; stop(); play(pick()); }
    function tap(){
      if(Date.now() - opened > TAP_WITHIN){ stop(); return; }
      ctx.resume().then(go, function(){});
    }
    function stop(){ window.removeEventListener("pointerdown", tap, true); window.removeEventListener("keydown", tap, true); }
    window.addEventListener("pointerdown", tap, true);
    window.addEventListener("keydown", tap, true);
    if(ctx.state === "running") go();
    else ctx.resume().then(go, function(){});
  }
  // from a button in the app: a tap is already happening, so it can play now
  function playNow(){
    if(!audio()) return;
    ctx.resume().then(function(){ play(pick()); }, function(){});
  }

  // ---------------- the snow ----------------
  function snow(){
    if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var old = document.getElementById("snowfall"); if(old) old.remove();
    var box = document.createElement("div"), h = "", n = Math.min(60, Math.round(window.innerWidth / 20) + 24);
    box.id = "snowfall"; box.setAttribute("aria-hidden", "true");
    for(var i = 0; i < n; i++){
      var size = (14 + Math.random() * 16).toFixed(1), dur = (10 + Math.random() * 7).toFixed(2);
      h += '<i style="left:' + (Math.random() * 100).toFixed(1) + "%;width:" + size + "px;height:" + size + "px;opacity:" + (0.75 + Math.random() * 0.25).toFixed(2) +
        ";animation-duration:" + dur + "s;animation-delay:" + (Math.random() * 6).toFixed(2) + "s;--drift:" + (Math.random() * 120 - 60).toFixed(0) + "px;--spin:" + (Math.random() * 360 - 180).toFixed(0) + 'deg"></i>';
    }
    box.innerHTML = h;
    document.body.appendChild(box);
    setTimeout(function(){ box.remove(); }, 24000);
  }

  // ---------------- on opening ----------------
  function open(){
    if(pref("snow")) snow();
    if(MUSIC && pref("music")) music();
  }
  // again when the app is brought back after a good while away
  var away = 0;
  document.addEventListener("visibilitychange", function(){
    if(document.hidden){ away = Date.now(); return; }
    if(away && Date.now() - away > 30 * 60000) open();
  });

  return {
    open: open, snow: snow, playNow: playNow,
    isOn: pref,
    set: setPref,
    count: CAROLS.length
  };
})();
