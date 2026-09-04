/* ============================================================
   PLANKSLAM - game core
   Shared by the standalone build (index.html) and the Capacitor
   build (app/www/index.html). Ad calls are optional: they only
   fire when window.Ads exists (native build).
============================================================ */
(function () {
"use strict";

/* ============================================================
   TUNING
============================================================ */
var HP_BASE = 3, HP_CAP = 5;
var PIPS = 64, TICKS = 48, CX = 110, CY = 110, RAD = 74, TICK_RAD = 95;

/* attack damage */
var DMG = { white: 22, yellow: 10, counter: 14 };
var ABSORB_STORE = 14;    // damage banked when ABSORB procs
var ABSORB_WHITE = 1.2;   // banked damage bonus if next attack hits white
var SPECIAL_HITS = 4;     // spins in one special attack
var SPECIAL_ALL_WHITE = 2;// damage multiplier if every special spin is white
var SPECIAL_OFFER_HOLD = 1.2; // seconds the dial freezes so you can choose to unleash
var BURN_PCT = 0.05;      // burning: % of max HP the foe loses whenever he swings
var CHILL_SPINS = 2;      // how many spins a chill proc slows
var CHILL_SPEED = 0.62;   // speed multiplier while chilled
var WHITE_PROC_BONUS = 10;// +10 percentage points to glove proc odds on a white hit

/* special charge gains */
var CHARGE = { white: 15, yellow: 10, counter: 15, block: 10, taken: 5 };

var C = { pitch: 0x17131f, plank: 0xb4813f, plankDark: 0x6b4a22, lapis: 0x4668e8,
          redstone: 0xe0453a, torch: 0xffc244, bone: 0xf2ede1 };

/* Stakes: coin payout and entry fee only. Difficulty comes from
   curveFor(level) below, so these carry no speed/zone/hp - change the
   CURVE_* constants for difficulty.
   fee is charged PER OPPONENT LEVEL, so the gamble keeps its bite deep
   into a run. Keep fee below reward*6 or the stake stops being worth
   taking as levels climb (the win payout grows by reward*6 per level). */
var DIFFS = [
  { key: "COPPER", reward: 1.0, fee: 0 },
  { key: "SILVER", reward: 1.9, fee: 9 },
  { key: "GOLD",   reward: 3.4, fee: 16 }
];
function entryFee(lvl) { return Math.round(DIFFS[RUN.diff].fee * lvl); }

/* Shop is deliberately tiny now - coins are for chests. */
var UPGRADES = [
  { k: "hearts", name: "HEART SLOTS", desc: "One more heart to lose", max: 2, costs: [1500, 2000] },
  { k: "grip",   name: "GRIP",        desc: "Widens the gold arc a little", max: 1, costs: [3000] }
];
var GRIP_BONUS = 0.06;

/* ------------------------------------------------------------
   ENDLESS SCALING
   Difficulty follows the opponent number rather than a fixed tier:
   it steps every 5 opponents from the ROOKIE feel up to the
   BONECRUSHER feel at opponent 30, then creeps every 10 levels.
   Player damage and enemy health both ride POWER so a fight stays
   roughly the same number of rounds however deep you get - the
   challenge comes from the shrinking window, not longer fights.
------------------------------------------------------------ */
var CURVE_START = { speed: 0.85, zone: 1.16, hp: 0 };
var CURVE_END   = { speed: 1.22, zone: 0.80, hp: 3 };
var CURVE_STEPS = 6;        // 6 steps x 5 opponents = full difficulty at level 30
var CURVE_EVERY = 5;        // one step per this many opponents
var CREEP_EVERY = 10;       // past level 30, one creep step per this many levels
var CREEP_SPEED = 0.04, CREEP_ZONE = 0.02, CREEP_HP = 1;
var ZONE_FLOOR = 0.62;      // never tighten the window past this
var BASE_FOE_HP = 230;      // health of a level 1 opponent
var POWER_PER_LVL = 0.05;   // both your damage and his health grow by this each level

function curveFor(lvl) {
  var t = Math.min(1, Math.floor(lvl / CURVE_EVERY) / CURVE_STEPS);
  var d = {
    speed: CURVE_START.speed + (CURVE_END.speed - CURVE_START.speed) * t,
    zone:  CURVE_START.zone  + (CURVE_END.zone  - CURVE_START.zone)  * t,
    hp:    Math.round(CURVE_START.hp + (CURVE_END.hp - CURVE_START.hp) * t)
  };
  if (lvl > CURVE_EVERY * CURVE_STEPS) {
    var k = Math.floor((lvl - CURVE_EVERY * CURVE_STEPS) / CREEP_EVERY);
    d.speed += CREEP_SPEED * k;
    d.zone   = Math.max(ZONE_FLOOR, d.zone - CREEP_ZONE * k);
    d.hp    += CREEP_HP * k;
  }
  return d;
}
var powerFor = function (lvl) { return 1 + (lvl - 1) * POWER_PER_LVL; };

var FOES = [
  { n: "THE GRUNT",   skin: 0x86a35c, shirt: 0x6f8f45, pants: 0x38292c, hair: 0x2c2118 },
  { n: "THE BRUTE",   skin: 0x86a35c, shirt: 0xc8382f, pants: 0x38292c, hair: 0x2c2118 },
  { n: "IRONJAW",     skin: 0x9aa0a6, shirt: 0x54606e, pants: 0x2f3238, hair: 0x33383e },
  { n: "DEVIANA",      skin: 0x7c5b52, shirt: 0x8e2b22, pants: 0x2b1f1f, hair: 0x1e1614 },
  { n: "THE WARDEN",  skin: 0x8e7ab5, shirt: 0x59357f, pants: 0x2c2140, hair: 0x1d1630 },
  { n: "HUBERT", skin: 0xd0b48a, shirt: 0x1f6f63, pants: 0x243231, hair: 0xe8e2d4 }
];
var ROMAN = ["", "", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
var isBoss = function (lvl) { return lvl % 5 === 0; };

function foeFor(level) {
  var i = (level - 1) % FOES.length, cycle = Math.floor((level - 1) / FOES.length), f = FOES[i];
  return { n: cycle ? f.n + " " + (ROMAN[cycle + 1] || ("+" + cycle)) : f.n,
           skin: f.skin, shirt: f.shirt, pants: f.pants, hair: f.hair };
}

var rnd = function (a, b) { return a + Math.random() * (b - a); };
var rndInt = function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); };
var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };

/* ============================================================
   EQUIPMENT
   Tier roll ranges. "s10" stats cap at 10%, "s20" stats cap at
   20%, matching common = 1%/2% up to legendary = 7-10% / 17-20%.
   "mult" is the flat damage multiplier used by normal gloves.
============================================================ */
var TIERS = ["common", "normal", "rare", "epic", "legendary"];
var TIER = {
  common:    { name: "COMMON",    color: "#9aa0a6", s10: [1, 1],  s20: [1, 2],   mult: [1.05, 1.10] },
  normal:    { name: "NORMAL",    color: "#7fa24f", s10: [2, 3],  s20: [3, 6],   mult: [1.10, 1.20] },
  rare:      { name: "RARE",      color: "#5a7cf0", s10: [3, 5],  s20: [7, 10],  mult: [1.20, 1.30] },
  epic:      { name: "EPIC",      color: "#b06bf5", s10: [5, 7],  s20: [11, 16], mult: [1.30, 1.40] },
  legendary: { name: "LEGENDARY", color: "#ffc244", s10: [7, 10], s20: [17, 20], mult: [1.40, 1.50] }
};

/* Outfit effects only fire when you MISS your guard. */
var OUTFITS = [
  { t: "duelist",    name: "DUELIST WEAVE", stat: "counter", scale: "s10",
    shirt: 0x3f63e0, pants: 0x2a2f45, hair: 0x4a3628,
    eff: function (v) { return v + "% to auto-counter a missed guard"; } },
  { t: "skirmisher", name: "SKIRMISH RAGS", stat: "evade", scale: "s20",
    shirt: 0x1f6f63, pants: 0x243231, hair: 0x3a2f22,
    eff: function (v) { return v + "% to evade a missed guard"; } },
  { t: "bulwark",    name: "BULWARK PLATE", stat: "absorb", scale: "s10",
    shirt: 0x66707d, pants: 0x2f3238, hair: 0x33383e,
    eff: function (v) { return v + "% to absorb a missed guard and bank " + ABSORB_STORE + " dmg"; } }
];

