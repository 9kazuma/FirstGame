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

/* playtest feedback form - opens in the system browser, not inside the app */
var SURVEY_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdBS4Il9xe81VZH4Z6O3cpCXEvmHSDLXvNAgHiA6qh59J5POw/viewform";
var BURN_PCT = 0.05;      // burning: % of max HP the foe loses whenever he swings
var BURN_TURNS = 3;       // how many of his swings a burn lasts
var CHILL_SPINS = 3;      // how many spins a chill proc slows
var CHILL_SPEED = 0.62;   // speed multiplier while chilled
var WHITE_PROC_BONUS = 10;// +10 percentage points to glove proc odds on a white hit

/* special charge gains */
var CHARGE = { white: 15, yellow: 10, counter: 15, block: 10, taken: 5 };

/* ---- boss blessings (v1.3) ----
   Clearing a boss buys one of three temporary blessings, Abyss-style. They
   last until you hit the floor. Bosses carry more health than they used to
   (BOSS_HP_MUL) precisely so a blessed boss fight still runs a full length
   rather than folding in two rounds. */
var BOSS_HP_MUL = 1.75;       // was 1.6 - offsets the blessings

/* ---- major bosses (every 20 levels) ----
   A landmark fight: he is fatter and meaner, and you walk in carrying one of
   three handicaps for that fight only. */
var MAJOR_EVERY = 20;
var MAJOR_HP_MUL = 1.35;      // stacks on top of BOSS_HP_MUL
var MAJOR_DEBUFFS = [
  { k: "frail",  name: "FRAIL",        line: "YOU START A HEART DOWN" },
  { k: "narrow", name: "TUNNEL SIGHT", line: "THE GOLD ARC IS TIGHTER" },
  { k: "rushed", name: "OFF BALANCE",  line: "HIS SWING COMES IN FASTER" }
];
var SOFTEN_MIN = 0.10, SOFTEN_MAX = 0.20;   // health the next boss starts down
var SHIELD_MAX = 3;           // hard cap on banked shield
var SURGE_MAX = 2;            // charge blessing stacks
var SURGE_STEP = 0.30;        // +30% special charge per stack
var COUNT_FROM = 3;           // boss fights open on 3..2..1

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
var SPEED_CAP = 900;        // the fastest the dial will ever spin, deg/s
var STEADY_STEP = 70;       // STEADY HANDS shaves this much off the cap per level
var CLOCK_STEP = 0.5;       // LONG CLOCK adds this many seconds to a spin

var UPGRADES = [
  { k: "hearts", name: "HEART SLOTS", desc: "One more heart to lose", max: 2, costs: [1500, 2000] },
  { k: "grip",   name: "GRIP",        desc: "Widens the gold arc a little", max: 1, costs: [3000] },
  { k: "power",  name: "TRAINING",    desc: "+1 base damage on every hit", max: 2, costs: [800, 1800] },
  { k: "focus",  name: "FOCUS",       desc: "Widens the white core a little", max: 2, costs: [1200, 2600] },
  { k: "steady", name: "STEADY HANDS", desc: "Lowers the top spin speed", max: 3, costs: [500, 1000, 2000] },
  { k: "clock",  name: "LONG CLOCK",   desc: "+" + CLOCK_STEP + "s on every spin", max: 1, costs: [2000] },
  { k: "mastery", name: "MASTERY", cur: "gems", gold: 3000, max: 1, costs: [3], minLvl: 20,
    desc: "Train your fighter's own edge",
    label: function () { return "MASTERY - " + allyBase().name; },
    detail: function () {
      var b = allyBase();
      if (foeLevel() < 20) return "Reach level 20 before he has anything left to teach you.";
      return b.mastery ? b.mastery.note : "This fighter has nothing more to learn.";
    } }
];
var SPIN_SECONDS = 2.0;     // how long a single spin stays live, in seconds
var GRIP_BONUS = 0.06;
var FOCUS_BONUS = 0.12;     // white core widens 12% per FOCUS level
/* Training adds flat base damage before the level scaling, so it keeps
   its value deep into a run instead of fading. */
var powerBonus = function () { return RUN.up.power; };

/* The dial gets faster and the arc tighter each round of a fight. Past this
   round it stops escalating - by round 11 it is already brutal and further
   ramping just made long fights unwinnable rather than harder. */
var ROUND_RAMP_CAP = 10;    // round the ramp stops at
var RAMP_SPEED = 27;        // deg/s added per round (was 34 - gentler climb)
var ARC_BASE = 70;          // gold arc width in degrees at round 1
var ARC_SHRINK = 4.0;       // degrees the arc loses per round
var ARC_FLOOR = 18;         // never tighter than this

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

/* Every foe has a favourite QTE: the one he is QTE_FAV_BONUS points more
   likely to open with than the even split. fav:null = no preference. */
var FOES = [
  { n: "VIEL", lore: "Kept the books for the pit for eleven years before anyone saw him fight. Reads a man the way he reads a ledger - slowly, and only once.",        fav: "line",    skin: 0x5c3f2c, shirt: 0x3f7a3a, pants: 0x23304f, hair: 0x2c2118, bald: true, glasses: true },
  { n: "BARDS", lore: "Came down from the teaching hospital with a coat he never gave back. Says he only wants to see how the body gives out. Nobody has asked him to stop.",       fav: "circle",  skin: 0xf2e2b0, shirt: 0xf4f1e6, pants: 0x8fc4e8, hair: 0x16121a, coat: true },
  { n: "NEU", lore: "Nobody has seen the face under the mask, and the mask has never stopped smiling. Turned up one winter, paid the entry in coins that were still warm.",         fav: "swipe",   skin: 0xf0d24a, shirt: 0x8ecff0, pants: 0x4f9c48, hair: 0xff79b8, mask: true },
  { n: "IRONJAW", lore: "Took a plank to the jaw in his first bout and won anyway. The jaw set crooked and the name stuck. He has never once ducked.",     fav: "normal",  skin: 0x9aa0a6, shirt: 0x54606e, pants: 0x2f3238, hair: 0x33383e },
  { n: "DEVIANA", lore: "Ran a card table two streets over until the table ran out of players. Counts your tells out loud while she waits for you to swing.",     fav: "taps",    skin: 0xc98d6f, shirt: 0x8e2b22, pants: 0x2b1f1f, hair: 0x241a2e, female: true },
  { n: "THE WARDEN", lore: "Worked the night gate at the old block. Still locks the door behind him out of habit, and still expects you to be there in the morning.",  fav: "nerve", skin: 0x8e7ab5, shirt: 0x59357f, pants: 0x2c2140, hair: 0x1d1630 },
  { n: "HUBERT", lore: "Old, quiet, and impossible to read - he has no habits left to punish. Been in the pit longer than the pit has had a name.",      fav: null,      skin: 0xd0b48a, shirt: 0x1f6f63, pants: 0x243231, hair: 0xe8e2d4 }
];
/* ------------------------------------------------------------
   ALLIES
   The fighter you bring decides how the special works. Kazuma is
   the original four-slam combo; Twiz and Trist both run the Double
   Slap - a shorter combo that hits far harder and procs gloves
   twice as often. Kits are pure data, so retuning one is one line.
     hits   spins in the combo
     mult   damage multiplier on the finisher
     procMul  glove proc odds multiplier
     charge   special charge earned per exchange
     both     swing with both hands on the finisher
------------------------------------------------------------ */
var ALLIES = [
  { k: "kazuma", name: "KAZUMA", tag: "SPECIAL - FOUR SLAMS",
    desc: "Four slams in a row. Land all four white for double damage.",
    hits: 4, mult: 1.5, procMul: 1, charge: 0.75, both: false,
    skin: 0xd8a06a, hair: 0x4a3628,
    mastery: { mult: 1.75, atk: 1.25, cnt: 1.25, charge: 1.0, procMul: 1.25,
    note: "Special x1.75, charge back up to normal, and slam, counter and glove procs x1.25." } },
  { k: "twiz", name: "TWIZ", tag: "SPECIAL - DOUBLE SLAP",
    desc: "Two slams with both hands at x1.75 damage. Charges fast and procs gloves twice as often.",
    hits: 2, mult: 1.75, procMul: 2, charge: 1.5, both: true,
    skin: 0xe8c49a, hair: 0x9a3b2f,
    mastery: { charge: 2.0, procMul: 2.5,
    note: "Charges at x2 and procs gloves x2.5 as often." } },
  /* Kevin is the gambler: eight spins, and only a flawless run pays. Land all
     eight white and the opponent is finished outright; drop a single one and
     the whole combo limps in at half damage. */
  { k: "kevin", name: "KEVIN", tag: "SPECIAL - ALL OR NOTHING",
    desc: "Six slams. All six white finishes him on the spot - miss one and the whole combo lands at three-quarter damage.",
    hits: 6, mult: 0.75, procMul: 1, charge: 1.0, both: false, execute: true,
    skin: 0x9c6b4a, hair: 0x1d1a24,
    mastery: { hits: 5, charge: 1.25,
    note: "Only five slams to land them all, and charges x1.25 as fast." } },
  /* The Gambler plays his own dial - the arc reads inverted, white outside and
     gold at the core - and his combo pays double or bites. */
  { k: "gambler", name: "THE GAMBLER", tag: "SPECIAL - PACHINKO",
    desc: "Three slams at x2.5. His arc is inverted: a wide white perfect band around a small gold core. Gold is safe - whiff a spin entirely and the machine takes a heart.",
    hits: 3, mult: 2.5, procMul: 1, charge: 1.0, both: false, risk: true, flip: true,
    skin: 0xd9b98a, hair: 0x2b2440,
    mastery: { mult: 2.75, curse: true,
    note: "Special x2.75, and the finisher leaves him confused, burning or chilled for a turn." } },
  /* The Expeditioner barely swings - he waits. His own slam is feeble, but he
     punishes anything the other man throws. */
  { k: "expeditioner", name: "THE EXPEDITIONER", tag: "COUNTER PUNCHER",
    desc: "Slams at half damage, but counters at double. Four-slam special at x1.25. Let him come to you.",
    hits: 4, mult: 1.25, procMul: 1, charge: 1.0, both: false, atk: 0.5, cnt: 2.0,
    skin: 0xc98f5e, hair: 0x6b5330,
    mastery: { cnt: 2.5,
    note: "Counters at x2.5." } },
  /* Nobody knows who he is or where the pit found him. He fights stripped to
     the waist with no arc to aim for - every hit inside the gold is the same
     hit - and he does not counter, he only gets an arm up. */
  { k: "unknown", name: "???", tag: "???",
    desc: "???",
    hits: 1, mult: 6.0, procMul: 0, charge: 1.0, both: false,
    atk: 3.0, cnt: 0, bare: true, noWhite: true, spSpeed: 1.7,
    skin: 0xb98a5e, hair: 0x141018, shorts: 0x2b2b33,
    mastery: { atk: 3.5, mult: 8.75, charge: 1.25,
    note: "???" } }
];
var _adCache = null, _adKey = "";
function allyBase() {
  for (var i = 0; i < ALLIES.length; i++) if (ALLIES[i].k === RUN.ally) return ALLIES[i];
  return ALLIES[0];
}
/* The trained fighter is the base kit with his mastery folded over the top.
   Cached on ally+mastery so the merge is not redone on every damage roll. */
function allyDef() {
  var b = allyBase();
  if (!RUN.up.mastery || !b.mastery) return b;
  var key = b.k;
  if (_adKey !== key) {
    var out = {}, p;
    for (p in b) if (b.hasOwnProperty(p)) out[p] = b[p];
    for (p in b.mastery) if (b.mastery.hasOwnProperty(p)) out[p] = b.mastery[p];
    _adCache = out; _adKey = key;
  }
  return _adCache;
}

/* Set from the chosen ally at load time, so it must be declared before
   applyOutfitLook() runs - see the dial palette further down. */
var ARC_FLIP = false;
var ARC_NOWHITE = false;

/* ---- arena skins ----
   A map repaints the room: the floor check, the fog and background, the timber
   of the table, and the three lights. The table keeps its shape and the dial
   keeps its palette, so nothing about reading a spin changes - only the mood. */
var MAPS = [
  { k: "pit", name: "THE PIT", tag: "DEFAULT",
    desc: "A back room behind the bar, lit by a single torch. Purple dark, warm gold.",
    floorA: "#241d30", floorB: "#1c1726", pitch: 0x17131f,
    plank: 0xb4813f, plankDark: 0x6b4a22, key: 0xfff0d0, torch: 0xffc244,
    rim: 0x5f7cff, sky: 0x6b7fb5, ground: 0x1a1420 },
  { k: "alley", name: "NEON ALLEY", tag: "SKIN",
    desc: "Wet concrete under a dying streetlight. Cold cyan with a magenta bounce off the far wall.",
    floorA: "#1b2a2e", floorB: "#142023", pitch: 0x0a1317,
    plank: 0x53707a, plankDark: 0x2c3f45, key: 0xd8f6ff, torch: 0x35e0d0,
    rim: 0xff3fa4, sky: 0x2f6f7a, ground: 0x081014 },
  { k: "highroller", name: "HIGH ROLLER", tag: "SKIN",
    desc: "Red carpet, green felt and too much gold. The house is always watching this one.",
    floorA: "#4a1420", floorB: "#390f19", pitch: 0x1c070f,
    plank: 0x1f7a4d, plankDark: 0x11492e, key: 0xfff2cf, torch: 0xffd166,
    rim: 0xc41f3e, sky: 0x8a5a3a, ground: 0x1c070f }
];
var hex = function (n) { var h = n.toString(16); while (h.length < 6) h = "0" + h; return "#" + h; };
function mapDef() {
  for (var i = 0; i < MAPS.length; i++) if (MAPS[i].k === RUN.map) return MAPS[i];
  return MAPS[0];
}

var ROMAN = ["", "", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
var isBoss = function (lvl) { return lvl % 5 === 0; };
var isMajor = function (lvl) { return lvl % MAJOR_EVERY === 0; };

function foeFor(level) {
  var i = (level - 1) % FOES.length, cycle = Math.floor((level - 1) / FOES.length), f = FOES[i];
  return { n: cycle ? f.n + " " + (ROMAN[cycle + 1] || ("+" + cycle)) : f.n,
           skin: f.skin, shirt: f.shirt, pants: f.pants, hair: f.hair, female: !!f.female,
           fav: f.fav || null,
           ex: { bald: !!f.bald, glasses: !!f.glasses, mask: !!f.mask, coat: !!f.coat } };
}

var rnd = function (a, b) { return a + Math.random() * (b - a); };
var rndInt = function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); };
var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
/* local calendar day, so the ad chest comes back at midnight wherever you are */
function today() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
function adChestReady() { return RUN.adDay !== today(); }

/* ============================================================
   EQUIPMENT
   Tier roll ranges. "s10" stats cap at 10%, "s20" stats cap at
   20%, matching common = 1%/2% up to legendary = 7-10% / 17-20%.
   "mult" is the flat damage multiplier used by normal gloves.
============================================================ */
/* coin value a duplicate is auto-sold for. A drop is a duplicate when you
   already hold the same item and tier at an equal or better roll; if the new
   one rolls higher it is kept and the old one is sold instead. */
var DUPE_VALUE = { common: 100, normal: 150, rare: 300, epic: 800, legendary: 1500 };