/* Glove effects only fire when you LAND a hit. */
var GLOVES = [
  { t: "cold",  name: "COLD GLOVES",   stat: "chill", scale: "s20",
    eff: function (v) { return v + "% on hit to slow the next spins"; } },
  { t: "hot",   name: "HOT GLOVES",    stat: "burn",  scale: "s20",
    eff: function (v) { return v + "% on hit to set him burning"; } },
  { t: "plain", name: "KEVIN GLOVES", stat: "power", scale: "mult",
    eff: function (v) { return "x" + v.toFixed(2) + " attack damage (no white bonus)"; } }
];

function defOf(kind, type) {
  var list = kind === "outfit" ? OUTFITS : GLOVES;
  for (var i = 0; i < list.length; i++) if (list[i].t === type) return list[i];
  return null;
}
function rollVal(def, tier, atMax) {
  var r = TIER[tier][def.scale];
  if (def.scale === "mult") return atMax ? r[1] : Math.round(rnd(r[0], r[1]) * 100) / 100;
  return atMax ? r[1] : rndInt(r[0], r[1]);
}
var uidSeq = 0;
function makeItem(kind, type, tier, atMax) {
  var def = defOf(kind, type);
  return { uid: kind + ":" + type + ":" + tier + ":" + (uidSeq++), kind: kind, type: type,
           tier: tier, stat: def.stat, val: rollVal(def, tier, atMax) };
}
function itemName(it) { return defOf(it.kind, it.type).name; }
function itemEff(it) { return defOf(it.kind, it.type).eff(it.val); }

/* ============================================================
   RUN STATE
============================================================ */
var SAVE_KEY = "plankslam.run.v2";
var RUN = {
  coins: 0, gems: 0, streak: 0, best: 0, diff: 1,
  up: { hearts: 0, grip: 0 },
  inv: [],
  equip: { outfit: null, gloves: null }
};

/* Testing wardrobe: every outfit and glove, in every tier, at max roll. */
function stockWardrobe() {
  RUN.inv = [];
  OUTFITS.forEach(function (o) { TIERS.forEach(function (t) { RUN.inv.push(makeItem("outfit", o.t, t, true)); }); });
  GLOVES.forEach(function (g) { TIERS.forEach(function (t) { RUN.inv.push(makeItem("gloves", g.t, t, true)); }); });
  RUN.equip.outfit = RUN.inv[0].uid;
  RUN.equip.gloves = RUN.inv.filter(function (i) { return i.kind === "gloves"; })[0].uid;
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(RUN)); } catch (e) {}
}
function load() {
  try {
    var raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    var d = JSON.parse(raw);
    if (!d || !d.inv || !d.inv.length) return false;
    RUN.coins = d.coins || 0; RUN.gems = d.gems || 0;
    RUN.streak = d.streak || 0; RUN.best = d.best || 0;
    RUN.diff = typeof d.diff === "number" ? d.diff : 1;
    RUN.up = { hearts: (d.up && d.up.hearts) || 0, grip: (d.up && d.up.grip) || 0 };
    RUN.inv = d.inv; RUN.equip = d.equip || { outfit: null, gloves: null };
    return true;
  } catch (e) { return false; }
}
if (!load()) stockWardrobe();

var youMaxHP = function () { return Math.min(HP_CAP, HP_BASE + RUN.up.hearts); };
var foeLevel = function () { return RUN.streak + 1; };
function foeMaxHP(lvl) {
  var base = (BASE_FOE_HP + curveFor(lvl).hp * 14) * powerFor(lvl);
  return Math.round(base * (isBoss(lvl) ? 1.6 : 1));
}
function equipped(kind) {
  var uid = RUN.equip[kind];
  for (var i = 0; i < RUN.inv.length; i++) if (RUN.inv[i].uid === uid) return RUN.inv[i];
  return null;
}

/* ============================================================
   AUDIO
============================================================ */
var actx = null;
function ac() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return actx; }
function blip(f, d, t, v, to) {
  var a = ac(); if (!a) return;
  var o = a.createOscillator(), g = a.createGain();
  o.type = t || "square"; o.frequency.setValueAtTime(f, a.currentTime);
  if (to) o.frequency.exponentialRampToValueAtTime(to, a.currentTime + d);
  g.gain.setValueAtTime(v || 0.12, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + d);
  o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + d + 0.02);
}
var SFX = {
  hit: function () { blip(300, .12, "square", .13, 760); },
  perfect: function () { blip(520, .07, "square", .12, 900); setTimeout(function(){blip(780,.09,"square",.11,1180);}, 70); setTimeout(function(){blip(1180,.13,"square",.09);}, 150); },
  whiff: function () { blip(180, .16, "sawtooth", .09, 90); },
  counter: function () { blip(120, .2, "sawtooth", .16, 55); },
  block: function () { blip(220, .1, "square", .12, 160); },
  evade: function () { blip(700, .09, "sine", .1, 1100); },
  absorb: function () { blip(240, .16, "sine", .13, 420); },
  tick: function () { blip(1400, .02, "square", .03); },
  coin: function () { blip(920, .06, "square", .1); setTimeout(function(){blip(1380,.12,"square",.09);}, 60); },
  gem: function () { [660, 990, 1320].forEach(function (f, i) { setTimeout(function(){blip(f,.1,"sine",.1);}, i * 80); }); },
  buy: function () { blip(660, .05, "square", .1); setTimeout(function(){blip(990,.1,"square",.09);}, 50); },
  nope: function () { blip(140, .12, "square", .08); },
  charge: function () { blip(880, .05, "sine", .07, 1240); },
  special: function () { [330, 440, 660, 880, 1320].forEach(function (f, i) { setTimeout(function(){blip(f,.12,"square",.12);}, i * 60); }); },
  burn: function () { blip(200, .14, "sawtooth", .1, 420); },
  win: function () { [440, 660, 880, 1320].forEach(function (f, i) { setTimeout(function(){blip(f,.16,"square",.11);}, i * 110); }); },
  lose: function () { [330, 260, 200, 130].forEach(function (f, i) { setTimeout(function(){blip(f,.22,"sawtooth",.12);}, i * 140); }); }
};

/* ============================================================
   3D SCENE
============================================================ */
var scene = new THREE.Scene();
scene.background = new THREE.Color(C.pitch);
scene.fog = new THREE.Fog(C.pitch, 11, 24);
var camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
var CAM_BASE = new THREE.Vector3(0.9, 4.35, 8.0), CAM_LOOK = new THREE.Vector3(0, 2.05, -0.1);
camera.position.copy(CAM_BASE); camera.lookAt(CAM_LOOK);
var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById("stage").appendChild(renderer.domElement);
function resize() { var w = innerWidth, h = innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); }
addEventListener("resize", resize); resize();

scene.add(new THREE.HemisphereLight(0x6b7fb5, 0x1a1420, 0.62));
var key = new THREE.DirectionalLight(0xfff0d0, 0.95);
key.position.set(4, 9, 6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
scene.add(key);
var torchLight = new THREE.PointLight(0xffc244, 1.5, 9, 2); torchLight.position.set(0, 3.6, 1.0); scene.add(torchLight);
var rim = new THREE.DirectionalLight(0x5f7cff, 0.4); rim.position.set(-6, 3, -6); scene.add(rim);

function box(w, h, d, color) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: color }));
  m.castShadow = true; m.receiveShadow = true; return m;
}
(function makeFloor() {
  var cv = document.createElement("canvas"); cv.width = cv.height = 64;
  var g = cv.getContext("2d");
  g.fillStyle = "#241d30"; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#1c1726"; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  var tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(9, 9);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  var f = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), new THREE.MeshLambertMaterial({ map: tex }));
  f.rotation.x = -Math.PI / 2; f.receiveShadow = true; scene.add(f);
})();
(function makeTable() {
  var t = new THREE.Group();
  var top = box(2.5, .24, 2.1, C.plank); top.position.y = 1.58; t.add(top);
  var trim = box(2.62, .1, 2.22, C.plankDark); trim.position.y = 1.42; t.add(trim);
  [[-1.05, -.85], [1.05, -.85], [-1.05, .85], [1.05, .85]].forEach(function (p) {
    var l = box(.24, 1.46, .24, C.plankDark); l.position.set(p[0], .73, p[1]); t.add(l);
  });
  scene.add(t);
})();

function makeFighter(skin, shirt, pants, hair, scale) {
  var u = 0.11 * (scale || 1), g = new THREE.Group(), parts = [], shirtParts = [], pantsParts = [], hairParts = [];
  var add = function (m) { parts.push(m); return m; };
  var lL = add(box(4 * u, 12 * u, 4 * u, pants)); lL.position.set(-2 * u, 6 * u, 0); pantsParts.push(lL);
  var lR = add(box(4 * u, 12 * u, 4 * u, pants)); lR.position.set(2 * u, 6 * u, 0); pantsParts.push(lR);
  g.add(lL, lR);
  var torso = add(box(8 * u, 12 * u, 4 * u, shirt)); torso.position.y = 18 * u; g.add(torso); shirtParts.push(torso);
  var head = new THREE.Group(); head.position.y = 24 * u;
  var skull = add(box(8 * u, 8 * u, 8 * u, skin)); skull.position.y = 4 * u; head.add(skull);
  var cap = add(box(8.3 * u, 3.2 * u, 8.3 * u, hair)); cap.position.y = 6.6 * u; head.add(cap); hairParts.push(cap);
  var eL = add(box(1.6 * u, 1.6 * u, .4 * u, 0x1b1420)); eL.position.set(-1.8 * u, 4.2 * u, 4.05 * u);
  var eR = add(box(1.6 * u, 1.6 * u, .4 * u, 0x1b1420)); eR.position.set(1.8 * u, 4.2 * u, 4.05 * u);
  head.add(eL, eR); g.add(head);
  function arm(sx) {
    var p = new THREE.Group(); p.position.set(sx * 6 * u, 24 * u, 0);
    var a = add(box(4 * u, 12 * u, 4 * u, shirt)); a.position.y = -5 * u; p.add(a); shirtParts.push(a);
    var h = add(box(4.05 * u, 3 * u, 4.05 * u, skin)); h.position.y = -9.5 * u; p.add(h);
    g.add(p); return p;
  }
  return { group: g, head: head, torso: torso, armL: arm(-1), armR: arm(1), parts: parts,
           shirtParts: shirtParts, pantsParts: pantsParts, hairParts: hairParts,
           u: u, anim: { name: "idle", t: 0 }, wind: 0, bob: Math.random() * 6 };
}
function disposeFighter(f) {
  scene.remove(f.group);
  f.parts.forEach(function (p) { p.geometry.dispose(); p.material.dispose(); });
}
var you = makeFighter(0xd8a06a, 0x3f63e0, 0x2a2f45, 0x4a3628, 1.0);
you.group.position.set(-2.05, 0, 0); you.group.rotation.y = Math.PI / 2; scene.add(you.group);

/* Equipped outfit repaints the player. */
function applyOutfitLook() {
  var it = equipped("outfit");
  var def = it ? defOf("outfit", it.type) : OUTFITS[0];
  you.shirtParts.forEach(function (p) { p.material.color.setHex(def.shirt); });
  you.pantsParts.forEach(function (p) { p.material.color.setHex(def.pants); });
  you.hairParts.forEach(function (p) { p.material.color.setHex(def.hair); });
}
applyOutfitLook();

var foe = null;
function spawnFoe(level) {
  if (foe) disposeFighter(foe);
  var d = foeFor(level), sc = clamp(1.02 + (level - 1) * 0.035, 1.0, 1.34) * (isBoss(level) ? 1.12 : 1);
  foe = makeFighter(d.skin, d.shirt, d.pants, d.hair, sc);
  foe.group.position.set(2.15, 0, 0); foe.group.rotation.y = -Math.PI / 2;
  scene.add(foe.group);
  return d;
}

var debris = [];
function burst(x, y, z, color) {
  for (var i = 0; i < 14; i++) {
    var s = rnd(.05, .12);
    var m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshLambertMaterial({ color: color }));
    m.position.set(x + rnd(-.2, .2), y, z + rnd(-.25, .25));
    m.userData.v = new THREE.Vector3(rnd(-2.4, 2.4), rnd(2.2, 5.2), rnd(-2.4, 2.4));
    m.userData.rv = new THREE.Vector3(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8));
    m.userData.life = .75; scene.add(m); debris.push(m);
  }
}
/* big radial shower for the special attack - a ring blown outward plus an
   upward spray, in the torch/bone/redstone palette, with a light flash */
var specialLight = new THREE.PointLight(0xffc244, 0, 14, 2);
specialLight.position.set(0.4, 2.1, 0);
scene.add(specialLight);

function specialBurst(x, y, z) {
  var cols = [C.torch, 0xfff3cf, C.redstone, C.bone];
  var i, m, s, a, sp;
  for (i = 0; i < 44; i++) {                       /* ring blown outward */
    a = (i / 44) * Math.PI * 2 + rnd(-0.12, 0.12);
    sp = rnd(3.0, 6.6);
    s = rnd(.06, .17);
    m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshLambertMaterial({ color: cols[i % cols.length] }));
    m.position.set(x + rnd(-.15, .15), y + rnd(-.2, .2), z + rnd(-.15, .15));
    m.userData.v = new THREE.Vector3(Math.cos(a) * sp, rnd(1.4, 4.2), Math.sin(a) * sp * 0.55);
    m.userData.rv = new THREE.Vector3(rnd(-15, 15), rnd(-15, 15), rnd(-15, 15));
    m.userData.life = rnd(.85, 1.4);
    scene.add(m); debris.push(m);
  }
  for (i = 0; i < 18; i++) {                       /* fountain straight up */
    s = rnd(.05, .12);
    m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshLambertMaterial({ color: cols[i % 2] }));
    m.position.set(x + rnd(-.3, .3), y, z + rnd(-.3, .3));
    m.userData.v = new THREE.Vector3(rnd(-1.2, 1.2), rnd(5.5, 8.5), rnd(-1.2, 1.2));
    m.userData.rv = new THREE.Vector3(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12));
    m.userData.life = rnd(1.0, 1.6);
    scene.add(m); debris.push(m);
  }
  specialLight.position.set(x, y, z);
  specialLight.intensity = 7;                      /* decays in the frame loop */
}

function stepDebris(dt) {
  if (specialLight.intensity > 0) specialLight.intensity = Math.max(0, specialLight.intensity - dt * 9);
  for (var i = debris.length - 1; i >= 0; i--) {
    var d = debris[i]; d.userData.life -= dt;
    if (d.userData.life <= 0) { scene.remove(d); d.geometry.dispose(); d.material.dispose(); debris.splice(i, 1); continue; }
    d.userData.v.y -= 13 * dt; d.position.addScaledVector(d.userData.v, dt);
    d.rotation.x += d.userData.rv.x * dt; d.rotation.y += d.userData.rv.y * dt;
    if (d.position.y < .05) { d.position.y = .05; d.userData.v.y *= -.36; d.userData.v.multiplyScalar(.7); }
  }
}
function setAnim(f, n) { if (f) { f.anim.name = n; f.anim.t = 0; } }
function tintHurt(f, a) { var c = new THREE.Color(0xff3320); f.parts.forEach(function (p) { p.material.emissive.setRGB(c.r * a, c.g * a, c.b * a); }); }
function tintBurn(f, a) { var c = new THREE.Color(0xff7a1a); f.parts.forEach(function (p) { p.material.emissive.setRGB(c.r * a, c.g * a, c.b * a); }); }