var TIERS = ["common", "normal", "rare", "epic", "legendary"];
var TIER = {
  common:    { name: "COMMON",    color: "#9aa0a6", s10: [1, 1],  s20: [1, 2],   mult: [1.05, 1.10] , boot: [4, 6], cas: [8, 12] , bank: [5, 8] },
  normal:    { name: "NORMAL",    color: "#7fa24f", s10: [2, 3],  s20: [3, 6],   mult: [1.10, 1.20] , boot: [7, 9], cas: [15, 20] , bank: [10, 15] },
  rare:      { name: "RARE",      color: "#5a7cf0", s10: [3, 5],  s20: [7, 10],  mult: [1.20, 1.30] , boot: [10, 13], cas: [22, 30] , bank: [18, 25] },
  epic:      { name: "EPIC",      color: "#b06bf5", s10: [5, 7],  s20: [11, 16], mult: [1.30, 1.40] , boot: [14, 17], cas: [34, 42] , bank: [30, 40] },
  legendary: { name: "LEGENDARY", color: "#ffc244", s10: [7, 10], s20: [17, 20], mult: [1.40, 1.50] , boot: [18, 20], cas: [45, 50] , bank: [45, 50] }
};

/* Outfit effects only fire when you MISS your guard. */
var OUTFITS = [
  { t: "duelist",    name: "DUELIST WEAVE", stat: "counter", scale: "s10",
    shirt: 0x3f63e0, pants: 0x2a2f45, hair: 0x4a3628, trim: 0xffc244,
    eff: function (v) { return v + "% to auto-counter a missed guard"; } },
  { t: "skirmisher", name: "SKIRMISH RAGS", stat: "evade", scale: "s20",
    shirt: 0x1f6f63, pants: 0x243231, hair: 0x3a2f22, trim: 0x14443d,
    eff: function (v) { return v + "% to evade a missed guard"; } },
  { t: "bulwark",    name: "BULWARK PLATE", stat: "absorb", scale: "bank",
    shirt: 0x66707d, pants: 0x2f3238, hair: 0x33383e, trim: 0x9aa6b4,
    eff: function (v) { return "Absorb a missed guard and bank +" + v + "% on your next hit"; } }
];

/* Glove effects only fire when you LAND a hit. */
var GLOVES = [
  { t: "cold",  name: "COLD GLOVES",   stat: "chill", scale: "s20", color: 0x8fd8ff, cuff: 0x3f7ea8,
    eff: function (v) { return v + "% on hit to slow the next spins"; } },
  { t: "hot",   name: "HOT GLOVES",    stat: "burn",  scale: "s20", color: 0xe0453a, cuff: 0x7a1f18,
    eff: function (v) { return v + "% on hit to set him burning"; } },
  { t: "spin",  name: "SPIN GLOVES",   stat: "confuse", scale: "s20", color: 0xc39bff, cuff: 0x53307f,
    eff: function (v) { return v + "% on hit to leave him confused - he misses his next swing"; } },
  { t: "plain", name: "KEVIN GLOVES", stat: "power", scale: "mult", color: 0xd8b06a, cuff: 0x6b4a22,
    eff: function (v) { return "x" + v.toFixed(2) + " attack damage (no white bonus)"; } }
];

/* Boots are the third slot. They never fire on a proc of their own - each one
   just bends a number you already have. */
var BOOTS = [
  { t: "twiz",    name: "TWIZ TRAVEL BOOTS", stat: "chargeup", scale: "boot",
    col: 0x9a3b2f, trim: 0xe8c49a,
    eff: function (v) { return "+" + v + "% special charge"; } },
  { t: "exped",   name: "EXPEDITIONER BOOTS", stat: "counterup", scale: "boot",
    col: 0x6b5330, trim: 0xc98f5e,
    eff: function (v) { return "+" + v + "% counter damage"; } },
  { t: "casino",  name: "CASINO BOOTS", stat: "luck", scale: "cas",
    col: 0x1f7a4d, trim: 0xffd166,
    eff: function (v) { return "+" + v + "% to every chance-based effect"; } }
];
function defOf(kind, type) {
  var list = kind === "outfit" ? OUTFITS : (kind === "boots" ? BOOTS : GLOVES);
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
  coins: 0, gems: 0, streak: 0, best: 0, diff: 0, ally: "kazuma", map: "pit", hp: null,
  shield: 0, surge: 0, soften: 0, boon: false, adDay: "",
  up: { hearts: 0, grip: 0, power: 0, focus: 0, mastery: 0, steady: 0, clock: 0 },
  fx: true,                     /* particles, screen shake and the hit flash */
  music: true, sfx: true, perf: false,
  inv: [],
  equip: { outfit: null, gloves: null, boots: null }
};

/* Testing wardrobe: every outfit, glove and boot, in every tier, at max roll. */
var SLOT_DEFS = { outfit: null, gloves: null, boots: null };   /* filled below */
function eachGearDef(fn) {
  OUTFITS.forEach(function (d) { fn("outfit", d); });
  GLOVES.forEach(function (d) { fn("gloves", d); });
  BOOTS.forEach(function (d) { fn("boots", d); });
}
/* Adds anything the player does not already own, at max roll, and fills any
   empty slot. Run on every load, so a save made before a slot existed - boots,
   say - picks the new kit up instead of being stuck without it. */
function topUpWardrobe() {
  RUN.inv = RUN.inv || [];
  var have = {};
  RUN.inv.forEach(function (i) { have[i.kind + ":" + i.type + ":" + i.tier] = true; });
  eachGearDef(function (kind, def) {
    TIERS.forEach(function (t) {
      if (!have[kind + ":" + def.t + ":" + t]) RUN.inv.push(makeItem(kind, def.t, t, true));
    });
  });
  ["outfit", "gloves", "boots"].forEach(function (k) {
    if (equipped(k)) return;
    var first = RUN.inv.filter(function (i) { return i.kind === k; })[0];
    if (first) RUN.equip[k] = first.uid;
  });
}
function stockWardrobe() {
  RUN.inv = [];
  topUpWardrobe();
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
    RUN.diff = typeof d.diff === "number" ? d.diff : 0;
    RUN.ally = d.ally || "kazuma";
    if (RUN.ally === "trist") RUN.ally = "kevin";     /* v1.3: Trist became Kevin */
    RUN.map = d.map || "pit";
    RUN.fx = d.fx !== false;                         /* default on */
    RUN.music = d.music !== false;
    RUN.sfx = d.sfx !== false;
    RUN.perf = d.perf === true;
    RUN.adDay = d.adDay || "";
    RUN.hp = (typeof d.hp === "number") ? d.hp : null;
    RUN.shield = d.shield || 0; RUN.surge = d.surge || 0;
    RUN.soften = d.soften || 0; RUN.boon = !!d.boon;
    RUN.up = { hearts: (d.up && d.up.hearts) || 0, grip: (d.up && d.up.grip) || 0,
               power: (d.up && d.up.power) || 0, focus: (d.up && d.up.focus) || 0,
               mastery: (d.up && d.up.mastery) || 0,
               steady: (d.up && d.up.steady) || 0, clock: (d.up && d.up.clock) || 0 };
    RUN.inv = d.inv; RUN.equip = d.equip || { outfit: null, gloves: null };
    return true;
  } catch (e) { return false; }
}
if (!load()) stockWardrobe();
topUpWardrobe(); save();  /* every fighter owns the full kit - dev build */

var youMaxHP = function () { return Math.min(HP_CAP, HP_BASE + RUN.up.hearts); };

var BOONS = [
  { k: "soften", name: "SOFTEN HIM UP", tag: "NEXT BOSS",
    desc: "The next boss walks in already wounded, 10-20% of his health gone.",
    maxed: function () { return RUN.soften > 0; },
    detail: function () { return RUN.soften ? "ARMED - " + Math.round(RUN.soften * 100) + "% OFF" : "ONE BOSS, ONE TIME"; },
    take: function () { RUN.soften = rnd(SOFTEN_MIN, SOFTEN_MAX); } },
  { k: "shield", name: "SECOND SKIN", tag: "TEMP HEALTH",
    desc: "Bank 1 shield, up to " + SHIELD_MAX + ". Each one eats a hit before your hearts do.",
    maxed: function () { return RUN.shield >= SHIELD_MAX; },
    detail: function () { return "HOLDING " + RUN.shield + " / " + SHIELD_MAX; },
    take: function () { RUN.shield = Math.min(SHIELD_MAX, RUN.shield + 1); } },
  { k: "surge", name: "QUICK TEMPER", tag: "SPECIAL CHARGE",
    desc: "Your special charges " + Math.round(SURGE_STEP * 100) + "% faster. Stacks twice.",
    maxed: function () { return RUN.surge >= SURGE_MAX; },
    detail: function () { return "STACKS " + RUN.surge + " / " + SURGE_MAX; },
    take: function () { RUN.surge = Math.min(SURGE_MAX, RUN.surge + 1); } }
];
/* every blessing is temporary - the floor takes them all back */
function clearBoons() { RUN.shield = 0; RUN.surge = 0; RUN.soften = 0; RUN.boon = false; }
var foeLevel = function () { return RUN.streak + 1; };
function foeMaxHP(lvl) {
  var base = (BASE_FOE_HP + curveFor(lvl).hp * 14) * powerFor(lvl);
  return Math.round(base * (isBoss(lvl) ? BOSS_HP_MUL : 1) * (isMajor(lvl) ? MAJOR_HP_MUL : 1));
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
  if (RUN.sfx === false) return;
  var a = ac(); if (!a) return;
  var o = a.createOscillator(), g = a.createGain();
  o.type = t || "square"; o.frequency.setValueAtTime(f, a.currentTime);
  if (to) o.frequency.exponentialRampToValueAtTime(to, a.currentTime + d);
  g.gain.setValueAtTime(v || 0.12, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + d);
  o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + d + 0.02);
}
/* ---- theme ----
   Sixteen steps of a walking bass under a sparse minor arpeggio - the pit
   heard from the next room. Built from oscillators like everything else, so
   there is no audio file to ship and nothing to preload. */
var MUSIC = (function () {
  var BASS = [110, 110, 165, 110, 146.8, 146.8, 110, 130.8];
  var LEAD = [440, 0, 523.3, 0, 659.3, 0, 587.3, 0, 523.3, 0, 440, 0, 392, 0, 349.2, 0];
  var STEP = 0.28, timer = null, step = 0, gain = null, on = false, nextT = 0;

  /* Notes are scheduled a beat ahead against the audio clock rather than played
     the instant a timer fires. The timer now wakes 4x a second instead of once
     per note, the graph is built in batches, and the timing is sample-exact
     even while a fight is busy. */
  function voice(f, dur, type, vol, when) {
    var a = ac(); if (!a || !f) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(gain); o.start(when); o.stop(when + dur + 0.02);
  }
  function emit(n, when) {
    if (n % 2 === 0) voice(BASS[(n / 2) % BASS.length], STEP * 1.7, "triangle", 0.10, when);
    var l = LEAD[n % LEAD.length];
    if (l) voice(l, STEP * 0.8, "square", 0.028, when);
    if (n % 8 === 4) voice(80, 0.11, "sawtooth", 0.05, when);   /* soft pulse */
  }
  function tick() {
    var a = ac(); if (!a || !on) return;
    if (nextT < a.currentTime) nextT = a.currentTime + 0.05;
    while (nextT < a.currentTime + 0.6) { emit(step++, nextT); nextT += STEP; }
  }
  return {
    start: function () {
      if (on || RUN.music === false) return;
      var a = ac(); if (!a) return;
      if (!gain) { gain = a.createGain(); gain.gain.value = 0.85; gain.connect(a.destination); }
      on = true; step = 0; nextT = a.currentTime + 0.06;
      timer = setInterval(tick, 250);
      tick();
    },
    stop: function () {
      on = false;
      if (timer) { clearInterval(timer); timer = null; }
    },
    sync: function () { if (RUN.music === false) MUSIC.stop(); else MUSIC.start(); }
  };
})();

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
  lose: function () { [330, 260, 200, 130].forEach(function (f, i) { setTimeout(function(){blip(f,.22,"sawtooth",.12);}, i * 140); }); },
  /* major boss theme: a slow menacing figure under the countdown */
  major: function () {
    [[110,.34],[110,.34],[165,.3],[110,.34],[196,.3],[165,.5]].forEach(function (n, i) {
      setTimeout(function () { blip(n[0], n[1], "sawtooth", .13); blip(n[0] * 2, n[1] * .6, "square", .05); }, i * 300);
    });
  }
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
function pixelCap() { return RUN.perf ? 1.0 : 1.5; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelCap()));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = true;
/* Applied on load and whenever the option is toggled. */
function applyPerf() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelCap()));
  renderer.shadowMap.enabled = !RUN.perf;
  key.castShadow = !RUN.perf;
  scene.traverse(function (o) { if (o.isMesh && o.material) o.material.needsUpdate = true; });
  resize();
}
document.getElementById("stage").appendChild(renderer.domElement);
function resize() { var w = innerWidth, h = innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); }
addEventListener("resize", resize); resize();

var hemi = new THREE.HemisphereLight(0x6b7fb5, 0x1a1420, 0.62); scene.add(hemi);
var key = new THREE.DirectionalLight(0xfff0d0, 0.95);
key.position.set(4, 9, 6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
scene.add(key);
var torchLight = new THREE.PointLight(0xffc244, 1.5, 9, 2); torchLight.position.set(0, 3.6, 1.0); scene.add(torchLight);
var rim = new THREE.DirectionalLight(0x5f7cff, 0.4); rim.position.set(-6, 3, -6); scene.add(rim);

/* Every particle used to allocate its own BoxGeometry and material, which
   means a GPU buffer upload per speck - 14 on each hit, 46 on a special. They
   all share one unit cube now, scaled per particle, and one material per
   colour. Nothing is allocated in the hot path any more. */
var CUBE = new THREE.BoxGeometry(1, 1, 1);
var _dmat = {};
function debrisMat(hex) {
  var m = _dmat[hex];
  if (!m) m = _dmat[hex] = new THREE.MeshLambertMaterial({ color: hex });
  return m;
}
var _mmat = {};
function moteMat(hex) {
  var m = _mmat[hex];
  if (!m) m = _mmat[hex] = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: .7 });
  return m;
}
function box(w, h, d, color) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: color }));
  m.castShadow = true; m.receiveShadow = true; return m;
}
/* the floor check is a 64px canvas, so a map skin just repaints it */
var floorCv = document.createElement("canvas"); floorCv.width = floorCv.height = 64;
var floorTex = new THREE.CanvasTexture(floorCv);
function paintFloor(a, b) {
  var g = floorCv.getContext("2d");
  g.fillStyle = a; g.fillRect(0, 0, 64, 64);
  g.fillStyle = b; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  floorTex.needsUpdate = true;
}
(function makeFloor() {
  paintFloor("#241d30", "#1c1726");
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(9, 9);
  floorTex.magFilter = floorTex.minFilter = THREE.NearestFilter;
  var f = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), new THREE.MeshLambertMaterial({ map: floorTex }));
  f.rotation.x = -Math.PI / 2; f.receiveShadow = true; scene.add(f);
})();
var tableTop = [], tableTrim = [];
(function makeTable() {
  var t = new THREE.Group();
  var top = box(2.5, .24, 2.1, C.plank); top.position.y = 1.58; t.add(top); tableTop.push(top);
  var trim = box(2.62, .1, 2.22, C.plankDark); trim.position.y = 1.42; t.add(trim); tableTrim.push(trim);
  [[-1.05, -.85], [1.05, -.85], [-1.05, .85], [1.05, .85]].forEach(function (p) {
    var l = box(.24, 1.46, .24, C.plankDark); l.position.set(p[0], .73, p[1]); t.add(l); tableTrim.push(l);
  });
  scene.add(t);
})();
/* Repaint the room for the chosen arena. Cheap enough to call on every pick. */
function applyMapLook() {
  var m = mapDef();
  paintFloor(m.floorA, m.floorB);
  scene.background.setHex(m.pitch); scene.fog.color.setHex(m.pitch);
  tableTop.forEach(function (p) { p.material.color.setHex(m.plank); });
  tableTrim.forEach(function (p) { p.material.color.setHex(m.plankDark); });
  key.color.setHex(m.key); torchLight.color.setHex(m.torch); rim.color.setHex(m.rim);
  hemi.color.setHex(m.sky); hemi.groundColor.setHex(m.ground);
  specialLight.color.setHex(m.torch);
}