function animFighter(f, dt) {
  if (!f) return;
  var a = f.anim, u = f.u; a.t += dt; f.bob += dt;
  f.group.rotation.x = 0; f.armL.rotation.set(0, 0, 0); f.armR.rotation.set(0, 0, 0); f.head.rotation.set(0, 0, 0);
  var lean = function (v) { f.group.rotation.x = -v; };
  if (a.name === "idle") {
    var b = Math.sin(f.bob * 2.1) * .03;
    f.torso.position.y = 18 * u + b * .4; f.head.position.y = 24 * u + b * .4;
    f.armL.rotation.x = Math.sin(f.bob * 2.1) * .09; f.armR.rotation.x = -Math.sin(f.bob * 2.1) * .09;
    f.armL.rotation.z = .06; f.armR.rotation.z = -.06;
  } else if (a.name === "windup") {
    /* telegraph: arm coils back further the longer the dial runs, then trembles */
    var w = ease(clamp(f.wind, 0, 1));
    f.armR.rotation.x = -2.45 * w;
    f.armL.rotation.x = -0.35 * w;
    lean(-0.05 - 0.17 * w);
    f.head.rotation.x = -0.14 * w;
    if (w > 0.72) {
      var j = Math.sin(a.t * 42) * 0.045 * (w - 0.72) / 0.28;
      f.armR.rotation.z = j; f.group.rotation.z = j * 0.35;
    } else { f.group.rotation.z = 0; }
    f.torso.position.y = 18 * u; f.head.position.y = 24 * u;
  } else if (a.name === "guard") {
    /* bracing pose while the foe winds up on you */
    var gp = 0.55 + Math.sin(f.bob * 6) * 0.05;
    f.armL.rotation.x = -1.5 * gp; f.armR.rotation.x = -1.35 * gp;
    f.armL.rotation.z = .34; f.armR.rotation.z = -.34;
    lean(0.1);
  } else if (a.name === "slam") {
    var t = clamp(a.t / .5, 0, 1);
    if (t < .3) { var k = t / .3; f.armR.rotation.x = -2.5 * ease(k); lean(-.13 * ease(k)); }
    else if (t < .46) { var k2 = (t - .3) / .16; f.armR.rotation.x = -2.5 + 3.5 * k2; lean(-.13 + .5 * k2); }
    else { var k3 = (t - .46) / .54; f.armR.rotation.x = 1 - ease(k3); lean(.37 * (1 - ease(k3))); }
    if (t >= 1) setAnim(f, "idle");
  } else if (a.name === "hurt") {
    var th = clamp(a.t / .55, 0, 1), p = Math.sin(th * Math.PI);
    lean(.42 * p); f.head.rotation.x = .5 * p; f.armL.rotation.x = .7 * p; f.armR.rotation.x = .7 * p;
    tintHurt(f, .55 * (1 - th));
    if (th >= 1) { tintHurt(f, 0); setAnim(f, "idle"); }
  } else if (a.name === "evade") {
    var te = clamp(a.t / .5, 0, 1), pe = Math.sin(te * Math.PI);
    f.group.position.z = 0.55 * pe; f.group.rotation.z = 0.3 * pe;
    if (te >= 1) { f.group.position.z = 0; setAnim(f, "idle"); }
  } else if (a.name === "down") {
    var td = clamp(a.t / .9, 0, 1);
    f.group.rotation.x = -1.35 * ease(td); f.group.position.y = -.25 * ease(td);
    f.armL.rotation.x = -1.1 * ease(td); f.armR.rotation.x = -1.1 * ease(td);
  }
}

/* ============================================================
   DIAL
============================================================ */
var NS = "http://www.w3.org/2000/svg";
var svg = document.getElementById("dial"), pipEls = [], tickEls = [];
function el(tag, at) { var n = document.createElementNS(NS, tag); for (var k in at) n.setAttribute(k, at[k]); return n; }
(function buildDial() {
  for (var i = 0; i < TICKS; i++) {
    var r = el("rect", { x: CX - 1.6, y: CY - TICK_RAD - 3, width: 3.2, height: 6,
      transform: "rotate(" + (i * (360 / TICKS)) + " " + CX + " " + CY + ")", fill: "#b4813f", opacity: ".5" });
    svg.appendChild(r); tickEls.push(r);
  }
  for (var j = 0; j < PIPS; j++) {
    var p = el("rect", { x: CX - 3.5, y: CY - RAD - 5, width: 7, height: 10, rx: 1,
      transform: "rotate(" + (j * (360 / PIPS)) + " " + CX + " " + CY + ")", fill: "#3a2f22" });
    svg.appendChild(p); pipEls.push(p);
  }
  var mk = el("g", { id: "marker" });
  mk.appendChild(el("rect", { x: CX - 8, y: CY - RAD - 11, width: 16, height: 22, rx: 1, fill: "#f2ede1" }));
  mk.appendChild(el("rect", { x: CX - 4.5, y: CY - RAD - 7.5, width: 9, height: 15, rx: 1, fill: "#17131f" }));
  svg.appendChild(mk);
  svg.appendChild(el("text", { id: "hub-r", x: CX, y: CY + 4, "text-anchor": "middle", "class": "hub-round" }));
  svg.appendChild(el("text", { id: "hub-l", x: CX, y: CY + 22, "text-anchor": "middle", "class": "hub-label" })).textContent = "ROUND";
})();
var markerEl = document.getElementById("marker"), hubR = document.getElementById("hub-r"), hubL = document.getElementById("hub-l");
function angDiff(a, b) { var d = (a - b) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; }
var LIVE = { attack: 1, defend: 1, special: 1 };
function drawDial() {
  var step = 360 / PIPS, half = G.zone / 2, ph = G.perfect / 2;
  var live = !!LIVE[G.phase] || G.phase === "resolve";
  for (var i = 0; i < PIPS; i++) {
    var d = Math.abs(angDiff(i * step, G.zoneCenter)), r = pipEls[i];
    if (!live || d > half) { r.setAttribute("fill", "#3a2f22"); r.setAttribute("width", 7); r.setAttribute("x", CX - 3.5); r.setAttribute("height", 10); r.setAttribute("y", CY - RAD - 5); }
    else if (d <= ph) { r.setAttribute("fill", "#f2ede1"); r.setAttribute("width", 9); r.setAttribute("x", CX - 4.5); r.setAttribute("height", 17); r.setAttribute("y", CY - RAD - 8.5); }
    else { r.setAttribute("fill", "#ffc244"); r.setAttribute("width", 8); r.setAttribute("x", CX - 4); r.setAttribute("height", 14); r.setAttribute("y", CY - RAD - 7); }
  }
  var left = G.maxTravel > 0 ? clamp(1 - G.travel / G.maxTravel, 0, 1) : 1, lit = Math.ceil(left * TICKS);
  for (var k = 0; k < TICKS; k++) {
    var on = !!LIVE[G.phase] && k < lit;
    tickEls[k].setAttribute("opacity", on ? (left < .28 ? ".95" : ".42") : ".06");
    tickEls[k].setAttribute("fill", left < .28 ? "#e0453a" : (G.chill > 0 ? "#8fd8ff" : "#b4813f"));
  }
  markerEl.setAttribute("transform", "rotate(" + (Math.round(G.marker / step) * step) + " " + CX + " " + CY + ")");
  markerEl.style.opacity = live ? "1" : "0.15";
}

/* ============================================================
   PIXEL ICONS
============================================================ */
var HEART = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];
var COIN  = ["..OOO..", ".OIIIO.", "OIIIIIO", "OIIIIIO", "OIIIIIO", ".OIIIO.", "..OOO.."];
var GEM   = ["..GGG..", ".GLLLG.", "GLLLLLG", ".GLLLG.", "..GLG..", "...G..."];
function gridSVG(grid, map, cls) {
  var s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 " + grid[0].length + " " + grid.length);
  if (cls) s.setAttribute("class", cls);
  grid.forEach(function (row, y) {
    for (var x = 0; x < row.length; x++) { var c = map[row[x]]; if (c) s.appendChild(el("rect", { x: x, y: y, width: 1.02, height: 1.02, fill: c })); }
  });
  return s;
}
var coinIcon = function () { return gridSVG(COIN, { O: "#c9922a", I: "#ffc244" }); };
var gemIcon  = function () { return gridSVG(GEM, { G: "#2f9a92", L: "#5fe3d8" }); };
function renderHearts(node, cur, max, color) {
  node.innerHTML = "";
  for (var i = 0; i < max; i++) {
    var h = gridSVG(HEART, { X: i < cur ? color : "#3a2f22" }, "heart");
    if (i >= cur) h.style.opacity = ".55";
    node.appendChild(h);
  }
}

/* ============================================================
   HUD
============================================================ */
var $ = function (id) { return document.getElementById(id); };
var hpYouEl = $("hp-you"), hpNumEl = $("foe-hp-num"), hpFillEl = $("foe-hp-fill"), statusEl = $("foe-status");
var calloutEl = $("callout"), phaseEl = $("phase-tag");
var spFill = $("sp-fill"), spPct = $("sp-pct"), spTrack = $("sp-track"), spBtn = $("sp-btn");