function makeFighter(skin, shirt, pants, hair, scale, female, ex) {
  ex = ex || {};
  var u = 0.11 * (scale || 1), g = new THREE.Group(), parts = [], shirtParts = [], pantsParts = [], hairParts = [], skinParts = [], handParts = [];
  var add = function (m) { parts.push(m); return m; };
  /* female build: narrower shoulders and waist, arms tucked closer in */
  var torsoW = female ? 6.4 : 8, shoulder = female ? 5.2 : 6, limbW = female ? 3.4 : 4;
  var lL = add(box(limbW * u, 12 * u, 4 * u, pants)); lL.position.set(-1.8 * u, 6 * u, 0); pantsParts.push(lL);
  var lR = add(box(limbW * u, 12 * u, 4 * u, pants)); lR.position.set(1.8 * u, 6 * u, 0); pantsParts.push(lR);
  g.add(lL, lR);
  var torso = add(box(torsoW * u, 12 * u, 4 * u, shirt)); torso.position.y = 18 * u; g.add(torso); shirtParts.push(torso);
  /* a coat reads as a slightly wider, longer shell over the torso */
  if (ex.coat) {
    var coat = add(box((torsoW + 1.6) * u, 14 * u, 5 * u, shirt));
    coat.position.y = 17 * u; g.add(coat); shirtParts.push(coat);
  }
  var head = new THREE.Group(); head.position.y = 24 * u;
  var skull = add(box(8 * u, 8 * u, 8 * u, skin)); skull.position.y = 4 * u; head.add(skull); skinParts.push(skull);
  if (!ex.bald) {
    var cap = add(box(8.3 * u, 3.2 * u, 8.3 * u, hair)); cap.position.y = 6.6 * u; head.add(cap); hairParts.push(cap);
  }
  if (female) {
    /* hair falling down the back, plus a strand either side of the face */
    var back = add(box(8.3 * u, 11 * u, 2.6 * u, hair)); back.position.set(0, 1.2 * u, -3.4 * u); head.add(back); hairParts.push(back);
    var sL = add(box(1.9 * u, 7 * u, 6.4 * u, hair)); sL.position.set(-4.3 * u, 2.4 * u, -.4 * u); head.add(sL); hairParts.push(sL);
    var sR = add(box(1.9 * u, 7 * u, 6.4 * u, hair)); sR.position.set(4.3 * u, 2.4 * u, -.4 * u); head.add(sR); hairParts.push(sR);
  }
  if (ex.mask) {
    /* a smiley plate covering the face: eyes and an upturned mouth built from
       little blocks so it stays in the same chunky voxel language as the rest */
    var plate = add(box(8.2 * u, 8.2 * u, .6 * u, 0xf4f1e6)); plate.position.set(0, 4 * u, 4.1 * u); head.add(plate);
    var mL = add(box(1.5 * u, 1.5 * u, .4 * u, 0x1b1420)); mL.position.set(-1.9 * u, 5.4 * u, 4.5 * u); head.add(mL);
    var mR = add(box(1.5 * u, 1.5 * u, .4 * u, 0x1b1420)); mR.position.set(1.9 * u, 5.4 * u, 4.5 * u); head.add(mR);
    [[-2.2, 2.5], [-1.1, 1.9], [0, 1.75], [1.1, 1.9], [2.2, 2.5]].forEach(function (p) {
      var seg = add(box(1.2 * u, 1.0 * u, .4 * u, 0x1b1420));
      seg.position.set(p[0] * u, p[1] * u, 4.5 * u); head.add(seg);
    });
  } else {
    var eL = add(box(1.6 * u, 1.6 * u, .4 * u, 0x1b1420)); eL.position.set(-1.8 * u, 4.2 * u, 4.05 * u);
    var eR = add(box(1.6 * u, 1.6 * u, .4 * u, 0x1b1420)); eR.position.set(1.8 * u, 4.2 * u, 4.05 * u);
    head.add(eL, eR);
  }
  if (ex.glasses) {
    /* two lenses on a bridge, sitting proud of the face */
    var gl = add(box(3.0 * u, 2.6 * u, .5 * u, 0x14202a)); gl.position.set(-1.9 * u, 4.2 * u, 4.35 * u); head.add(gl);
    var gr = add(box(3.0 * u, 2.6 * u, .5 * u, 0x14202a)); gr.position.set(1.9 * u, 4.2 * u, 4.35 * u); head.add(gr);
    var br = add(box(1.2 * u, .5 * u, .4 * u, 0x14202a)); br.position.set(0, 4.2 * u, 4.35 * u); head.add(br);
    var tL = add(box(.5 * u, .5 * u, 2.2 * u, 0x14202a)); tL.position.set(-3.9 * u, 4.2 * u, 3.2 * u); head.add(tL);
    var tR = add(box(.5 * u, .5 * u, 2.2 * u, 0x14202a)); tR.position.set(3.9 * u, 4.2 * u, 3.2 * u); head.add(tR);
  }
  g.add(head);
  function arm(sx) {
    var p = new THREE.Group(); p.position.set(sx * shoulder * u, 24 * u, 0);
    var a = add(box(limbW * u, 12 * u, limbW * u, shirt)); a.position.y = -5 * u; p.add(a); shirtParts.push(a);
    var h = add(box((limbW + .05) * u, 3 * u, (limbW + .05) * u, skin)); h.position.y = -9.5 * u; p.add(h);
    skinParts.push(h); handParts.push(h);
    g.add(p); return p;
  }
  return { group: g, head: head, torso: torso, armL: arm(-1), armR: arm(1), parts: parts,
           shirtParts: shirtParts, pantsParts: pantsParts, hairParts: hairParts, skinParts: skinParts,
           handParts: handParts,
           u: u, anim: { name: "idle", t: 0 }, wind: 0, bob: Math.random() * 6 };
}
function disposeFighter(f) {
  scene.remove(f.group);
  f.parts.forEach(function (p) { p.geometry.dispose(); p.material.dispose(); });
}
var you = makeFighter(0xd8a06a, 0x3f63e0, 0x2a2f45, 0x4a3628, 1.0);
you.group.position.set(-2.05, 0, 0); you.group.rotation.y = Math.PI / 2; scene.add(you.group);

/* ---- gear you can actually see ----
   Equipment used to be numbers on a card and a change of shirt colour. These
   are real pieces on the model: a plate and pauldrons for the heavy outfit, a
   hood for the light one, a sash for the duelist, and cuffs for the gloves.
   Built once and toggled, so switching kit costs nothing at runtime. */
function makeGear(f) {
  var u = f.u, gear = {};
  function piece(w, h, d, col, parent, x, y, z) {
    var m = box(w * u, h * u, d * u, col);
    m.position.set(x * u, y * u, z * u); m.visible = false;
    parent.add(m); f.parts.push(m); return m;
  }
  gear.chest     = piece(9.0, 8.4, 4.8, 0x9aa6b4, f.group,  0, 18,   0);
  gear.pauldronL = piece(5.2, 3.4, 5.2, 0x9aa6b4, f.armL,   0, -0.6, 0);
  gear.pauldronR = piece(5.2, 3.4, 5.2, 0x9aa6b4, f.armR,   0, -0.6, 0);
  gear.hood      = piece(9.0, 4.4, 9.0, 0x1f6f63, f.head,   0, 6.6,  0);
  gear.sash      = piece(8.6, 2.4, 4.5, 0xffc244, f.group,  0, 15,   0);
  gear.cuffL     = piece(4.7, 1.8, 4.7, 0x6b4a22, f.armL,   0, -7.9, 0);
  gear.cuffR     = piece(4.7, 1.8, 4.7, 0x6b4a22, f.armR,   0, -7.9, 0);
  gear.bootL     = piece(4.6, 3.4, 5.4, 0x6b5330, f.group, -1.8, 1.5, 0.3);
  gear.bootR     = piece(4.6, 3.4, 5.4, 0x6b5330, f.group,  1.8, 1.5, 0.3);
  return gear;
}
var youGear = makeGear(you);

/* ---- equipment aura ----
   Common and normal kit just looks like kit. From rare up it carries a tell:
   rare a clean glow with a few motes, epic a darker smoulder that trails
   heavier and slower, legendary a neon aura with an outline shell. Kept
   deliberately dim - it should read across the table, not compete with the
   dial for your eye. */
var TIER_FX = {
  rare:      { color: 0x5fe3d8, emis: 0.16, light: 0.55, every: 0.60, rise: 0.85, size: [.045, .085], life: 1.5, outline: false },
  epic:      { color: 0x8250e0, emis: 0.13, light: 0.50, every: 0.85, rise: 0.34, size: [.085, .155], life: 2.4, outline: false },
  legendary: { color: 0xffc244, emis: 0.26, light: 0.90, every: 0.50, rise: 1.00, size: [.045, .095], life: 1.7, outline: true }
};
var auraLight = new THREE.PointLight(0xffffff, 0, 3.4, 2);
auraLight.position.set(0, 1.5, 0); you.group.add(auraLight);

/* Outline shell: the same boxes a touch larger, drawn inside-out, so only the
   rim shows past the fighter. Built once and toggled. */
var outlineShells = (function () {
  var out = [];
  [you.torso, you.head.children[0]].forEach(function (src) {
    if (!src) return;
    var m = new THREE.Mesh(src.geometry.clone(),
      new THREE.MeshBasicMaterial({ color: 0xffc244, side: THREE.BackSide,
        transparent: true, opacity: 0.62 }));
    m.scale.set(1.09, 1.07, 1.09); m.visible = false;   /* a rim, not a halo */
    src.parent.add(m); m.position.copy(src.position);
    out.push(m);
  });
  return out;
})();

var auraFx = null, auraT = 0;
function auraTier() {
  var best = -1;
  ["outfit", "gloves", "boots"].forEach(function (k) {
    var it = equipped(k);
    if (it && allyAllows(k, it)) { var i = TIERS.indexOf(it.tier); if (i > best) best = i; }
  });
  return best >= 0 ? TIERS[best] : null;
}
function applyAura() {
  var t = auraTier();
  auraFx = (t && TIER_FX[t]) || null;
  var col = auraFx ? auraFx.color : 0xffffff;
  auraLight.color.setHex(col);
  auraLight.intensity = auraFx ? auraFx.light : 0;
  outlineShells.forEach(function (m) {
    m.visible = !!(auraFx && auraFx.outline);
    m.material.color.setHex(col);
  });
  /* a low emissive on the gear itself, so the kit glows rather than the man */
  var e = new THREE.Color(col), k = auraFx ? auraFx.emis : 0;
  [youGear.chest, youGear.pauldronL, youGear.pauldronR, youGear.hood,
   youGear.sash, youGear.cuffL, youGear.cuffR].forEach(function (p) {
    p.material.emissive.setRGB(e.r * k, e.g * k, e.b * k);
  });
}
/* one drifting mote - no gravity, fades out where debris bounces */
function mote() {
  if (!auraFx || !RUN.fx) return;
  var sz = rnd(auraFx.size[0], auraFx.size[1]);
  var m = new THREE.Mesh(CUBE, moteMat(auraFx.color));
  m.scale.set(sz, sz, sz); m.userData.sz = sz; m.userData.shared = true;
  m.position.set(you.group.position.x + rnd(-.35, .35), rnd(.5, 2.2), rnd(-.3, .3));
  m.userData.v = new THREE.Vector3(rnd(-.12, .12), auraFx.rise * rnd(.7, 1.2), rnd(-.08, .08));
  m.userData.rv = new THREE.Vector3(0, rnd(-1.6, 1.6), 0);
  m.userData.life = m.userData.life0 = auraFx.life * rnd(.8, 1.2);
  m.userData.mote = true;
  scene.add(m); debris.push(m);
}

/* Paint and show the equipped kit. Runs after the ally look, because the ally
   owns skin - and the hands are skin until a glove covers them. */
function applyGearLook() {
  var A = allyDef();
  var o = equipped("outfit"), od = o ? defOf("outfit", o.type) : OUTFITS[0];
  var gl = equipped("gloves"), gd = gl ? defOf("gloves", gl.type) : null;
  if (A.bare) { od = { t: "-", trim: 0x000000, shirt: A.skin }; gd = null; }
  var heavy = od.t === "bulwark";
  [youGear.chest, youGear.pauldronL, youGear.pauldronR].forEach(function (p) {
    p.visible = heavy; p.material.color.setHex(od.trim);
  });
  youGear.hood.visible = od.t === "skirmisher";
  youGear.hood.material.color.setHex(od.shirt);
  youGear.sash.visible = od.t === "duelist";
  youGear.sash.material.color.setHex(od.trim);
  youGear.cuffL.visible = youGear.cuffR.visible = !!gd;
  if (gd) {
    youGear.cuffL.material.color.setHex(gd.cuff);
    youGear.cuffR.material.color.setHex(gd.cuff);
    you.handParts.forEach(function (p) { p.material.color.setHex(gd.color); });
  }
  var bt = equipped("boots");
  var bd = (bt && allyAllows("boots", bt)) ? defOf("boots", bt.type) : null;
  youGear.bootL.visible = youGear.bootR.visible = !!bd;
  if (bd) {
    youGear.bootL.material.color.setHex(bd.col);
    youGear.bootR.material.color.setHex(bd.col);
  }
  applyAura();
}

/* Equipped outfit repaints the player. The chosen ally is applied after it
   and owns skin and hair, so the three fighters stay recognisable whatever
   outfit is equipped; the outfit still owns shirt and trousers. */
function applyOutfitLook() {
  var it = equipped("outfit");
  var def = it ? defOf("outfit", it.type) : OUTFITS[0];
  you.shirtParts.forEach(function (p) { p.material.color.setHex(def.shirt); });
  you.pantsParts.forEach(function (p) { p.material.color.setHex(def.pants); });
  you.hairParts.forEach(function (p) { p.material.color.setHex(def.hair); });
  applyAllyLook();
  applyGearLook();
}
function applyAllyLook() {
  var a = allyDef();
  ARC_FLIP = !!a.flip;
  ARC_NOWHITE = !!a.noWhite;
  you.skinParts.forEach(function (p) { p.material.color.setHex(a.skin); });
  you.hairParts.forEach(function (p) { p.material.color.setHex(a.hair); });
  if (a.bare) {                       /* no shirt at all, and a pair of shorts */
    you.shirtParts.forEach(function (p) { p.material.color.setHex(a.skin); });
    you.pantsParts.forEach(function (p) { p.material.color.setHex(a.shorts); });
  }
  you.both = !!a.both;
}
applyOutfitLook();

var foe = null;
function spawnFoe(level) {
  if (foe) disposeFighter(foe);
  var d = foeFor(level), sc = clamp(1.02 + (level - 1) * 0.035, 1.0, 1.34) * (isBoss(level) ? 1.12 : 1);
  foe = makeFighter(d.skin, d.shirt, d.pants, d.hair, sc, d.female, d.ex);
  foe.group.position.set(2.15, 0, 0); foe.group.rotation.y = -Math.PI / 2;
  scene.add(foe.group);
  return d;
}