function renderFoeHP() {
  hpNumEl.innerHTML = Math.max(0, Math.round(G.foeHP)) + '<span class="max"> / ' + G.foeMax + "</span>";
  hpNumEl.classList.remove("pop"); void hpNumEl.offsetWidth; hpNumEl.classList.add("pop");
  hpFillEl.style.width = clamp(G.foeHP / G.foeMax * 100, 0, 100) + "%";
  hpFillEl.classList.toggle("burn", G.burn > 0);
  var tags = [];
  if (G.burn > 0) tags.push('<span class="burn-tag">BURNING</span>');
  if (G.chill > 0) tags.push('<span class="chill-tag">CHILLED ' + G.chill + "</span>");
  statusEl.innerHTML = tags.join(" ");
}
function renderSpecial() {
  spFill.style.width = G.special + "%";
  spPct.textContent = Math.round(G.special) + "%";
  var full = G.special >= 100;
  spTrack.classList.toggle("full", full);
  spBtn.classList.toggle("on", full && (G.phase === "attack" || G.phase === "offer"));
}
function addCharge(n) {
  var was = G.special;
  G.special = clamp(G.special + n, 0, 100);
  if (G.special >= 100 && was < 100) SFX.charge();
  renderSpecial();
}
function callout(t, c) {
  calloutEl.textContent = t; calloutEl.style.color = c;
  calloutEl.classList.remove("show"); void calloutEl.offsetWidth; calloutEl.classList.add("show");
}
function floatDmg(text, color, side) {
  var d = document.createElement("div");
  d.className = "dmg-float"; d.textContent = text; d.style.color = color;
  d.style.left = (side === "foe" ? 72 : 28) + "%";
  d.style.top = "34%";
  document.body.appendChild(d);
  setTimeout(function () { d.remove(); }, 900);
}
function shake(s) {
  G.shake = s;
  var d = $("dial"); d.classList.remove("shake"); void d.offsetWidth; d.classList.add("shake");
  var f = $("flash"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
}
function pop(node, idx) {
  var n = node.children[clamp(idx - 1, 0, node.children.length - 1)];
  if (!n) return; n.classList.add("pop"); setTimeout(function () { n.classList.remove("pop"); }, 130);
}

/* ============================================================
   BATTLE
   phases: menu | attack | defend | special | resolve | over
============================================================ */
var G = {
  phase: "menu", round: 0, lvl: 1, boss: false,
  youHP: 3, youMax: 3, foeHP: 60, foeMax: 60,
  marker: 0, zoneCenter: 0, zone: 64, perfect: 22, speed: 190, travel: 0, maxTravel: 0,
  special: 0, spLeft: 0, spDmg: 0, spAll: true,
  offerT: 0,
  banked: 0, burn: 0, chill: 0,
  hits: 0, perfects: 0, misses: 0, blocks: 0, counters: 0, dealt: 0,
  shake: 0, resolveT: 0, resolveLen: 1.0, after: null
};

function pause(len, fn) { G.phase = "resolve"; G.resolveT = 0; G.resolveLen = len; G.after = fn; }

function beginBattle() {
  var lvl = foeLevel(), d = spawnFoe(lvl);
  G.lvl = lvl; G.boss = isBoss(lvl);
  G.youMax = youMaxHP(); G.youHP = G.youMax;
  G.foeMax = foeMaxHP(lvl); G.foeHP = G.foeMax;
  G.round = 0; G.special = 0; G.banked = 0; G.burn = 0; G.chill = 0;
  G.hits = G.perfects = G.misses = G.blocks = G.counters = G.dealt = 0;
  you.group.rotation.set(0, Math.PI / 2, 0); you.group.position.set(-2.05, 0, 0);
  tintHurt(you, 0); setAnim(you, "idle"); setAnim(foe, "idle");
  applyOutfitLook();
  $("foe-name").textContent = d.n;
  $("foe-sub").textContent = (G.boss ? "BOSS - LV " : "LV ") + lvl + " - " + DIFFS[RUN.diff].key;
  renderHearts(hpYouEl, G.youHP, G.youMax, "#6f8cff");
  renderFoeHP(); renderSpecial();
  startAttack();
}

function spinSpeed(base) {
  var s = base;
  if (G.chill > 0) s *= CHILL_SPEED;
  return s;
}
function newSpin(speedMul, zoneMul) {
  var C = curveFor(G.lvl), lvlF = 1 + (G.lvl - 1) * 0.055;
  var raw = Math.min(900, (270 + (G.round - 1) * 34) * C.speed * lvlF * (speedMul || 1));
  G.speed = spinSpeed(raw);
  var zBase = Math.max(15, 64 - (G.round - 1) * 4.5);
  G.zone = clamp(zBase * C.zone * (1 + RUN.up.grip * GRIP_BONUS) * (zoneMul || 1), 12, 95);
  G.perfect = Math.max(5, G.zone * 0.32);
  G.zoneCenter = rnd(0, 360);
  G.marker = (G.zoneCenter + 180 + rnd(-45, 45) + 360) % 360;
  G.travel = 0; G.maxTravel = 700 + G.zone;
}

function startAttack() {
  G.round++;
  newSpin(1, 1);
  hubR.textContent = G.round; hubL.textContent = "ROUND";
  setAnim(you, "windup"); setAnim(foe, "idle");
  /* charged? freeze the dial briefly so the special is a real decision
     rather than something you fumble for while the marker is running */
  if (G.special >= 100) {
    G.phase = "offer"; G.offerT = 0;
    phaseEl.className = "spc"; phaseEl.textContent = "SPECIAL READY - USE IT?";
    $("hint").textContent = "TAP THE BAR TO UNLEASH, OR WAIT TO SLAM";
    renderSpecial();
    return;
  }
  G.phase = "attack";
  phaseEl.className = "atk"; phaseEl.textContent = "YOUR SLAM";
  $("hint").textContent = "SPACE / TAP TO SLAM";
  renderSpecial();
}
/* the hold expired (or was declined) - start the normal spin */
function beginAttackSpin() {
  G.phase = "attack";
  phaseEl.className = "atk"; phaseEl.textContent = "YOUR SLAM";
  $("hint").textContent = "SPACE / TAP TO SLAM";
  renderSpecial();
}
function startDefend() {
  newSpin(1.05, 0.95);
  G.phase = "defend";
  hubL.textContent = "GUARD";
  phaseEl.className = "def"; phaseEl.textContent = "HIS SWING - GOLD BLOCKS, WHITE COUNTERS";
  setAnim(foe, "windup"); setAnim(you, "guard");
  $("hint").textContent = "GOLD = BLOCK   WHITE = COUNTER";
  renderSpecial();
}
function startSpecialSpin() {
  newSpin(1.15, 0.9);
  G.phase = "special";
  hubR.textContent = (SPECIAL_HITS - G.spLeft + 1) + "/" + SPECIAL_HITS;
  hubL.textContent = "SPECIAL";
  phaseEl.className = "spc"; phaseEl.textContent = "SPECIAL - " + G.spLeft + " SLAMS LEFT";
  setAnim(you, "windup");
  $("hint").textContent = "KEEP SLAMMING - ALL WHITE = x" + SPECIAL_ALL_WHITE;
  renderSpecial();
}

function judge() {
  var d = Math.abs(angDiff(G.marker, G.zoneCenter));
  if (d <= G.perfect / 2) return "white";
  if (d <= G.zone / 2) return "yellow";
  return "miss";
}

/* ---- glove / outfit effects ---- */
function gloveProc(isWhite) {
  var g = equipped("gloves");
  if (!g) return null;
  if (g.stat === "power") return null;                        // flat power, handled in damage
  var chance = (g.val + (isWhite ? WHITE_PROC_BONUS : 0)) / 100;
  return Math.random() < chance ? g.stat : null;
}
function attackDamage(isWhite) {
  var d = (isWhite ? DMG.white : DMG.yellow) * powerFor(G.lvl);
  var g = equipped("gloves");
  if (g && g.stat === "power") d *= g.val;
  if (G.banked > 0) { d += G.banked * (isWhite ? ABSORB_WHITE : 1); G.banked = 0; }
  return Math.round(d);
}
function dealToFoe(amount, color, tag) {
  G.foeHP = Math.max(0, G.foeHP - amount);
  G.dealt += amount;
  floatDmg("-" + amount + (tag || ""), color || "#ffc244", "foe");
  renderFoeHP();
}
function burnTick() {
  if (G.burn <= 0 || G.foeHP <= 0) return;
  var dmg = Math.max(1, Math.round(G.foeMax * BURN_PCT));
  G.foeHP = Math.max(0, G.foeHP - dmg);
  G.dealt += dmg;
  floatDmg("-" + dmg + " BURN", "#ff9a3c", "foe");
  renderFoeHP(); SFX.burn(); tintBurn(foe, .5);
  setTimeout(function () { if (foe) tintBurn(foe, 0); }, 260);
}
function loseHeart() {
  G.youHP--;
  renderHearts(hpYouEl, G.youHP, G.youMax, "#6f8cff");
  pop(hpYouEl, G.youMax - G.youHP);
}

/* ---- resolve: your attack ---- */
function resolveAttack(kind) {
  var white = kind === "white";
  if (kind === "miss") {
    G.misses++;
    SFX.whiff(); callout("MISSED", "#8d8397");
    setAnim(you, "slam");
    pause(0.85, afterAttack);
    return;
  }
  G.hits++; if (white) G.perfects++;
  addCharge(white ? CHARGE.white : CHARGE.yellow);
  setAnim(you, "slam");
  var dmg = attackDamage(white);
  var proc = gloveProc(white);
  setTimeout(function () {
    setAnim(foe, "hurt");
    burst(white ? .6 : .5, 1.78, 0, white ? C.torch : C.plank);
    shake(white ? 1.5 : .9);
    if (white) SFX.perfect(); else SFX.hit();
    dealToFoe(dmg, white ? "#ffc244" : "#f2ede1", "");
    if (proc === "chill") { G.chill = CHILL_SPINS; callout("CHILLED", "#8fd8ff"); renderFoeHP(); }
    else if (proc === "burn") { G.burn = 1; callout("BURNING", "#ff9a3c"); renderFoeHP(); }
    else callout(white ? "PERFECT SLAM" : "HIT", white ? "#ffc244" : "#f2ede1");
  }, 150);
  pause(1.05, afterAttack);
}
function afterAttack() {
  if (G.foeHP <= 0) { finish(true); return; }
  startDefend();
}

/* ---- resolve: his swing ---- */
function resolveDefend(kind) {
  burnTick();
  if (G.foeHP <= 0) { pause(0.7, function () { finish(true); }); return; }

  setAnim(foe, "slam");
  if (kind === "white") {                                   /* COUNTER */
    G.counters++;
    addCharge(CHARGE.counter);
    setTimeout(function () {
      setAnim(foe, "hurt"); burst(.6, 1.78, 0, C.torch); shake(1.4); SFX.counter();
      dealToFoe(Math.round(DMG.counter * powerFor(G.lvl)), "#ffc244", "");
      callout("COUNTER", "#ffc244");
    }, 150);
    pause(1.05, afterDefend);
    return;
  }
  if (kind === "yellow") {                                  /* BLOCK */
    G.blocks++;
    addCharge(CHARGE.block);
    setTimeout(function () {
      burst(-.4, 1.7, 0, C.plank); shake(.6); SFX.block();
      callout("BLOCKED", "#f2ede1");
    }, 150);
    pause(0.95, afterDefend);
    return;
  }

  /* guard missed - outfit gets its shot */
  var o = equipped("outfit");
  var saved = null;
  if (o && Math.random() < o.val / 100) saved = o.stat;
  setTimeout(function () {
    if (saved === "counter") {
      G.counters++; addCharge(CHARGE.counter);
      setAnim(foe, "hurt"); burst(.6, 1.78, 0, C.torch); shake(1.3); SFX.counter();
      dealToFoe(Math.round(DMG.counter * powerFor(G.lvl)), "#ffc244", "");
      callout("OUTFIT COUNTER", "#ffc244");
    } else if (saved === "evade") {
      setAnim(you, "evade"); SFX.evade();
      callout("EVADED", "#8fd8ff");
    } else if (saved === "absorb") {
      G.banked += ABSORB_STORE; SFX.absorb();
      callout("ABSORBED +" + ABSORB_STORE, "#8fd8ff");
      floatDmg("+" + ABSORB_STORE + " BANKED", "#8fd8ff", "you");
    } else {
      setAnim(you, "hurt"); burst(-.5, 1.78, 0, C.redstone); shake(1.3); SFX.counter();
      loseHeart(); addCharge(CHARGE.taken);
      callout("HIT - GUARD MISSED", "#e0453a");
    }
  }, 150);
  pause(1.05, afterDefend);
}
function afterDefend() {
  if (G.foeHP <= 0) { finish(true); return; }   /* a counter (or burn) can end it on his turn */
  if (G.youHP <= 0) { finish(false); return; }
  if (G.chill > 0) { G.chill--; renderFoeHP(); }
  startAttack();
}

/* ---- resolve: special ---- */
function resolveSpecialHit(kind) {
  var white = kind === "white";
  if (kind === "miss") { G.spAll = false; G.misses++; SFX.whiff(); }
  else {
    G.hits++; if (white) G.perfects++; else G.spAll = false;
    G.spDmg += white ? DMG.white : DMG.yellow;
    if (white) SFX.perfect(); else SFX.hit();
  }
  setAnim(you, "slam");
  G.spLeft--;
  if (G.spLeft > 0) {
    if (kind !== "miss") {                       /* spark per landed spin, brighter on white */
      burst(.55, 1.8, 0, white ? C.torch : C.plank);
      shake(white ? .8 : .5);
    }
    callout(kind === "miss" ? "MISS" : (white ? "WHITE" : "GOLD"), kind === "miss" ? "#8d8397" : (white ? "#ffc244" : "#f2ede1"));
    pause(0.34, startSpecialSpin);
    return;
  }
  /* final blow */
  var total = Math.round(G.spDmg * (G.spAll ? SPECIAL_ALL_WHITE : 1) * powerFor(G.lvl));
  var g = equipped("gloves");
  if (g && g.stat === "power") total = Math.round(total * g.val);
  if (G.banked > 0) { total += Math.round(G.banked * (G.spAll ? ABSORB_WHITE : 1)); G.banked = 0; }
  G.special = 0; renderSpecial();
  setTimeout(function () {
    setAnim(foe, "hurt");
    specialBurst(.6, 1.9, 0);
    if (G.spAll) specialBurst(.2, 2.3, 0);          /* flawless gets a second wave */
    shake(2.2); SFX.special();
    dealToFoe(total, "#ffc244", G.spAll ? " x" + SPECIAL_ALL_WHITE : "");
    callout(G.spAll ? "FLAWLESS SPECIAL x" + SPECIAL_ALL_WHITE : "SPECIAL SLAM", "#ffc244");
  }, 160);
  pause(1.3, afterAttack);
}

function strike() {
  if (G.phase === "attack") { resolveAttack(judge()); return; }
  if (G.phase === "defend") { resolveDefend(judge()); return; }
  if (G.phase === "special") { resolveSpecialHit(judge()); return; }
}
function useSpecial() {
  if ((G.phase !== "attack" && G.phase !== "offer") || G.special < 100) { SFX.nope(); return; }
  G.spLeft = SPECIAL_HITS; G.spDmg = 0; G.spAll = true;
  spBtn.classList.remove("on");
  SFX.charge();
  startSpecialSpin();
}

function finish(won) {
  G.phase = "over";
  phaseEl.textContent = "";
  setAnim(won ? foe : you, "down");
  setTimeout(function () { won ? SFX.win() : SFX.lose(); }, 250);
  if (window.Ads && window.Ads.onFightFinished) window.Ads.onFightFinished();

  var D = DIFFS[RUN.diff], earned, gemsWon = 0;
  if (won) {
    earned = Math.round((22 + G.lvl * 6 + G.perfects * 3 + G.counters * 4 + G.youHP * 5) * D.reward);
    if (G.boss) { earned = Math.round(earned * 1.5); gemsWon = 1; }
    RUN.streak++; RUN.best = Math.max(RUN.best, RUN.streak);
  } else {
    earned = Math.round((6 + G.lvl * 3) * D.reward);
    RUN.streak = 0;
  }
  RUN.coins += earned; RUN.gems += gemsWon; save();

  var v = $("verdict");
  v.textContent = won ? "SHOVED HIM OFF" : "YOU HIT THE FLOOR";
  v.className = "verdict " + (won ? "win" : "lose");
  $("over-line").textContent = won
    ? (G.boss ? "The boss folded. The pit owes you a gem." : "His health hit zero. The table is yours.")
    : "He emptied your hearts. The ladder starts over.";
  var prize = $("prize"); prize.innerHTML = "";
  var cw = document.createElement("span"); cw.className = "wallet coin";
  cw.appendChild(coinIcon()); cw.appendChild(document.createTextNode("+" + earned)); prize.appendChild(cw);
  if (gemsWon) {
    var gw = document.createElement("span"); gw.className = "wallet gem";
    gw.appendChild(gemIcon()); gw.appendChild(document.createTextNode("+" + gemsWon)); prize.appendChild(gw);
  }
  $("tally").textContent =
    "ROUNDS " + G.round + " - PERFECT " + G.perfects + " - HITS " + G.hits + "\n" +
    "BLOCKS " + G.blocks + " - COUNTERS " + G.counters + " - DAMAGE " + G.dealt + "\n" +
    (won ? "NEXT UP: LV " + (RUN.streak + 1) : "STREAK BROKEN AT LV " + G.lvl);
  setTimeout(function () { if (won) { SFX.coin(); if (gemsWon) SFX.gem(); } $("over").hidden = false; }, 1000);
}

function tick(dt) {
  if (LIVE[G.phase]) {
    var b = G.marker;
    G.marker = (G.marker + G.speed * dt) % 360; G.travel += G.speed * dt;
    var att = G.phase === "defend" ? foe : you;
    if (att) att.wind = clamp(G.travel / G.maxTravel, 0, 1);
    if (Math.abs(angDiff(b, G.zoneCenter)) > G.zone / 2 && Math.abs(angDiff(G.marker, G.zoneCenter)) <= G.zone / 2) SFX.tick();
    if (G.travel >= G.maxTravel) {
      if (G.phase === "attack") resolveAttack("miss");
      else if (G.phase === "defend") resolveDefend("miss");
      else resolveSpecialHit("miss");
    }
  } else if (G.phase === "offer") {
    /* dial held still while you decide whether to unleash the special */
    G.offerT += dt;
    you.wind = 0.18 + Math.sin(G.offerT * 6) * 0.05;   /* coiled, breathing */
    if (G.offerT >= SPECIAL_OFFER_HOLD) beginAttackSpin();
  } else if (G.phase === "resolve") {
    G.resolveT += dt;
    if (G.resolveT >= G.resolveLen) { var f = G.after; G.after = null; G.phase = "wait"; if (f) f(); }
  }
}

/* ============================================================
   CHESTS
============================================================ */
var CHESTS = [
  { k: "normal", name: "NORMAL CHEST", cur: "coins", cost: 150,
    odds: "70% common - 10% rare - 5% epic - 1% legendary - 14% gold",
    table: [["common", 70], ["rare", 10], ["epic", 5], ["legendary", 1], ["gold", 14]] },
  { k: "great", name: "GREAT CHEST", cur: "gems", cost: 5,
    odds: "40% rare - 30% common - 20% epic - 10% legendary",
    table: [["rare", 40], ["common", 30], ["epic", 20], ["legendary", 10]] },
  { k: "epic", name: "EPIC CHEST", cur: "gems", cost: 10,
    odds: "40% epic - 30% rare - 20% common - 10% legendary",
    table: [["epic", 40], ["rare", 30], ["common", 20], ["legendary", 10]] },
  { k: "legend", name: "LEGENDARY CHEST", cur: "gems", cost: 30,
    odds: "100% legendary", legend: true,
    table: [["legendary", 100]] }
];
function rollTable(table) {
  var total = 0, i;
  for (i = 0; i < table.length; i++) total += table[i][1];
  var r = Math.random() * total;
  for (i = 0; i < table.length; i++) { r -= table[i][1]; if (r <= 0) return table[i][0]; }
  return table[table.length - 1][0];
}
function openChest(ch) {
  var have = ch.cur === "coins" ? RUN.coins : RUN.gems;
  if (have < ch.cost) { SFX.nope(); return; }
  if (ch.cur === "coins") RUN.coins -= ch.cost; else RUN.gems -= ch.cost;
  var result = rollTable(ch.table);
  if (result === "gold") {
    var bonus = rndInt(120, 340);
    RUN.coins += bonus; save(); SFX.coin();
    showReveal({ gold: bonus });
    renderPit();
    return;
  }
  var kind = Math.random() < 0.5 ? "outfit" : "gloves";
  var type = pick(kind === "outfit" ? OUTFITS : GLOVES).t;
  var item = makeItem(kind, type, result, false);
  var dupe = RUN.inv.some(function (i) { return i.kind === item.kind && i.type === item.type && i.tier === item.tier && i.val >= item.val; });
  RUN.inv.push(item);
  save(); SFX.buy(); if (result === "legendary") SFX.gem();
  showReveal({ item: item, dupe: dupe });
  renderPit();
}
function showReveal(res) {
  var card = $("rv-card");
  card.innerHTML = "";
  if (res.gold) {
    card.style.color = "#ffc244";
    var t = document.createElement("div"); t.className = "rv-tier"; t.textContent = "MORE GOLD"; card.appendChild(t);
    var n = document.createElement("div"); n.className = "rv-name"; n.textContent = "+" + res.gold + " COIN"; card.appendChild(n);
  } else {
    var it = res.item, meta = TIER[it.tier];
    card.style.color = meta.color;
    var tt = document.createElement("div"); tt.className = "rv-tier"; tt.textContent = meta.name; card.appendChild(tt);
    var nn = document.createElement("div"); nn.className = "rv-name"; nn.textContent = itemName(it); card.appendChild(nn);
    var ee = document.createElement("div"); ee.className = "rv-eff"; ee.textContent = itemEff(it); card.appendChild(ee);
    if (res.dupe) { var dd = document.createElement("div"); dd.className = "rv-dupe"; dd.textContent = "YOU ALREADY HAD BETTER OR EQUAL"; card.appendChild(dd); }
  }
  $("reveal").hidden = false;
}

/* ============================================================
   HUB
============================================================ */
$("coin-icon").appendChild(coinIcon());
$("gem-icon").appendChild(gemIcon());

var diffsEl = $("diffs");
DIFFS.forEach(function (d, i) {
  var b = document.createElement("button");
  b.className = "diff"; b.type = "button";
  b.innerHTML = '<span class="dn">' + d.key + '</span><span class="dm">x' + d.reward.toFixed(1) +
                '</span><span class="df" data-fee></span>';
  b.addEventListener("click", function () { RUN.diff = i; SFX.buy(); save(); renderPit(); });
  diffsEl.appendChild(b);
});

var shopEl = $("shop");
UPGRADES.forEach(function (u) {
  var row = document.createElement("div"); row.className = "up-row";
  row.innerHTML = '<div class="up-main"><div class="up-name">' + u.name + "</div>" +
    '<div class="up-desc">' + u.desc + '</div><div class="pips" data-pips></div></div>' +
    '<button class="buy" type="button"></button>';
  row.querySelector("button").addEventListener("click", function () {
    var lv = RUN.up[u.k];
    if (lv >= u.max) return;
    var cost = u.costs[lv];
    if (RUN.coins < cost) { SFX.nope(); return; }
    RUN.coins -= cost; RUN.up[u.k] = lv + 1; SFX.buy(); save(); renderPit();
  });
  row._u = u; shopEl.appendChild(row);
});

var chestsEl = $("chests");
CHESTS.forEach(function (ch) {
  var b = document.createElement("button");
  b.className = "chest" + (ch.legend ? " legend" : ""); b.type = "button";
  b.setAttribute("data-cur", ch.cur);
  b.innerHTML = '<span class="cn">' + ch.name + '</span><span class="co">' + ch.odds + '</span><span class="cc"></span>';
  b.addEventListener("click", function () { openChest(ch); });
  b._ch = ch; chestsEl.appendChild(b);
});

function gearSlotHTML(kind) {
  var it = equipped(kind);
  var box = document.createElement("div"); box.className = "gear-slot";
  var k = document.createElement("div"); k.className = "gs-kind"; k.textContent = kind.toUpperCase();
  var n = document.createElement("div"); n.className = "gs-name";
  var e = document.createElement("div"); e.className = "gs-eff";
  if (it) {
    n.textContent = TIER[it.tier].name + " " + itemName(it);
    n.style.color = TIER[it.tier].color;
    e.textContent = itemEff(it);
  } else { n.textContent = "NOTHING EQUIPPED"; e.textContent = "-"; }
  box.appendChild(k); box.appendChild(n); box.appendChild(e);
  return box;
}

function renderPit() {
  $("coin-count").textContent = RUN.coins;
  $("gem-count").textContent = RUN.gems;
  $("streak-line").textContent = RUN.streak
    ? "WIN STREAK " + RUN.streak + "  -  BEST " + RUN.best
    : (RUN.best ? "BEST STREAK " + RUN.best : "NO WINS YET");
  var nextLvl = foeLevel();
  Array.prototype.forEach.call(diffsEl.children, function (b, i) {
    b.setAttribute("aria-pressed", i === RUN.diff ? "true" : "false");
    var f = Math.round(DIFFS[i].fee * nextLvl), slot = b.querySelector("[data-fee]");
    if (slot) {
      slot.textContent = f ? "BUY IN " + f : "FREE";
      slot.className = "df" + (f > RUN.coins ? " short" : "");
    }
  });
  Array.prototype.forEach.call(shopEl.children, function (row) {
    var u = row._u, lv = RUN.up[u.k];
    var pips = row.querySelector("[data-pips]");
    pips.innerHTML = "";
    for (var i = 0; i < u.max; i++) { var p = document.createElement("i"); p.className = "pip" + (i < lv ? " on" : ""); pips.appendChild(p); }
    var btn = row.querySelector("button");
    btn.innerHTML = "";
    if (lv >= u.max) { btn.textContent = "MAX"; btn.disabled = true; }
    else {
      var cost = u.costs[lv];
      btn.disabled = RUN.coins < cost;
      btn.appendChild(coinIcon());
      btn.appendChild(document.createTextNode(cost));
    }
  });
  Array.prototype.forEach.call(chestsEl.children, function (b) {
    var ch = b._ch, have = ch.cur === "coins" ? RUN.coins : RUN.gems;
    b.disabled = have < ch.cost;
    var cc = b.querySelector(".cc");
    cc.innerHTML = "";
    cc.appendChild(ch.cur === "coins" ? coinIcon() : gemIcon());
    cc.appendChild(document.createTextNode(ch.cost));
  });
  var strip = $("gear-strip"); strip.innerHTML = "";
  strip.appendChild(gearSlotHTML("outfit"));
  strip.appendChild(gearSlotHTML("gloves"));

  var lvl = foeLevel(), d = foeFor(lvl), boss = isBoss(lvl);
  $("next-foe").className = "next-foe" + (boss ? " boss" : "");
  $("nf-name").textContent = (boss ? "BOSS: " : "") + d.n;
  var fee = entryFee(lvl), broke = RUN.coins < fee;
  $("nf-stat").textContent = "LV " + lvl + " - " + foeMaxHP(lvl) + " HP - YOU " + youMaxHP() + " HEARTS" +
    (boss ? " - +1 GEM" : "") + (fee ? " - BUY IN " + fee : "");
  $("fight-btn").disabled = broke;
  $("fight-btn").textContent = broke ? "NEED " + fee : "Fight";
}

/* ---------- wardrobe ---------- */
var wardKind = "outfit";
function renderWardrobe() {
  Array.prototype.forEach.call($("ward-tabs").children, function (b) {
    b.setAttribute("aria-pressed", b.dataset.kind === wardKind ? "true" : "false");
  });
  var grid = $("ward-grid"); grid.innerHTML = "";
  var list = RUN.inv.filter(function (i) { return i.kind === wardKind; });
  list.sort(function (a, b) {
    var ta = TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier);
    return ta !== 0 ? ta : (a.type < b.type ? -1 : 1);
  });
  if (!list.length) {
    var empty = document.createElement("p"); empty.className = "blurb"; empty.textContent = "Nothing here yet - open a chest.";
    grid.appendChild(empty); return;
  }
  list.forEach(function (it) {
    var meta = TIER[it.tier], on = RUN.equip[it.kind] === it.uid;
    var card = document.createElement("div"); card.className = "item" + (on ? " eq" : "");
    var chip = document.createElement("span"); chip.className = "tier-chip";
    chip.style.background = meta.color; chip.textContent = meta.name; card.appendChild(chip);
    var nm = document.createElement("div"); nm.className = "it-name"; nm.textContent = itemName(it); card.appendChild(nm);
    var ef = document.createElement("div"); ef.className = "it-eff"; ef.textContent = itemEff(it); card.appendChild(ef);
    var b = document.createElement("button"); b.className = "it-btn" + (on ? " on" : ""); b.type = "button";
    b.textContent = on ? "EQUIPPED" : "EQUIP";
    b.addEventListener("click", function () {
      RUN.equip[it.kind] = it.uid; SFX.buy(); save();
      if (it.kind === "outfit") applyOutfitLook();
      renderWardrobe();
    });
    card.appendChild(b); grid.appendChild(card);
  });
}