var debris = [];
function burst(x, y, z, color) {
  if (!RUN.fx) return;
  for (var i = 0; i < 14; i++) {
    var s = rnd(.05, .12);
    var m = new THREE.Mesh(CUBE, debrisMat(color));
    m.scale.set(s, s, s); m.userData.shared = true;
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
applyMapLook();          /* paint the saved arena now every light exists */

function specialBurst(x, y, z) {
  if (!RUN.fx) return;
  var cols = [C.torch, 0xfff3cf, C.redstone, C.bone];
  var i, m, s, a, sp;
  for (i = 0; i < 44; i++) {                       /* ring blown outward */
    a = (i / 44) * Math.PI * 2 + rnd(-0.12, 0.12);
    sp = rnd(3.0, 6.6);
    s = rnd(.06, .17);
    m = new THREE.Mesh(CUBE, debrisMat(cols[i % cols.length]));
    m.scale.set(s, s, s); m.userData.shared = true;
    m.position.set(x + rnd(-.15, .15), y + rnd(-.2, .2), z + rnd(-.15, .15));
    m.userData.v = new THREE.Vector3(Math.cos(a) * sp, rnd(1.4, 4.2), Math.sin(a) * sp * 0.55);
    m.userData.rv = new THREE.Vector3(rnd(-15, 15), rnd(-15, 15), rnd(-15, 15));
    m.userData.life = rnd(.85, 1.4);
    scene.add(m); debris.push(m);
  }
  for (i = 0; i < 18; i++) {                       /* fountain straight up */
    s = rnd(.05, .12);
    m = new THREE.Mesh(CUBE, debrisMat(cols[i % 2]));
    m.scale.set(s, s, s); m.userData.shared = true;
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
  if (auraFx && RUN.fx) {
    auraT += dt;
    if (auraT >= auraFx.every) { auraT = 0; mote(); }
  }
  for (var i = debris.length - 1; i >= 0; i--) {
    var d = debris[i]; d.userData.life -= dt;
    if (d.userData.life <= 0) {
      scene.remove(d);
      if (!d.userData.shared) { d.geometry.dispose(); d.material.dispose(); }
      debris.splice(i, 1); continue;
    }
    if (d.userData.mote) {                       /* aura motes float, they do not fall */
      d.position.addScaledVector(d.userData.v, dt);
      d.rotation.y += d.userData.rv.y * dt;
      var k = clamp(d.userData.life / d.userData.life0, 0, 1);
      d.scale.setScalar(d.userData.sz * (0.35 + 0.65 * k));   /* fade by shrinking */
      continue;
    }
    d.userData.v.y -= 13 * dt; d.position.addScaledVector(d.userData.v, dt);
    d.rotation.x += d.userData.rv.x * dt; d.rotation.y += d.userData.rv.y * dt;
    if (d.position.y < .05) { d.position.y = .05; d.userData.v.y *= -.36; d.userData.v.multiplyScalar(.7); }
  }
}
function setAnim(f, n) { if (f) { f.anim.name = n; f.anim.t = 0; } }
/* Not every part is a lit material - the aura shells are unlit - so skip any
   that cannot take an emissive rather than throwing mid-fight. */
function tint(f, hex, a) {
  var c = new THREE.Color(hex);
  f.parts.forEach(function (p) {
    if (p.material && p.material.emissive) p.material.emissive.setRGB(c.r * a, c.g * a, c.b * a);
  });
}
function tintHurt(f, a) { tint(f, 0xff3320, a); }
function tintBurn(f, a) { tint(f, 0xff7a1a, a); }

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
    /* Double Slap swings with both hands - mirror the right arm onto the left */
    if (f.both) { f.armL.rotation.x = f.armR.rotation.x; f.armL.rotation.z = -.06; }
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
/* Pip looks, indexed by state: 0 dead, 1 gold, 2 white core. */
var PIP_LOOK = [
  { fill: "#3a2f22", width: 7, x: CX - 3.5, height: 10, y: CY - RAD - 5 },
  { fill: "#ffc244", width: 8, x: CX - 4,   height: 14, y: CY - RAD - 7 },
  { fill: "#f2ede1", width: 9, x: CX - 4.5, height: 17, y: CY - RAD - 8.5 }
];
/* Which band is the marker sitting in? 0 outside the arc, 1 gold, 2 white.
   White always means perfect and gold always means normal. The Gambler swaps
   the two outright: his white is as wide as everyone else's gold, and his gold
   shrinks to the size of a normal white core. A far more forgiving perfect
   window - which is exactly what the heart on the line is paying for.
   The dial and judge() share this, so what you see is always what you score. */
function bandAt(d, half, ph) {
  if (d > half) return 0;
  if (ARC_NOWHITE) return 1;          /* the ??? has no core - it is all gold */
  var core = d <= ph;
  return (ARC_FLIP ? !core : core) ? 2 : 1;
}
function paintPip(el, state) {
  if (el._s === state) return;                 /* nothing changed - no DOM write */
  el._s = state;
  var L = PIP_LOOK[state];
  el.setAttribute("fill", L.fill); el.setAttribute("width", L.width);
  el.setAttribute("x", L.x); el.setAttribute("height", L.height); el.setAttribute("y", L.y);
}
function drawDial() {
  var step = 360 / PIPS, half = G.zone / 2, ph = G.perfect / 2;
  var live = !!LIVE[G.phase] || G.phase === "resolve";
  for (var i = 0; i < PIPS; i++) {
    var d = Math.abs(angDiff(i * step, G.zoneCenter));
    paintPip(pipEls[i], live ? bandAt(d, half, ph) : 0);
  }
  var left = G.spinLimit > 0 ? clamp(1 - G.spinT / G.spinLimit, 0, 1) : 1, lit = Math.ceil(left * TICKS);
  var liveT = !!LIVE[G.phase], low = left < .28;
  var fill = low ? "#e0453a" : (G.chill > 0 ? "#8fd8ff" : "#b4813f");
  for (var k = 0; k < TICKS; k++) {
    var t = tickEls[k], op = (liveT && k < lit) ? (low ? ".95" : ".42") : ".06";
    if (t._o !== op) { t._o = op; t.setAttribute("opacity", op); }
    if (t._f !== fill) { t._f = fill; t.setAttribute("fill", fill); }
  }
  var rot = Math.round(G.marker * 4) / 4;   /* true angle, quarter-degree granularity */
  if (markerEl._r !== rot) {
    markerEl._r = rot;
    markerEl.setAttribute("transform", "rotate(" + rot + " " + CX + " " + CY + ")");
  }
  var mo = live ? "1" : "0.15";
  if (markerEl._mo !== mo) { markerEl._mo = mo; markerEl.style.opacity = mo; }
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
var spFill = $("sp-fill"), spPct = $("sp-pct"), spTrack = $("sp-track"), spBtn = $("sp-btn"), spLabel = $("sp-label");

function renderFoeHP() {
  hpNumEl.innerHTML = Math.max(0, Math.round(G.foeHP)) + '<span class="max"> / ' + G.foeMax + "</span>";
  hpNumEl.classList.remove("pop"); void hpNumEl.offsetWidth; hpNumEl.classList.add("pop");
  hpFillEl.style.width = clamp(G.foeHP / G.foeMax * 100, 0, 100) + "%";
  hpFillEl.classList.toggle("burn", G.burn > 0);
  var tags = [];
  if (G.burn > 0) tags.push('<span class="burn-tag">BURNING</span>');
  if (G.chill > 0) tags.push('<span class="chill-tag">CHILLED ' + G.chill + "</span>");
  if (G.confuse > 0) tags.push('<span class="confuse-tag">CONFUSED</span>');
  statusEl.innerHTML = tags.join(" ");
}
function renderSpecial() {
  spFill.style.width = G.special + "%";
  spPct.textContent = Math.round(G.special) + "%";
  var full = G.special >= 100;
  /* only YOUR turn can spend it - during his swing the bar must not look
     like something you can press, or you tap it and nothing happens */
  var yours = (G.phase === "attack" || G.phase === "offer");
  spTrack.classList.toggle("full", full);
  spTrack.classList.toggle("waiting", full && !yours);
  spBtn.classList.toggle("on", full && yours);
  spLabel.textContent = full ? (yours ? "SPECIAL READY" : "READY NEXT TURN") : "SPECIAL";
}
/* boot helpers - each returns a plain multiplier so the call sites stay tidy */
/* The ??? fights bare. No outfit at all, and nothing that pays out on a
   chance, since he procs nothing - the only kit that reaches him is the flat
   power of Kevin Gloves and the Expeditioner boots. */
function allyAllows(kind, it) {
  var a = allyDef();
  if (!a.bare || !it) return true;
  if (kind === "outfit") return false;
  if (kind === "gloves") return it.type === "plain";
  if (kind === "boots") return it.type === "exped";
  return true;
}
function bootVal(stat) {
  var b = equipped("boots");
  return (b && b.stat === stat && allyAllows("boots", b)) ? b.val : 0;
}
var chargeBoot  = function () { return 1 + bootVal("chargeup") / 100; };
var counterBoot = function () { return 1 + bootVal("counterup") / 100; };
var luckBoot    = function () { return 1 + bootVal("luck") / 100; };

function addCharge(n) {
  var was = G.special;
  G.special = clamp(G.special + n * allyDef().charge * chargeBoot() * (1 + SURGE_STEP * RUN.surge), 0, 100);
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
  if (!RUN.fx) return;                 /* no camera kick, no dial jolt, no flash */
  G.shake = s;
  var d = $("dial"); d.classList.remove("shake"); void d.offsetWidth; d.classList.add("shake");
  var f = $("flash"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
}
function pop(node, idx) {
  var n = node.children[clamp(idx - 1, 0, node.children.length - 1)];
  if (!n) return; n.classList.add("pop"); setTimeout(function () { n.classList.remove("pop"); }, 130);
}

/* ============================================================
   QTE  (v1.3)
   His swing is no longer always the dial. Each defend turn rolls one of six
   challenges; every foe has a favourite that is QTE_FAV_BONUS points more
   likely than the even 1/6 split (no favourite = a flat 16.6% each).

   Every challenge reports back in the vocabulary the dial already used -
     "white"  clean   -> COUNTER
     "yellow" scrappy -> BLOCK
     "miss"   failed  -> you eat it
   so resolveDefend() never had to learn about QTEs at all.

   Timing runs off the frame loop's dt, which means pausing freezes a QTE
   mid-challenge for free.
============================================================ */
var QTE_TYPES = ["circle", "line", "swipe", "nerve", "normal", "taps"];
var QTE_FAV_BONUS = 10;                 /* percentage points, per the spec */
var QTE_LABEL = {
  circle: "RING SYNC", line: "LINE TEST", swipe: "SHAKE HIM OFF",
  nerve: "HOLD YOUR NERVE", normal: "THE DIAL", taps: "HAMMER IT"
};
var QTE_HINT = {
  circle: "TAP WHEN THE RING MEETS THE GOLD",
  line: "TAP INSIDE THE GOLD - WHITE CORE COUNTERS",
  swipe: "SWIPE THAT WAY, FAST",
  nerve: "DO WHAT IT SAYS UNTIL THE BAR EMPTIES",
  taps: "TAP AS FAST AS YOU CAN",
  normal: "THE ORDINARY DIAL - TAP INSIDE THE GOLD"
};

function rollQTE(fav) {
  var n = QTE_TYPES.length, base = 100 / n, w = [], total = 0, i, v;
  for (i = 0; i < n; i++) {
    v = base;
    if (fav) v = (QTE_TYPES[i] === fav) ? base + QTE_FAV_BONUS : base - QTE_FAV_BONUS / (n - 1);
    w.push(v); total += v;
  }
  var r = Math.random() * total;
  for (i = 0; i < n; i++) { r -= w[i]; if (r <= 0) return QTE_TYPES[i]; }
  return QTE_TYPES[n - 1];
}

var QTE = (function () {
  var host = null, bodyEl, barEl, hintEl;
  var cur = null, onDone = null, wired = false;

  function wire() {
    if (wired) return;
    host = $("qte"); bodyEl = $("qte-body");
    barEl = $("qte-timer"); hintEl = $("qte-hint");
    var fwd = function (name) {
      return function (e) {
        if (PAUSED || !cur || !cur[name]) return;
        e.preventDefault(); e.stopPropagation();
        cur[name](e);
      };
    };
    host.addEventListener("pointerdown", function (e) {
      if (PAUSED || !cur) return;
      e.preventDefault(); e.stopPropagation();
      /* without capture, a drag that leaves the overlay stops delivering moves */
      try { host.setPointerCapture(e.pointerId); } catch (err) {}
      if (cur.down) cur.down(e);
    });
    host.addEventListener("pointermove", fwd("move"));
    host.addEventListener("pointerup", function (e) {
      if (PAUSED || !cur) return;
      e.preventDefault(); e.stopPropagation();
      try { host.releasePointerCapture(e.pointerId); } catch (err) {}
      if (cur.up) cur.up(e);
    });
    /* the browser claiming the gesture must not count as an answer */
    host.addEventListener("pointercancel", function (e) {
      if (!cur) return;
      try { host.releasePointerCapture(e.pointerId); } catch (err) {}
      if (cur.cancel) cur.cancel(e); else if (cur.up) cur.up(e);
    });
    wired = true;
  }

  /* one SVG canvas per challenge, in its own coordinate space */
  var curSvg = null, curVB = [100, 100];
  function canvas(w, h) {
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 " + w + " " + h);
    bodyEl.innerHTML = ""; bodyEl.appendChild(s);
    curSvg = s; curVB = [w, h];
    return s;
  }
  function localPt(e) {
    var r = bodyEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }
  /* client coords -> viewBox units, via the SVG's real rendered box */
  function viewPt(e) {
    var r = curSvg ? curSvg.getBoundingClientRect() : bodyEl.getBoundingClientRect();
    if (!r.width || !r.height) return { x: -999, y: -999 };
    return { x: (e.clientX - r.left) / r.width * curVB[0],
             y: (e.clientY - r.top) / r.height * curVB[1] };
  }

  function finish(kind) {
    if (!cur) return;
    cur = null;
    host.hidden = true;
    document.body.classList.remove("qte-on");
    bodyEl.innerHTML = "";
    var f = onDone; onDone = null;
    if (f) f(kind);
  }

  /* ---- the six challenges -------------------------------------------- */
  var BUILD = {};

  /* RING SYNC - a ring collapses onto a gold target; tap when they meet */
  BUILD.circle = function (P) {
    var R0 = 46, RT = 17;
    var svg = canvas(100, 100);
    svg.appendChild(el("circle", { cx: 50, cy: 50, r: RT, fill: "none", stroke: "#ffc244", "stroke-width": 3.4, opacity: ".9" }));
    svg.appendChild(el("circle", { cx: 50, cy: 50, r: RT, fill: "none", stroke: "#f2ede1", "stroke-width": 1.1, opacity: ".7" }));
    var ring = el("circle", { cx: 50, cy: 50, r: R0, fill: "none", stroke: "#f2ede1", "stroke-width": 3 });
    svg.appendChild(ring);
    var t = 0, r = R0;
    return {
      step: function (dt) {
        t += dt;
        r = R0 * (1 - Math.min(1, t / P.limit));
        ring.setAttribute("r", Math.max(0.4, r));
        P.bar(1 - t / P.limit);
        if (t >= P.limit) finish("miss");
      },
      down: function () {
        var d = Math.abs(r - RT);
        finish(d <= P.core ? "white" : d <= P.band ? "yellow" : "miss");
      }
    };
  };

  /* LINE TEST - a cursor sweeps a track, stop it in the band */
  BUILD.line = function (P) {
    var svg = canvas(100, 30), zw = P.band, cw = P.core;
    svg.appendChild(el("rect", { x: 3, y: 12, width: 94, height: 6, rx: 1, fill: "#3a2f22" }));
    svg.appendChild(el("rect", { x: 50 - zw / 2, y: 8, width: zw, height: 14, rx: 1, fill: "#ffc244", opacity: ".85" }));
    svg.appendChild(el("rect", { x: 50 - cw / 2, y: 6, width: cw, height: 18, rx: 1, fill: "#f2ede1" }));
    var cur1 = el("rect", { x: 1.4, y: 3, width: 3.2, height: 24, rx: 1, fill: "#e0453a" });
    svg.appendChild(cur1);
    var x = 3, dir = 1, t = 0;
    return {
      step: function (dt) {
        t += dt;
        x += dir * P.speed * dt;
        if (x > 97) { x = 97; dir = -1; }
        if (x < 3) { x = 3; dir = 1; }
        cur1.setAttribute("x", x - 1.6);
        P.bar(1 - t / P.limit);
        if (t >= P.limit) finish("miss");
      },
      down: function () {
        var d = Math.abs(x - 50);
        finish(d <= cw / 2 ? "white" : d <= zw / 2 ? "yellow" : "miss");
      }
    };
  };

  /* SHAKE HIM OFF - one fast swipe in the shown direction */
  BUILD.swipe = function (P) {
    var DIRS = [
      { k: "UP", dx: 0, dy: -1, rot: 0 }, { k: "DOWN", dx: 0, dy: 1, rot: 180 },
      { k: "LEFT", dx: -1, dy: 0, rot: 270 }, { k: "RIGHT", dx: 1, dy: 0, rot: 90 }
    ];
    var d = pick(DIRS);
    var svg = canvas(100, 100);
    var g = el("g", { transform: "rotate(" + d.rot + " 50 50)" });
    /* chunky arrow, drawn pointing up then rotated */
    g.appendChild(el("polygon", { points: "50,16 74,44 60,44 60,80 40,80 40,44 26,44", fill: "#ffc244" }));
    svg.appendChild(g);
    var t = 0, sx = 0, sy = 0, downT = -1;
    return {
      step: function (dt) {
        t += dt; P.bar(1 - t / P.limit);
        if (t >= P.limit) finish("miss");
      },
      down: function (e) { var p = localPt(e); sx = p.x; sy = p.y; downT = t; },
      up: function (e) {
        if (downT < 0) return;
        var p = localPt(e), dx = p.x - sx, dy = p.y - sy;
        if (Math.sqrt(dx * dx + dy * dy) < P.dist) { downT = -1; return; }  /* too short - let them try again */
        var ok = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? d.dx === 1 : d.dx === -1)
          : (dy > 0 ? d.dy === 1 : d.dy === -1);
        if (!ok) { finish("miss"); return; }
        finish((t - downT) <= P.fast ? "white" : "yellow");
      }
    };
  };

  /* TRACE THE LOCK - drag through the lit dots in order */
  /* HOLD YOUR NERVE - he tells you to hold on or to keep your hands off, and
     you obey until the bar empties. Obey the whole way and you counter. Break
     it early and he lands one. Break it in the last moments and you only block:
     you flinched, but late enough to get an arm up. */
  BUILD.nerve = function (P) {
    var hold = Math.random() < 0.5;
    var hue = hold ? "#ffc244" : "#8fd8ff";
    var svg = canvas(100, 100);
    svg.appendChild(el("circle", { cx: 50, cy: 50, r: 34, fill: "none",
      stroke: hue, "stroke-width": 5, opacity: ".22" }));
    var C = 2 * Math.PI * 34;
    var arc = el("circle", { cx: 50, cy: 50, r: 34, fill: "none", stroke: hue,
      "stroke-width": 5, "stroke-linecap": "round", transform: "rotate(-90 50 50)",
      "stroke-dasharray": C });
    svg.appendChild(arc);
    [[hold ? "HOLD" : "HANDS", 47], [hold ? "IT" : "OFF", 63]].forEach(function (w) {
      var t = el("text", { x: 50, y: w[1], "text-anchor": "middle", "font-size": "13",
        fill: hue, "font-family": "Silkscreen, monospace" });
      t.textContent = w[0]; svg.appendChild(t);
    });

    var t = 0, held = false, broke = false;
    function late() { return t >= P.limit * (1 - P.grace); }
    function slip() { broke = true; finish(late() ? "yellow" : "miss"); }
    return {
      step: function (dt) {
        t += dt;
        var left = 1 - t / P.limit;
        arc.setAttribute("stroke-dashoffset", C * (1 - Math.max(0, left)));
        P.bar(left);
        if (broke) return;
        if (hold && !held && t > 0.4) { slip(); return; }   /* told to hold, never did */
        if (t >= P.limit) finish("white");                  /* obeyed all the way */
      },
      down: function () {
        if (broke) return;
        if (hold) { held = true; SFX.tick(); return; }
        slip();                                             /* hands off, and you touched */
      },
      up:     function () { if (!broke && hold && held) { held = false; slip(); } },
      cancel: function () { if (!broke && hold && held) { held = false; slip(); } }
    };
  };

  /* HAMMER IT - N taps before the bar empties */
  BUILD.taps = function (P) {
    bodyEl.innerHTML = "";
    var box = document.createElement("div");
    box.className = "qte-count";
    bodyEl.appendChild(box);
    var need = P.taps, got = 0, t = 0;
    var paint = function () { box.textContent = Math.max(0, need - got); };
    paint();
    return {
      step: function (dt) {
        t += dt; P.bar(1 - t / P.limit);
        if (t >= P.limit) finish(got >= need ? "white" : got >= Math.ceil(need * 0.6) ? "yellow" : "miss");
      },
      down: function () {
        got++; paint();
        box.classList.remove("hit"); void box.offsetWidth; box.classList.add("hit");
        SFX.tick();
        if (got >= need) finish("white");
      }
    };
  };

  /* ---- tuning ---------------------------------------------------------
     Challenges tighten on the same curve the dial follows. hard runs 0..1
     across the endless curve and is derived from CURVE_* rather than hard
     numbers, so retuning the curve cannot silently skew the QTEs. */
  function params(key) {
    var c = curveFor(G.lvl), r = Math.min(G.round, ROUND_RAMP_CAP);
    var span = (CURVE_END.speed - CURVE_START.speed) || 1;
    var hard = clamp((c.speed - CURVE_START.speed) / span + (r - 1) * 0.04, 0, 1.15);
    var bar = function (f) {
      var v = clamp(f, 0, 1);
      barEl.style.width = (v * 100) + "%";
      barEl.className = v < 0.28 ? "low" : "";
    };
    var base = { bar: bar };
    if (key === "circle") {
      base.limit = 1.9 - 0.6 * hard;           /* less time for the ring to land */
      base.core = 2.2 - 0.6 * hard;            /* a much thinner perfect band */
      base.band = 6.4 - 1.8 * hard;
    } else if (key === "line") {
      base.limit = 3.2 - 1.3 * hard;           /* less time to read the sweep */
      base.speed = 62 + 52 * hard;             /* and it crosses faster */
      base.core = 9 - 3.6 * hard;
      base.band = 27 - 10 * hard;
    } else if (key === "swipe") {
      base.limit = 1.05 - 0.42 * hard;         /* react and commit, no dithering */
      base.fast = 0.24 - 0.10 * hard;          /* only a genuine flick counts */
      base.dist = 64 + 26 * hard;              /* and it has to travel further */
    } else if (key === "nerve") {
      base.limit = 1.6 + 0.9 * hard;      /* longer to sit still, or to hold on */
      base.grace = 0.30 - 0.15 * hard;    /* the late window that saves you */
    } else if (key === "taps") {
      base.limit = 2.2 - 0.35 * hard;          /* the window closes too */
      base.taps = Math.round(7 + 5.5 * hard);
    }
    /* GRIP widens every forgiving window, not just the dial's */
    var grip = 1 + RUN.up.grip * GRIP_BONUS;
    if (base.core) base.core *= grip;
    if (base.band) base.band *= grip;
    if (base.fast) base.fast *= grip;
    return base;
  }

  return {
    start: function (key, cb) {
      wire();
      onDone = cb;
      var P = params(key);
      P.key = key;
      hintEl.textContent = QTE_HINT[key] || "";
      barEl.style.width = "100%"; barEl.className = "";
      host.hidden = false;
      document.body.classList.add("qte-on");
      cur = BUILD[key](P);
      cur._limit = P.limit; cur._t = 0;
    },
    step: function (dt) {
      if (!cur) return;
      cur._t += dt;
      /* keep his telegraph coiling in step with the challenge */
      if (foe) foe.wind = clamp(cur._t / cur._limit, 0, 1);
      if (cur.step) cur.step(dt);
    },
    active: function () { return !!cur; },
    abort: function () {
      if (cur) { cur = null; onDone = null; host.hidden = true; bodyEl.innerHTML = ""; }
      document.body.classList.remove("qte-on");
    }
  };
})();

/* ============================================================
   BATTLE
   phases: menu | attack | defend | qte | special | resolve | over
============================================================ */
var G = {
  phase: "menu", round: 0, lvl: 1, boss: false,
  youHP: 3, youMax: 3, foeHP: 60, foeMax: 60,
  marker: 0, zoneCenter: 0, zone: 64, perfect: 22, speed: 190, spinT: 0, spinLimit: 0,
  special: 0, spLeft: 0, spDmg: 0, spAll: true, spMissed: false, spHits: SPECIAL_HITS,
  foeFav: null, qteKind: null, softened: 0, countT: 0, countShown: 0,
  major: false, debuff: null,
  offerT: 0, offered: false,
  banked: 0, bankPct: 0, burn: 0, chill: 0, confuse: 0,
  hits: 0, perfects: 0, misses: 0, blocks: 0, counters: 0, dealt: 0,
  shake: 0, resolveT: 0, resolveLen: 1.0, after: null
};

function pause(len, fn) { G.phase = "resolve"; G.resolveT = 0; G.resolveLen = len; G.after = fn; renderSpecial(); }

/* ---- pause (v1.3) ----
   A hard freeze: the frame loop stops advancing the dial, the resolve timers
   and the fighters, so nothing can land or expire behind the overlay. Only
   valid mid-fight - there is nothing to pause in the hub or on the results. */
var PAUSED = false;
function canPause() {
  return G.phase !== "menu" && G.phase !== "over" && $("pit").hidden && $("over").hidden;
}
function setPaused(on) {
  if (on === PAUSED) return;
  if (on && !canPause()) return;
  PAUSED = on;
  $("paused").hidden = !on;
  $("pause-btn").classList.toggle("on", !on && canPause());
  if (on) {
    $("pause-stat").textContent =
      "LV " + G.lvl + " - ROUND " + G.round + "\n" +
      "HIS HEALTH " + Math.max(0, Math.round(G.foeHP)) + " / " + G.foeMax + "\n" +
      "YOUR HEARTS " + G.youHP + " / " + G.youMax + " - DAMAGE " + G.dealt;
  }
}
/* forfeit: settle it exactly like a defeat so quitting can never be used to
   dodge a streak reset when a fight is going badly */
function quitFight() {
  if (!PAUSED) return;
  PAUSED = false;
  $("paused").hidden = true;
  $("pause-btn").classList.remove("on");
  finish(false);
}

function beginBattle() {
  var lvl = foeLevel(), d = spawnFoe(lvl);
  G.lvl = lvl; G.boss = isBoss(lvl);
  G.foeFav = d.fav; G.qteKind = null;
  G.major = isMajor(lvl);
  G.debuff = G.major ? pick(MAJOR_DEBUFFS).k : null;
  G.youMax = youMaxHP();
  /* hearts persist across the run - only hitting zero puts them back */
  G.youHP = (RUN.hp === null) ? G.youMax : clamp(RUN.hp, 0, G.youMax);
  if (G.youHP <= 0) G.youHP = G.youMax;
  if (G.debuff === "frail") G.youHP = Math.max(1, G.youHP - 1);
  G.foeMax = foeMaxHP(lvl); G.foeHP = G.foeMax;
  G.softened = 0;
  if (G.boss && RUN.soften > 0) {             /* spend the blessing on this boss */
    G.softened = RUN.soften;
    G.foeHP = Math.max(1, Math.round(G.foeMax * (1 - RUN.soften)));
    RUN.soften = 0; save();
  }
  G.round = 0; G.special = 0; G.banked = 0; G.bankPct = 0; G.burn = 0; G.chill = 0; G.confuse = 0; G.offered = false;
  G.hits = G.perfects = G.misses = G.blocks = G.counters = G.dealt = 0;
  you.group.rotation.set(0, Math.PI / 2, 0); you.group.position.set(-2.05, 0, 0);
  tintHurt(you, 0); setAnim(you, "idle"); setAnim(foe, "idle");
  applyOutfitLook();
  $("foe-name").textContent = d.n;
  $("foe-sub").textContent = (G.boss ? "BOSS - LV " : "LV ") + lvl + " - " + DIFFS[RUN.diff].key;
  renderHearts(hpYouEl, G.youHP, G.youMax, "#6f8cff");
  renderShield();
  renderFoeHP(); renderSpecial();
  $("pause-btn").classList.add("on");
  if (G.boss) startCountdown(); else startAttack();
}

function spinSpeed(base) {
  var s = base;
  if (G.chill > 0) s *= CHILL_SPEED;
  return s;
}
function newSpin(speedMul, zoneMul) {
  var C = curveFor(G.lvl), lvlF = 1 + (G.lvl - 1) * 0.055;
  var r = Math.min(G.round, ROUND_RAMP_CAP);      /* stop ramping past the cap */
  var cap = SPEED_CAP - RUN.up.steady * STEADY_STEP;
  var raw = Math.min(cap, (270 + (r - 1) * RAMP_SPEED) * C.speed * lvlF * (speedMul || 1));
  if (G.debuff === "rushed") raw *= 1.18;
  G.speed = spinSpeed(raw);
  var zBase = Math.max(ARC_FLOOR, ARC_BASE - (r - 1) * ARC_SHRINK);
  G.zone = clamp(zBase * C.zone * (1 + RUN.up.grip * GRIP_BONUS) * (zoneMul || 1) *
                 (G.debuff === "narrow" ? 0.68 : 1), 12, 95);
  G.perfect = clamp(G.zone * 0.32 * (1 + RUN.up.focus * FOCUS_BONUS), 5, G.zone * 0.75);
  G.zoneCenter = rnd(0, 360);
  G.marker = (G.zoneCenter + 180 + rnd(-45, 45) + 360) % 360;
  G.spinT = 0; G.spinLimit = SPIN_SECONDS + RUN.up.clock * CLOCK_STEP;
}

/* Boss fights open on 3..2..1 so the first swing is not a surprise. */
function startCountdown() {
  G.phase = "count"; G.countT = 0; G.countShown = 0;
  hubR.textContent = ""; hubL.textContent = "";
  phaseEl.className = "def";
  if (G.major) {
    var db = null, i;
    for (i = 0; i < MAJOR_DEBUFFS.length; i++) if (MAJOR_DEBUFFS[i].k === G.debuff) db = MAJOR_DEBUFFS[i];
    phaseEl.textContent = "MAJOR BOSS - " + (db ? db.name + ": " + db.line : "");
    SFX.major();
  } else {
    phaseEl.textContent = G.softened ? "BOSS - HE CAME IN WOUNDED" : "BOSS INCOMING";
  }
  $("hint").textContent = "";
  setAnim(you, "guard"); setAnim(foe, "idle");
  $("countdown").hidden = false;
  $("count-n").textContent = COUNT_FROM;
  G.countShown = COUNT_FROM;
  SFX.tick();
}
function stepCountdown(dt) {
  G.countT += dt;
  var n = COUNT_FROM - Math.floor(G.countT);
  if (n !== G.countShown && n > 0) {
    G.countShown = n;
    var el = $("count-n");
    el.textContent = n;
    el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
    SFX.tick();
  }
  if (G.countT >= COUNT_FROM) {
    $("countdown").hidden = true;
    if (G.softened) callout("-" + Math.round(G.softened * 100) + "% HEALTH", "#8fd8ff");
    SFX.charge();
    startAttack();
  }
}

function startAttack() {
  G.round++;
  newSpin(1, 1);
  hubR.textContent = G.round; hubL.textContent = "ROUND";
  setAnim(you, "windup"); setAnim(foe, "idle");
  /* charged? freeze the dial briefly so the special is a real decision
     rather than something you fumble for while the marker is running */
  if (G.special >= 100 && !G.offered) {
    G.offered = true;                 /* prompt once per charge, not every turn */
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
  if (G.confuse > 0) {                    /* spun round - his swing goes nowhere */
    G.confuse--;
    renderFoeHP();
    setAnim(foe, "windup");
    phaseEl.className = "def"; phaseEl.textContent = "HE IS CONFUSED - THE SWING GOES WIDE";
    $("hint").textContent = "";
    G.phase = "wait";
    setTimeout(function () {
      setAnim(foe, "slam"); SFX.whiff();
      callout("HE MISSES", "#c39bff");
      addCharge(CHARGE.block);
    }, 260);
    pause(1.15, afterDefend);
    return;
  }
  var key = rollQTE(G.foeFav);
  G.qteKind = key;
  setAnim(foe, "windup"); setAnim(you, "guard");
  phaseEl.className = "def";
  renderSpecial();
  if (key === "normal") {                       /* the dial is simply one of the six */
    newSpin(1.05, 0.95);
    G.phase = "defend";
    hubL.textContent = "GUARD";
    phaseEl.textContent = "HIS SWING - GOLD BLOCKS, WHITE COUNTERS";
    $("hint").textContent = "GOLD = BLOCK   WHITE = COUNTER";
    return;
  }
  G.phase = "qte";
  $("dial-wrap").hidden = true;
  phaseEl.textContent = "HIS SWING - " + QTE_LABEL[key];
  $("hint").textContent = "CLEAN = COUNTER   SCRAPPY = BLOCK";
  QTE.start(key, function (kind) {
    $("dial-wrap").hidden = false;
    G.phase = "wait";
    resolveDefend(kind);
  });
}
function startSpecialSpin() {
  newSpin(1.15 * (allyDef().spSpeed || 1), 0.9);
  G.phase = "special";
  hubR.textContent = (G.spHits - G.spLeft + 1) + "/" + G.spHits;
  hubL.textContent = "SPECIAL";
  phaseEl.className = "spc"; phaseEl.textContent = "SPECIAL - " + G.spLeft + " SLAMS LEFT";
  if (you.anim.name !== "windup") setAnim(you, "windup");   /* keep the coil, don't restart it */
  $("hint").textContent = "KEEP SLAMMING - ALL WHITE = x" + SPECIAL_ALL_WHITE;
  phaseEl.textContent = allyDef().name + " SPECIAL - " + G.spLeft + " LEFT";
  renderSpecial();
}

function judge() {
  var b = bandAt(Math.abs(angDiff(G.marker, G.zoneCenter)), G.zone / 2, G.perfect / 2);
  return b === 2 ? "white" : (b === 1 ? "yellow" : "miss");
}

/* ---- glove / outfit effects ---- */
function gloveProc(isWhite) {
  var g = equipped("gloves");
  if (!g) return null;
  if (g.stat === "power") return null;                        // flat power, handled in damage
  if (!allyAllows("gloves", g)) return null;
  var chance = (g.val + (isWhite ? WHITE_PROC_BONUS : 0)) / 100 * allyDef().procMul * luckBoot();
  return Math.random() < chance ? g.stat : null;
}
/* Only the special used to scale per ally. The Expeditioner needs the plain
   slam and the counter scaled too; everyone else leaves these at 1. */
var atkMul = function () { var a = allyDef(); return a.atk || 1; };
var cntMul = function () { var a = allyDef(); return (a.cnt === 0 ? 0 : (a.cnt || 1)) * counterBoot(); };
function attackDamage(isWhite) {
  var d = ((isWhite ? DMG.white : DMG.yellow) + powerBonus()) * powerFor(G.lvl) * atkMul();
  var g = equipped("gloves");
  if (g && g.stat === "power" && allyAllows("gloves", g)) d *= g.val;
  if (G.banked > 0) { d += G.banked * (isWhite ? ABSORB_WHITE : 1); G.banked = 0; }
  if (G.bankPct > 0) { d *= 1 + G.bankPct / 100; G.bankPct = 0; }   /* spent on this swing */
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
  G.burn--;
  var dmg = Math.max(1, Math.round(G.foeMax * BURN_PCT));
  G.foeHP = Math.max(0, G.foeHP - dmg);
  G.dealt += dmg;
  floatDmg("-" + dmg + " BURN", "#ff9a3c", "foe");
  renderFoeHP(); SFX.burn(); tintBurn(foe, .5);
  setTimeout(function () { if (foe) tintBurn(foe, 0); }, 260);
}
function renderShield() {
  var node = $("shield-row");
  node.innerHTML = "";
  for (var i = 0; i < RUN.shield; i++) {
    var p = document.createElement("i"); p.className = "shield-pip"; node.appendChild(p);
  }
}
function loseHeart() {
  if (RUN.shield > 0) {                       /* blessing soaks it first */
    RUN.shield--; save(); renderShield();
    SFX.block(); callout("SHIELD HELD", "#8fd8ff");
    return;
  }
  G.youHP--;
  renderHearts(hpYouEl, G.youHP, G.youMax, "#6f8cff");
  pop(hpYouEl, G.youMax - G.youHP);
}

/* ---- resolve: your attack ---- */
function resolveAttack(kind) {
  if (kind === "miss" && G.bankPct > 0) {      /* nothing landed - the bank is gone */
    G.bankPct = 0;
    callout("BANK LOST", "#8d8397");
  }
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
    else if (proc === "burn") { G.burn = BURN_TURNS; callout("BURNING", "#ff9a3c"); renderFoeHP(); }
    else if (proc === "confuse") { G.confuse = 1; callout("CONFUSED", "#c39bff"); renderFoeHP(); }
    else callout(white ? "PERFECT SLAM" : "HIT", white ? "#ffc244" : "#f2ede1");
  }, 150);
  pause(1.05, afterAttack);
}
function afterAttack() {
  if (G.foeHP <= 0) { finish(true); return; }
  if (G.youHP <= 0) { finish(false); return; }   /* the Gambler can end you here */
  startDefend();
}

/* ---- resolve: his swing ---- */
function resolveDefend(kind) {
  /* a fighter with no counter gets an arm up instead - a clean read still
     saves him, it just never turns into a punch back */
  if (kind === "white" && allyDef().cnt === 0) kind = "yellow";
  burnTick();
  if (G.foeHP <= 0) { pause(0.7, function () { finish(true); }); return; }

  setAnim(foe, "slam");
  if (kind === "white") {                                   /* COUNTER */
    G.counters++;
    addCharge(CHARGE.counter);
    setTimeout(function () {
      setAnim(foe, "hurt"); burst(.6, 1.78, 0, C.torch); shake(1.4); SFX.counter();
      dealToFoe(Math.round((DMG.counter + powerBonus()) * powerFor(G.lvl) * cntMul()), "#ffc244", "");
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
  if (!allyAllows("outfit", o)) o = null;
  var saved = null;
  if (o && Math.random() < o.val / 100 * luckBoot()) saved = o.stat;
  setTimeout(function () {
    if (saved === "counter") {
      G.counters++; addCharge(CHARGE.counter);
      setAnim(foe, "hurt"); burst(.6, 1.78, 0, C.torch); shake(1.3); SFX.counter();
      dealToFoe(Math.round((DMG.counter + powerBonus()) * powerFor(G.lvl) * cntMul()), "#ffc244", "");
      callout("OUTFIT COUNTER", "#ffc244");
    } else if (saved === "evade") {
      setAnim(you, "evade"); SFX.evade();
      callout("EVADED", "#8fd8ff");
    } else if (saved === "absorb") {
      G.bankPct = o.val; SFX.absorb();
      callout("ABSORBED +" + o.val + "%", "#8fd8ff");
      floatDmg("+" + o.val + "% BANKED", "#8fd8ff", "you");
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
  if (kind === "miss") { G.spAll = false; G.spMissed = true; G.misses++; SFX.whiff(); }
  else {
    G.hits++; if (white) G.perfects++; else G.spAll = false;
    G.spDmg += (white ? DMG.white : DMG.yellow) + powerBonus();
    if (white) SFX.perfect(); else SFX.hit();
  }
  G.spLeft--;
  if (G.spLeft > 0) {
    /* mid-combo: hold the coil, don't swing yet - just a jolt of feedback */
    if (kind !== "miss") {
      burst(.55, 1.8, 0, white ? C.torch : C.plank);
      shake(white ? .8 : .5);
    }
    callout(kind === "miss" ? "MISS" : (white ? "WHITE" : "GOLD"), kind === "miss" ? "#8d8397" : (white ? "#ffc244" : "#f2ede1"));
    pause(0.34, startSpecialSpin);
    return;
  }
  /* final blow - the one and only swing of the combo */
  setAnim(you, "slam");
  var A = allyDef();
  var total;
  if (A.execute && G.spAll) {
    total = Math.max(1, Math.ceil(G.foeHP));        /* flawless = an execution */
  } else {
    /* Kevin's mult is the price of a dropped spin, so he skips the all-white
       bonus entirely - his payoff is the execute, not a multiplier stack. */
    total = Math.round(G.spDmg * (A.execute ? 1 : (G.spAll ? SPECIAL_ALL_WHITE : 1)) * powerFor(G.lvl) * A.mult);
  }
  if (!(A.execute && G.spAll)) {
    var g = equipped("gloves");
    if (g && g.stat === "power" && allyAllows("gloves", g)) total = Math.round(total * g.val);
    if (G.banked > 0) { total += Math.round(G.banked * (G.spAll ? ABSORB_WHITE : 1)); G.banked = 0; }
  } else { G.banked = 0; }
  G.special = 0; renderSpecial();
  setTimeout(function () {
    setAnim(foe, "hurt");
    specialBurst(.6, 1.9, 0);
    if (G.spAll) specialBurst(.2, 2.3, 0);          /* flawless gets a second wave */
    shake(2.2); SFX.special();
    dealToFoe(total, "#ffc244", (A.execute && G.spAll) ? " FINISH" : (G.spAll && !A.execute ? " x" + SPECIAL_ALL_WHITE : ""));
    callout((A.execute && G.spAll) ? "EXECUTED" : (G.spAll && !A.execute ? "FLAWLESS SPECIAL x" + SPECIAL_ALL_WHITE : "SPECIAL SLAM"), "#ffc244");
    if (A.curse && G.foeHP > 0) {              /* the house deals one off the bottom */
      setTimeout(function () {
        var c = pick(["confuse", "burn", "chill"]);
        if (c === "confuse") { G.confuse = 1; callout("CONFUSED", "#c39bff"); }
        else if (c === "burn") { G.burn = BURN_TURNS; callout("BURNING", "#ff9a3c"); }
        else { G.chill = CHILL_SPINS; callout("CHILLED", "#8fd8ff"); }
        renderFoeHP();
      }, 700);
    }
    if (A.risk && G.spMissed) {                /* only a whiff pays the house */
      setTimeout(function () {
        if (A.dodge && Math.random() < A.dodge) {
          SFX.evade(); callout("THE HOUSE BLINKS", "#8fd8ff");
          return;
        }
        setAnim(you, "hurt"); SFX.counter(); shake(1.4);
        loseHeart();
        if (G.youHP <= 0 && G.foeHP <= 0) {
          /* the wager took his last heart, but the man across the table went
             down with him - the table pays out and he walks away whole */
          G.youHP = G.youMax;
          renderHearts(hpYouEl, G.youHP, G.youMax, "#6f8cff");
          SFX.gem();
          callout("THE HOUSE PAYS OUT", "#ffc244");
        } else {
          callout("THE HOUSE COLLECTS", "#e0453a");
        }
      }, 420);
    }
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
  G.spHits = allyDef().hits;
  G.spLeft = G.spHits; G.spDmg = 0; G.spAll = true; G.spMissed = false;
  G.offered = false;                  /* next time it fills, prompt again */
  spBtn.classList.remove("on");
  SFX.charge();
  startSpecialSpin();
}

function finish(won) {
  G.phase = "over";
  QTE.abort(); $("dial-wrap").hidden = false;
  $("countdown").hidden = true;
  PAUSED = false; $("paused").hidden = true;
  $("pause-btn").classList.remove("on");
  phaseEl.textContent = "";
  setAnim(won ? foe : you, "down");
  setTimeout(function () { won ? SFX.win() : SFX.lose(); }, 250);
  if (window.Ads && window.Ads.onFightFinished) window.Ads.onFightFinished();

  var D = DIFFS[RUN.diff], earned, gemsWon = 0;
  if (won) {
    earned = Math.round((22 + G.lvl * 6 + G.perfects * 3 + G.counters * 4 + G.youHP * 5) * D.reward);
    if (G.boss) { earned = Math.round(earned * 1.5); gemsWon = 1; RUN.boon = true; }
    RUN.streak++; RUN.best = Math.max(RUN.best, RUN.streak);
    RUN.hp = G.youHP;                          /* walk to the next fight as you are */
    /* every boss - each 5th level - patches you up by one heart */
    if (G.boss) RUN.hp = Math.min(youMaxHP(), RUN.hp + 1);
  } else {
    earned = Math.round((6 + G.lvl * 3) * D.reward);
    RUN.streak = 0;
    RUN.hp = null;                             /* back to level 1, hearts restored */
    RUN.up = { hearts: 0, grip: 0, power: 0, focus: 0, mastery: 0, steady: 0, clock: 0 };   /* training is per run */
    clearBoons();                              /* temporary means temporary */
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
    G.marker = (G.marker + G.speed * dt) % 360; G.spinT += dt;
    if (G.phase === "special") {
      /* one continuous wind-up across all four spins - the arm keeps coiling
         instead of resetting on every tap, and only releases on the last */
      var done = G.spHits - G.spLeft;
      you.wind = clamp((done + G.spinT / G.spinLimit) / G.spHits, 0, 1);
    } else {
      var att = G.phase === "defend" ? foe : you;
      if (att) att.wind = clamp(G.spinT / G.spinLimit, 0, 1);
    }
    if (Math.abs(angDiff(b, G.zoneCenter)) > G.zone / 2 && Math.abs(angDiff(G.marker, G.zoneCenter)) <= G.zone / 2) SFX.tick();
    if (G.spinT >= G.spinLimit) {
      if (G.phase === "attack") resolveAttack("miss");
      else if (G.phase === "defend") resolveDefend("miss");
      else resolveSpecialHit("miss");
    }
  } else if (G.phase === "count") {
    stepCountdown(dt);
  } else if (G.phase === "qte") {
    QTE.step(dt);
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
  { k: "normal", name: "NORMAL CHEST", cur: "coins", cost: 1500,
    odds: "70% common - 10% rare - 5% epic - 1% legendary - 14% gold",
    table: [["common", 70], ["rare", 10], ["epic", 5], ["legendary", 1], ["gold", 14]] },
  { k: "ad", name: "AD CHEST", cur: "ad", cost: 0, daily: true,
    odds: "50% common - 35% rare - 10% epic - 5% legendary - once a day",
    table: [["common", 50], ["rare", 35], ["epic", 10], ["legendary", 5]] },
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
  if (ch.cur === "ad") {                       /* paid for with an ad, once a day */
    if (!adChestReady()) { SFX.nope(); return; }
    var btnBusy = false;
    var grant = function (ok) {
      if (btnBusy) return; btnBusy = true;
      if (!ok) { SFX.nope(); return; }
      RUN.adDay = today(); save();
      rollChest(ch);
    };
    if (window.Ads && window.Ads.showRewarded) {
      window.Ads.showRewarded().then(grant).catch(function () { grant(false); });
      setTimeout(function () { grant(false); }, 190000);
    } else setTimeout(function () { grant(true); }, 500);
    return;
  }
  var have = ch.cur === "coins" ? RUN.coins : RUN.gems;
  if (have < ch.cost) { SFX.nope(); return; }
  if (ch.cur === "coins") RUN.coins -= ch.cost; else RUN.gems -= ch.cost;
  rollChest(ch);
}
function rollChest(ch) {
  var result = rollTable(ch.table);
  var res;
  if (result === "gold") {
    var bonus = rndInt(120, 340);
    RUN.coins += bonus;
    res = { gold: bonus };
  } else {
    var kind = pick(["outfit", "gloves", "boots"]);
    var type = pick(kind === "outfit" ? OUTFITS : (kind === "boots" ? BOOTS : GLOVES)).t;
    var item = makeItem(kind, type, result, false);
    /* find the best copy already owned of this exact item and tier */
    var bestIdx = -1, best = null;
    RUN.inv.forEach(function (it, idx) {
      if (it.kind === item.kind && it.type === item.type && it.tier === item.tier) {
        if (!best || it.val > best.val) { best = it; bestIdx = idx; }
      }
    });
    if (best && best.val >= item.val) {
      /* duplicate - never enters the wardrobe, straight to coin */
      var paid = DUPE_VALUE[item.tier] || 0;
      RUN.coins += paid;
      res = { item: item, sold: paid };
    } else if (best) {
      /* better roll - keep it and sell the older, weaker copy */
      var paidOld = DUPE_VALUE[best.tier] || 0;
      RUN.coins += paidOld;
      var wasEquipped = RUN.equip[item.kind] === best.uid;
      RUN.inv.splice(bestIdx, 1);
      RUN.inv.push(item);
      if (wasEquipped) RUN.equip[item.kind] = item.uid;   /* don't unequip the player */
      res = { item: item, sold: paidOld, upgraded: best.val };
    } else {
      RUN.inv.push(item);
      res = { item: item };
    }
  }
  save();
  renderPit();
  /* the roll is already decided - the reel just plays it back */
  runCaseReel(ch, res, function () {
    if (res.gold) SFX.coin();
    else { SFX.buy(); if (res.item.tier === "legendary") SFX.gem(); }
    showReveal(res);
  });
}
/* ------------------------------------------------------------
   CASE OPENING REEL
   A strip of candidate items scrolls past a centre marker and eases
   to a stop with the real drop under it. Purely cosmetic - the roll
   already happened, this just shows it.
------------------------------------------------------------ */
var REEL_CELL = 116;        // 110px cell + 6px gap
var REEL_LEN = 58;          // cells built
var REEL_WIN = 48;          // index the real drop sits at
var REEL_MS = 4200;         // spin duration
var reelBusy = false, reelDone = null, reelSettle = null;

function reelCellEl(tier, label, isCoin) {
  var d = document.createElement("div");
  d.className = "reel-cell";
  var meta = TIER[tier];
  d.style.borderBottomColor = isCoin ? "#c9922a" : meta.color;
  var chip = document.createElement("span");
  chip.className = "rc-tier";
  chip.style.background = isCoin ? "#c9922a" : meta.color;
  chip.textContent = isCoin ? "GOLD" : meta.name;
  d.appendChild(chip);
  if (isCoin) { var ic = coinIcon(); ic.setAttribute("class", "rc-icon"); d.appendChild(ic); }
  var n = document.createElement("div");
  n.className = "rc-name"; n.textContent = label;
  d.appendChild(n);
  return d;
}

/* a plausible-looking filler drop for this chest */
function reelFiller(chest) {
  var t = rollTable(chest.table);
  if (t === "gold") return { gold: true, tier: "common", label: "COIN" };
  var kind = Math.random() < 0.5 ? "outfit" : "gloves";
  var def = pick(kind === "outfit" ? OUTFITS : GLOVES);
  return { gold: false, tier: t, label: def.name };
}

function runCaseReel(chest, res, done) {
  var reel = $("reel"), win = document.querySelector(".reel-window");
  $("case-name").textContent = chest.name;
  reel.innerHTML = "";
  var i, cells = [];
  for (i = 0; i < REEL_LEN; i++) {
    if (i === REEL_WIN) {
      cells.push(res.gold
        ? { gold: true, tier: "common", label: "+" + res.gold + " COIN" }
        : { gold: false, tier: res.item.tier, label: itemName(res.item) });
    } else cells.push(reelFiller(chest));
  }
  cells.forEach(function (c) { reel.appendChild(reelCellEl(c.tier, c.label, c.gold)); });

  $("case").hidden = false;
  win.classList.remove("landed");

  var winW = win.clientWidth || 560;
  var jitter = rnd(-38, 38);                       /* don't always land dead centre */
  var target = REEL_WIN * REEL_CELL + REEL_CELL / 2 - winW / 2 + jitter;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  reelDone = done;
  function settle(fast) {
    reel.style.transform = "translateX(" + (-target) + "px)";
    win.classList.add("landed");
    reelBusy = false;
    setTimeout(function () {
      $("case").hidden = true;
      var d = reelDone; reelDone = null;
      if (d) d();                                  /* fires once, skip or not */
    }, fast ? 120 : 620);
  }
  reelSettle = settle;
  if (reduced) { settle(true); return; }

  var t0 = performance.now(), lastCell = -1, lastTick = 0;
  reelBusy = true;
  (function frame(now) {
    var t = clamp((now - t0) / REEL_MS, 0, 1);
    var e = 1 - Math.pow(1 - t, 4);                /* hard ease-out, CS-style */
    var x = target * e;
    reel.style.transform = "translateX(" + (-x) + "px)";
    var cell = Math.floor((x + winW / 2) / REEL_CELL);
    if (cell !== lastCell && now - lastTick > 28) { lastCell = cell; lastTick = now; SFX.tick(); }
    if (!reelBusy) return;                          /* skipped */
    if (t < 1) requestAnimationFrame(frame); else settle();
  })(t0);
}
/* tap during the spin to jump straight to the result */
function skipReel() {
  if (!reelBusy || !reelSettle) return;
  reelBusy = false;
  reelSettle(true);
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
    if (res.sold) {
      var sold = document.createElement("div");
      sold.className = "rv-sold";
      sold.appendChild(coinIcon());
      sold.appendChild(document.createTextNode(
        (res.upgraded !== undefined ? "UPGRADED - OLD ONE SOLD  +" : "DUPLICATE - SOLD  +") + res.sold));
      card.appendChild(sold);
    }
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
    var cost = u.costs[lv], gems = u.cur === "gems", gold = u.gold || 0;
    if (u.k === "mastery" && !allyBase().mastery) { SFX.nope(); return; }
    if (u.minLvl && foeLevel() < u.minLvl) { SFX.nope(); return; }
    if ((gems ? RUN.gems : RUN.coins) < cost || RUN.coins < gold) { SFX.nope(); return; }
    if (gems) RUN.gems -= cost; else RUN.coins -= cost;
    if (gold) RUN.coins -= gold;
    RUN.up[u.k] = lv + 1;
    _adKey = "";                         /* the kit just changed - drop the cache */
    if (u.k === "hearts" && RUN.hp !== null) RUN.hp = Math.min(youMaxHP(), RUN.hp + 1);
    SFX.buy(); save(); renderPit();
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
  if (it && !allyAllows(kind, it)) it = null;
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
    if (u.label) row.querySelector(".up-name").textContent = u.label();
    if (u.detail) row.querySelector(".up-desc").textContent = u.detail();
    var pips = row.querySelector("[data-pips]");
    pips.innerHTML = "";
    for (var i = 0; i < u.max; i++) { var p = document.createElement("i"); p.className = "pip" + (i < lv ? " on" : ""); pips.appendChild(p); }
    var btn = row.querySelector("button");
    btn.innerHTML = "";
    if (lv >= u.max) { btn.textContent = "MAX"; btn.disabled = true; }
    else {
      var cost = u.costs[lv], gems = u.cur === "gems", gold = u.gold || 0;
      var blocked = (u.k === "mastery" && !allyBase().mastery) ||
                    (u.minLvl && foeLevel() < u.minLvl);
      btn.disabled = blocked || (gems ? RUN.gems : RUN.coins) < cost || RUN.coins < gold;
      btn.appendChild(gems ? gemIcon() : coinIcon());
      btn.appendChild(document.createTextNode(cost));
      if (gold) {                       /* mastery is paid in both */
        btn.appendChild(document.createTextNode(" "));
        btn.appendChild(coinIcon());
        btn.appendChild(document.createTextNode(gold));
      }
    }
  });
  Array.prototype.forEach.call(chestsEl.children, function (b) {
    var ch = b._ch, cc = b.querySelector(".cc");
    cc.innerHTML = "";
    if (ch.cur === "ad") {
      var ready = adChestReady();
      b.disabled = !ready;
      cc.appendChild(document.createTextNode(ready ? "WATCH AD" : "COME BACK TOMORROW"));
    } else {
      var have = ch.cur === "coins" ? RUN.coins : RUN.gems;
      b.disabled = have < ch.cost;
      cc.appendChild(ch.cur === "coins" ? coinIcon() : gemIcon());
      cc.appendChild(document.createTextNode(ch.cost));
    }
  });
  var strip = $("gear-strip"); strip.innerHTML = "";
  strip.appendChild(gearSlotHTML("outfit"));
  strip.appendChild(gearSlotHTML("gloves"));
  strip.appendChild(gearSlotHTML("boots"));

  var lvl = foeLevel(), d = foeFor(lvl), boss = isBoss(lvl);
  $("next-foe").className = "next-foe" + (boss ? " boss" : "");
  $("nf-name").textContent = (boss ? "BOSS: " : "") + d.n;
  var fee = entryFee(lvl), broke = RUN.coins < fee;
  var curHP = (RUN.hp === null || RUN.hp <= 0) ? youMaxHP() : Math.min(RUN.hp, youMaxHP());
  $("nf-stat").textContent = "LV " + lvl + " - " + foeMaxHP(lvl) + " HP - YOU " + curHP + "/" + youMaxHP() + " HEARTS" +
    (boss ? " - +1 GEM" : "") + (fee ? " - BUY IN " + fee : "");
  $("fight-btn").disabled = broke;
  $("fight-btn").textContent = broke ? "NEED " + fee : "Fight";
}

/* ---------- boss blessings ---------- */
function renderBoons() {
  var grid = $("boon-grid"); grid.innerHTML = "";
  BOONS.forEach(function (b) {
    var maxed = b.maxed();
    var card = document.createElement("div"); card.className = "item boon";
    card.setAttribute("data-maxed", maxed ? "true" : "false");
    var chip = document.createElement("span"); chip.className = "tier-chip";
    chip.style.background = "#8fd8ff"; chip.textContent = b.tag; card.appendChild(chip);
    var nm = document.createElement("div"); nm.className = "it-name"; nm.textContent = b.name; card.appendChild(nm);
    var ef = document.createElement("div"); ef.className = "it-eff"; ef.textContent = b.desc; card.appendChild(ef);
    var dv = document.createElement("div"); dv.className = "boon-val"; dv.textContent = b.detail(); card.appendChild(dv);
    var btn = document.createElement("button");
    btn.className = "it-btn" + (maxed ? "" : " on"); btn.type = "button";
    btn.textContent = maxed ? "ALREADY FULL" : "TAKE IT";
    btn.disabled = maxed;
    btn.addEventListener("click", function () {
      b.take();
      RUN.boon = false; save();
      SFX.gem();
      $("boons").hidden = true; renderPit(); $("pit").hidden = false;
      if (window.Ads) window.Ads.showBanner();
    });
    card.appendChild(btn); grid.appendChild(card);
  });
}

/* ---------- gallery ----------
   One page that explains the cast and the rules the cast bends. Everything
   here is read from the same data the fight uses, so it cannot drift. */
function galSection(title) {
  var h = document.createElement("div"); h.className = "sec-label";
  h.style.cssText = "text-align:center;margin:18px 0 2px"; h.textContent = title;
  return h;
}
function galCard(name, tag, lines) {
  var card = document.createElement("div"); card.className = "item ally";
  if (tag) {
    var chip = document.createElement("span"); chip.className = "tier-chip";
    chip.style.background = "#ffc244"; chip.textContent = tag; card.appendChild(chip);
  }
  var nm = document.createElement("div"); nm.className = "it-name"; nm.textContent = name;
  card.appendChild(nm);
  lines.forEach(function (t) {
    var p = document.createElement("div"); p.className = "it-eff";
    p.style.marginTop = "6px"; p.textContent = t; card.appendChild(p);
  });
  return card;
}
function renderGallery() {
  var b = $("gal-body"); b.innerHTML = "";

  /* --- how the special works --- */
  b.appendChild(galSection("HOW THE SPECIAL WORKS"));
  var g1 = document.createElement("div"); g1.className = "grid";
  g1.appendChild(galCard("THE SPECIAL BAR", "EVERY EXCHANGE", [
    "Every slam, block and counter charges the bar. At 100% the dial freezes once and asks if you want it - after that the turn plays normally and the bar waits until you tap it.",
    "Unleashing spends the whole bar and runs a combo of spins. Your fighter decides how many spins and how hard the finisher lands."
  ]));
  g1.appendChild(galCard("ALL WHITE = x" + SPECIAL_ALL_WHITE, "FLAWLESS", [
    "Land EVERY spin of the combo in the white core and the finisher deals x" + SPECIAL_ALL_WHITE + " damage on top of your fighter's own multiplier.",
    "One gold hit is enough to lose the bonus - the combo still lands, it just lands ordinary.",
    "Kevin is the exception: all six white finishes the fight outright, so he takes no x" + SPECIAL_ALL_WHITE + " on top."
  ]));
  g1.appendChild(galCard("THE GAMBLER'S WAGER", "DOUBLE OR NOTHING", [
    "His arc is inverted - a wide white band around a small gold core - and his finisher hits at x2.5.",
    "Gold is safe. Whiff a spin entirely and the machine takes a heart when the combo ends.",
    "If that heart is his last but the combo killed the man across the table, the house pays out: he wins the fight and walks away at full health."
  ]));
  b.appendChild(g1);

  /* --- the fighters --- */
  b.appendChild(galSection("YOUR FIGHTERS"));
  var g2 = document.createElement("div"); g2.className = "grid";
  ALLIES.forEach(function (a) {
    g2.appendChild(galCard(a.name, a.tag, [
      a.desc,
      a.hits + " spins - finisher x" + a.mult.toFixed(2) +
      "   slam x" + (a.atk === 0 ? 0 : (a.atk || 1)).toFixed(2) + "   counter x" + (a.cnt === 0 ? 0 : (a.cnt || 1)).toFixed(2) +
      "   charge x" + a.charge.toFixed(2) + "   glove procs x" + a.procMul
    ]));
  });
  b.appendChild(g2);

  /* --- the roster --- */
  b.appendChild(galSection("THE ROSTER"));
  var note = document.createElement("div"); note.className = "boon-note";
  note.textContent = "His swing is one of six reflex tests, rolled fresh each turn. Every man has a " +
                     "favourite he throws " + QTE_FAV_BONUS + " points more often than an even split - " +
                     (100 / QTE_TYPES.length + QTE_FAV_BONUS).toFixed(1) + "% against " +
                     (100 / QTE_TYPES.length).toFixed(1) + "% for the rest.";
  b.appendChild(note);
  var g3 = document.createElement("div"); g3.className = "grid";
  FOES.forEach(function (f) {
    g3.appendChild(galCard(f.n, f.fav ? "FAVOURITE - " + QTE_LABEL[f.fav] : "NO FAVOURITE", [
      f.lore || "",
      f.fav ? (QTE_LABEL[f.fav] + " - " + (QTE_HINT[f.fav] || "").toLowerCase())
            : "Throws all six evenly. Nothing to read, nothing to lean on."
    ]));
  });
  b.appendChild(g3);
}

/* ---------- settings ---------- */
var OPTIONS = [
  { k: "perf", name: "PERFORMANCE MODE", invert: true,
    on: "Shadows off and a lower render resolution. Turn this on if the game stutters.",
    off: "Full quality - shadows and full resolution." },
  { k: "music", name: "MUSIC",
    on: "The pit theme plays under the fight.",
    off: "No theme. Sound effects are unaffected." },
  { k: "sfx", name: "SOUND EFFECTS",
    on: "Slams, counters, chests and the dial all make noise.",
    off: "Silent except the theme." },
  { k: "fx", name: "PARTICLE EFFECTS",
    on: "Debris, screen shake and the hit flash are on.",
    off: "No debris, no shake, no flash - the dial and the fighters only." }
];
function renderSettings() {
  var grid = $("set-grid"); grid.innerHTML = "";
  OPTIONS.forEach(function (o) {
    /* most options are "on by default"; PERFORMANCE MODE is off by default */
    var on = o.invert ? RUN[o.k] === true : RUN[o.k] !== false;
    var card = document.createElement("div"); card.className = "item ally" + (on ? " eq" : "");
    var chip = document.createElement("span"); chip.className = "tier-chip";
    chip.style.background = on ? "#ffc244" : "#5b5266";
    chip.textContent = on ? "ON" : "OFF"; card.appendChild(chip);
    var nm = document.createElement("div"); nm.className = "it-name"; nm.textContent = o.name; card.appendChild(nm);
    var ef = document.createElement("div"); ef.className = "it-eff"; ef.textContent = on ? o.on : o.off; card.appendChild(ef);
    var b = document.createElement("button"); b.className = "it-btn" + (on ? " on" : ""); b.type = "button";
    b.textContent = on ? "TURN OFF" : "TURN ON";
    b.addEventListener("click", function () {
      RUN[o.k] = !on;
      if (o.k === "sfx" && !on) SFX.buy();          /* only audible turning it back on */
      if (o.k === "perf") applyPerf();
      save(); MUSIC.sync(); renderSettings();
    });
    card.appendChild(b); grid.appendChild(card);
  });
}

/* ---------- ally select ---------- */
function renderAllies() {
  var grid = $("ally-grid"); grid.innerHTML = "";
  ALLIES.forEach(function (a) {
    var on = RUN.ally === a.k;
    var card = document.createElement("div"); card.className = "item ally" + (on ? " eq" : "");
    var chip = document.createElement("span"); chip.className = "tier-chip";
    chip.style.background = "#ffc244"; chip.textContent = a.tag; card.appendChild(chip);
    var nm = document.createElement("div"); nm.className = "it-name"; nm.textContent = a.name; card.appendChild(nm);
    var ef = document.createElement("div"); ef.className = "it-eff"; ef.textContent = a.desc; card.appendChild(ef);
    var kit = document.createElement("div"); kit.className = "ally-kit";
    kit.textContent = a.hits + " SLAMS - x" + a.mult.toFixed(2) + " SPECIAL\n" +
                      "SLAM x" + (a.atk === 0 ? 0 : (a.atk || 1)).toFixed(2) + " - COUNTER x" + (a.cnt === 0 ? 0 : (a.cnt || 1)).toFixed(2) + "\n" +
                      "CHARGE x" + a.charge.toFixed(2) + " - PROC x" + a.procMul;
    kit.style.whiteSpace = "pre-line";
    card.appendChild(kit);
    var b = document.createElement("button"); b.className = "it-btn" + (on ? " on" : ""); b.type = "button";
    /* You commit to a fighter at the start of a run and live with him. */
    var locked = RUN.streak > 0 && !on;
    b.textContent = on ? "SELECTED" : (locked ? "LOCKED" : "PICK");
    b.disabled = locked;
    b.addEventListener("click", function () {
      if (RUN.streak > 0) { SFX.nope(); return; }
      RUN.ally = a.k; _adKey = "";
      ["outfit", "gloves", "boots"].forEach(function (k) {   /* shed what he will not wear */
        var it = equipped(k);
        if (it && !allyAllows(k, it)) RUN.equip[k] = null;
      });
      SFX.buy(); save(); applyOutfitLook(); renderAllies();
    });
    card.appendChild(b); grid.appendChild(card);
  });
}

function renderMaps() {
  var grid = $("map-grid"); grid.innerHTML = "";
  MAPS.forEach(function (m) {
    var on = RUN.map === m.k;
    var card = document.createElement("div"); card.className = "item ally" + (on ? " eq" : "");
    var chip = document.createElement("span"); chip.className = "tier-chip";
    chip.style.background = "#ffc244"; chip.textContent = m.tag; card.appendChild(chip);
    var nm = document.createElement("div"); nm.className = "it-name"; nm.textContent = m.name; card.appendChild(nm);
    var ef = document.createElement("div"); ef.className = "it-eff"; ef.textContent = m.desc; card.appendChild(ef);
    /* a strip of the actual palette reads faster than any wording */
    var sw = document.createElement("div"); sw.className = "map-sw";
    [m.floorA, m.floorB, hex(m.plank), hex(m.torch), hex(m.rim)].forEach(function (c) {
      var d = document.createElement("i"); d.style.background = c; sw.appendChild(d);
    });
    card.appendChild(sw);
    var b = document.createElement("button"); b.className = "it-btn" + (on ? " on" : ""); b.type = "button";
    b.textContent = on ? "SELECTED" : "PICK";
    b.addEventListener("click", function () {
      RUN.map = m.k; SFX.buy(); save(); applyMapLook(); renderMaps();
    });
    card.appendChild(b); grid.appendChild(card);
  });
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
    var allowed = allyAllows(it.kind, it);
    if (!allowed) {
      var why = document.createElement("div"); why.className = "it-eff";
      why.style.color = "#8d8397";
      why.textContent = allyBase().name + " will not wear this.";
      card.appendChild(why);
    }
    var b = document.createElement("button");
    b.className = "it-btn" + (on && allowed ? " on" : ""); b.type = "button";
    b.disabled = !allowed;
    b.textContent = !allowed ? "LOCKED" : (on ? "EQUIPPED" : "EQUIP");
    b.addEventListener("click", function () {
      if (!allyAllows(it.kind, it)) { SFX.nope(); return; }
      RUN.equip[it.kind] = it.uid; SFX.buy(); save();
      applyOutfitLook();          /* gloves change the model now, not just outfits */
      renderWardrobe();
    });
    card.appendChild(b); grid.appendChild(card);
  });
}

/* ============================================================
   LOOP + INPUT
============================================================ */
var last = performance.now();
var CTX_LOST = false;

renderer.domElement.addEventListener("webglcontextlost", function (e) {
  e.preventDefault(); CTX_LOST = true;
}, false);
renderer.domElement.addEventListener("webglcontextrestored", function () {
  CTX_LOST = false; last = performance.now();
}, false);

document.addEventListener("visibilitychange", function () {
  if (document.hidden) {
    MUSIC.stop();                    /* never schedule into a suspended context */
  } else {
    last = performance.now();        /* no giant catch-up frame */
    for (var i = debris.length - 1; i >= 0; i--) {   /* drop anything left mid-flight */
      var d = debris[i];
      if (!d.userData.mote) continue;
      scene.remove(d);
      if (!d.userData.shared) { d.geometry.dispose(); d.material.dispose(); }
      debris.splice(i, 1);
    }
    auraT = 0;
    MUSIC.sync();
  }
});

(function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden || CTX_LOST) { last = now; return; }
  var dt = Math.min(.05, (now - last) / 1000); last = now;
  if (PAUSED) dt = 0;                      /* freeze the dial, timers and fighters */
  tick(dt); animFighter(you, dt); animFighter(foe, dt); stepDebris(dt); drawDial();
  if (G.shake > 0) {
    G.shake = Math.max(0, G.shake - dt * 5.5);
    camera.position.set(CAM_BASE.x + rnd(-1, 1) * G.shake * .12, CAM_BASE.y + rnd(-1, 1) * G.shake * .12, CAM_BASE.z + rnd(-1, 1) * G.shake * .07);
  } else camera.position.copy(CAM_BASE);
  camera.lookAt(CAM_LOOK);
  torchLight.intensity = 1.35 + Math.sin(now * .006) * .18;
  renderer.render(scene, camera);
})(last);

function wake() {
  if (ac() && actx.state === "suspended") actx.resume();
  MUSIC.sync();                       /* browsers only allow audio after a gesture */
}
addEventListener("keydown", function (e) {
  if (e.code === "Escape" || e.code === "KeyP") { e.preventDefault(); setPaused(!PAUSED); return; }
  if (PAUSED) return;
  if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); wake(); strike(); }
  else if (e.code === "KeyS") { e.preventDefault(); wake(); useSpecial(); }
});
addEventListener("pointerdown", function (e) {
  if (PAUSED) return;
  if (e.target.closest(".screen") || e.target.closest("#sp-btn") || e.target.closest("#pause-btn")) return;
  wake();
  if (LIVE[G.phase]) { e.preventDefault(); strike(); }
});
spBtn.addEventListener("click", function (e) { e.stopPropagation(); wake(); useSpecial(); });

$("start-btn").addEventListener("click", function () {
  wake(); $("menu").hidden = true;
  if (RUN.boon) { renderBoons(); $("boons").hidden = false; return; }
  renderPit(); $("pit").hidden = false;
  if (window.Ads) window.Ads.showBanner();
});
$("fight-btn").addEventListener("click", function () {
  var fee = entryFee(foeLevel());
  if (RUN.coins < fee) { SFX.nope(); return; }      /* cannot buy in at these stakes */
  RUN.coins -= fee; save();
  $("pit").hidden = true; if (window.Ads) window.Ads.hideBanner(); beginBattle();
});
$("again-btn").addEventListener("click", function () {
  $("over").hidden = true;
  if (RUN.boon) { renderBoons(); $("boons").hidden = false; return; }   /* claim it first */
  renderPit(); $("pit").hidden = false;
  if (window.Ads) window.Ads.showBanner();
});
$("ally-btn").addEventListener("click", function () { $("pit").hidden = true; renderAllies(); $("allies").hidden = false; });
$("ally-back").addEventListener("click", function () { $("allies").hidden = true; renderPit(); $("pit").hidden = false; });
$("map-btn").addEventListener("click", function () { $("pit").hidden = true; renderMaps(); $("maps").hidden = false; });
$("map-back").addEventListener("click", function () { $("maps").hidden = true; renderPit(); $("pit").hidden = false; });
$("set-btn").addEventListener("click", function () { $("pit").hidden = true; renderSettings(); $("settings").hidden = false; });
$("set-back").addEventListener("click", function () { $("settings").hidden = true; renderPit(); $("pit").hidden = false; });
$("gal-btn").addEventListener("click", function () { $("pit").hidden = true; renderGallery(); $("gallery").hidden = false; });
$("gal-back").addEventListener("click", function () { $("gallery").hidden = true; renderPit(); $("pit").hidden = false; });
$("ward-btn").addEventListener("click", function () { $("pit").hidden = true; renderWardrobe(); $("wardrobe").hidden = false; });
$("ward-back").addEventListener("click", function () { $("wardrobe").hidden = true; renderPit(); $("pit").hidden = false; });
Array.prototype.forEach.call($("ward-tabs").children, function (b) {
  b.addEventListener("click", function () { wardKind = b.dataset.kind; SFX.buy(); renderWardrobe(); });
});
$("pause-btn").addEventListener("click", function (e) { e.stopPropagation(); setPaused(true); });
$("resume-btn").addEventListener("click", function () { setPaused(false); });
$("quit-btn").addEventListener("click", quitFight);
$("rv-close").addEventListener("click", function () { $("reveal").hidden = true; });
$("case").addEventListener("click", skipReel);

/* Belt and braces for the ad button: whatever the SDK does, coming back to
   the game always hands the button back to the player. */
function resetAdBtn() {
  var btn = $("ad-btn");
  if (btn) { btn.disabled = false; btn.textContent = "WATCH AD +2 GEM"; }
}
document.addEventListener("visibilitychange", function () {
  if (!document.hidden) setTimeout(resetAdBtn, 400);
});

$("ad-btn").addEventListener("click", function () {
  var btn = $("ad-btn"); btn.disabled = true; btn.textContent = "LOADING AD...";
  var fired = false;
  var done = function (ok) {
    if (fired) return;                 /* the watchdog may have got here first */
    fired = true;
    resetAdBtn();
    if (ok) { RUN.gems += 2; SFX.gem(); save(); renderPit(); }
    else SFX.nope();
  };
  setTimeout(function () { done(false); }, 190000);   /* nothing hangs forever */
  if (window.Ads && window.Ads.showRewarded) {
    window.Ads.showRewarded().then(done).catch(function () { done(false); });
  } else {
    setTimeout(function () { done(true); }, 700);   // web build: no ad SDK, grant for testing
  }
});

$("survey-btn").addEventListener("click", function () {
  SFX.buy();
  /* Capacitor sends off-origin links to the system browser, so the player
     keeps the game running behind the form instead of being trapped in the
     WebView with no back button. */
  try {
    var w = window.open(SURVEY_URL, "_blank", "noopener");
    if (!w) location.href = SURVEY_URL;          /* popup blocked - go directly */
  } catch (e) {
    location.href = SURVEY_URL;
  }
});

$("reset-btn").addEventListener("click", function () {
  RUN.coins = 0; RUN.gems = 0; RUN.streak = 0; RUN.diff = 0;
  RUN.up = { hearts: 0, grip: 0, power: 0, focus: 0, mastery: 0, steady: 0, clock: 0 };
  RUN.ally = "kazuma";
  RUN.hp = null;
  clearBoons();
  stockWardrobe(); applyOutfitLook();
  SFX.nope(); save(); renderPit();
});

renderHearts(hpYouEl, 3, 3, "#6f8cff");
renderFoeHP(); renderSpecial();
})();