/* ============================================================
   LOOP + INPUT
============================================================ */
var last = performance.now();
(function frame(now) {
  requestAnimationFrame(frame);
  var dt = Math.min(.05, (now - last) / 1000); last = now;
  tick(dt); animFighter(you, dt); animFighter(foe, dt); stepDebris(dt); drawDial();
  if (G.shake > 0) {
    G.shake = Math.max(0, G.shake - dt * 5.5);
    camera.position.set(CAM_BASE.x + rnd(-1, 1) * G.shake * .12, CAM_BASE.y + rnd(-1, 1) * G.shake * .12, CAM_BASE.z + rnd(-1, 1) * G.shake * .07);
  } else camera.position.copy(CAM_BASE);
  camera.lookAt(CAM_LOOK);
  torchLight.intensity = 1.35 + Math.sin(now * .006) * .18;
  renderer.render(scene, camera);
})(last);

function wake() { if (ac() && actx.state === "suspended") actx.resume(); }
addEventListener("keydown", function (e) {
  if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); wake(); strike(); }
  else if (e.code === "KeyS") { e.preventDefault(); wake(); useSpecial(); }
});
addEventListener("pointerdown", function (e) {
  if (e.target.closest(".screen") || e.target.closest("#sp-btn")) return;
  wake();
  if (LIVE[G.phase]) { e.preventDefault(); strike(); }
});
spBtn.addEventListener("click", function (e) { e.stopPropagation(); wake(); useSpecial(); });

$("start-btn").addEventListener("click", function () { wake(); $("menu").hidden = true; renderPit(); $("pit").hidden = false; if (window.Ads) window.Ads.showBanner(); });
$("fight-btn").addEventListener("click", function () {
  var fee = entryFee(foeLevel());
  if (RUN.coins < fee) { SFX.nope(); return; }      /* cannot buy in at these stakes */
  RUN.coins -= fee; save();
  $("pit").hidden = true; if (window.Ads) window.Ads.hideBanner(); beginBattle();
});
$("again-btn").addEventListener("click", function () { $("over").hidden = true; renderPit(); $("pit").hidden = false; if (window.Ads) window.Ads.showBanner(); });
$("ward-btn").addEventListener("click", function () { $("pit").hidden = true; renderWardrobe(); $("wardrobe").hidden = false; });
$("ward-back").addEventListener("click", function () { $("wardrobe").hidden = true; renderPit(); $("pit").hidden = false; });
Array.prototype.forEach.call($("ward-tabs").children, function (b) {
  b.addEventListener("click", function () { wardKind = b.dataset.kind; SFX.buy(); renderWardrobe(); });
});
$("rv-close").addEventListener("click", function () { $("reveal").hidden = true; });

$("ad-btn").addEventListener("click", function () {
  var btn = $("ad-btn"); btn.disabled = true; btn.textContent = "LOADING AD...";
  var done = function (ok) {
    btn.disabled = false; btn.textContent = "WATCH AD +2 GEM";
    if (ok) { RUN.gems += 2; SFX.gem(); save(); renderPit(); }
    else SFX.nope();
  };
  if (window.Ads && window.Ads.showRewarded) {
    window.Ads.showRewarded().then(done).catch(function () { done(false); });
  } else {
    setTimeout(function () { done(true); }, 700);   // web build: no ad SDK, grant for testing
  }
});

$("reset-btn").addEventListener("click", function () {
  RUN.coins = 0; RUN.gems = 0; RUN.streak = 0; RUN.diff = 1;
  RUN.up = { hearts: 0, grip: 0 };
  stockWardrobe(); applyOutfitLook();
  SFX.nope(); save(); renderPit();
});

renderHearts(hpYouEl, 3, 3, "#6f8cff");
renderFoeHP(); renderSpecial();
})();
