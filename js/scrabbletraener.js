(function () {
"use strict";
// ---- tiles.js ----
// Officiel dansk brikfordeling: 98 bogstavbrikker + 2 blanke = 100.
// [antal, point] — q og w findes ikke som brikker (kun via blank).
const DIST = {
  a: [7, 1], b: [4, 3], c: [2, 8], d: [5, 2], e: [9, 1], f: [3, 3],
  g: [3, 3], h: [2, 4], i: [4, 3], j: [2, 4], k: [4, 3], l: [5, 2],
  m: [3, 3], n: [6, 1], o: [5, 2], p: [2, 4], r: [6, 1], s: [5, 2],
  t: [5, 2], u: [3, 3], v: [3, 3], x: [1, 8], y: [2, 4], z: [1, 8],
  "æ": [2, 4], "ø": [2, 4], "å": [2, 4],
};
const BLANKS = 2;

const ALPHABET = "abcdefghijklmnopqrstuvwxyzæøå".split("");
const ORDER = new Map(ALPHABET.map((c, i) => [c, i]));

function points(letter) {
  const d = DIST[letter];
  return d ? d[1] : 0; // q/w kan kun lægges med blank (0 point)
}

function tileCount(letter) {
  const d = DIST[letter];
  return d ? d[0] : 0;
}

function wordPoints(word) {
  let s = 0;
  for (const c of word) s += points(c);
  return s;
}

// Alfagram: ordets bogstaver i dansk alfabetisk orden (a-z, æ, ø, å)
function alphagram(word) {
  return [...word].sort((a, b) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99)).join("");
}

const BINOM = [];
function binom(n, k) {
  if (k < 0 || k > n) return 0;
  const key = n * 20 + k;
  if (BINOM[key] !== undefined) return BINOM[key];
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return (BINOM[key] = r);
}

// Kombinatorisk vægt: antal måder racket kan trækkes af de 98 bogstavbrikker
// (uden blanke). 0 hvis ordet kræver bogstaver, der ikke findes som brikker.
function drawWeight(alpha) {
  const counts = {};
  for (const c of alpha) counts[c] = (counts[c] || 0) + 1;
  let w = 1;
  for (const [c, k] of Object.entries(counts)) {
    const n = tileCount(c);
    if (k > n) return 0;
    w *= binom(n, k);
  }
  return w;
}

// Træk et tilfældigt rack (uden blanke) fra den fulde pose
function drawRack(size) {
  const bag = [];
  for (const [c, [n]] of Object.entries(DIST)) for (let i = 0; i < n; i++) bag.push(c);
  const rack = [];
  for (let i = 0; i < size; i++) {
    const j = Math.floor(Math.random() * bag.length);
    rack.push(bag.splice(j, 1)[0]);
  }
  return rack;
}

function tileHTML(letter, size = "") {
  const cls = "tile" + (size ? " " + size : "") + (DIST[letter] ? "" : " blank");
  const p = points(letter);
  return `<span class="${cls}" aria-hidden="true">${letter}<sub>${p || ""}</sub></span>`;
}

// Et ord som brikker; skærmlæsere får hele ordet i stedet for bogstav for bogstav
function wordTilesHTML(word, size = "small") {
  return `<span class="word" role="img" aria-label="${word.toUpperCase()}">` +
    [...word].map((c) => tileHTML(c, size)).join("") + "</span>";
}

// Et rack af brikker, man kan trykke på for at bygge et ord
function rackButtonsHTML(letters) {
  return [...letters].map((c, i) => {
    const p = points(c);
    const cls = "tile" + (DIST[c] ? "" : " blank");
    return `<button type="button" class="${cls}" data-i="${i}" data-letter="${c}" ` +
      `aria-label="${c.toUpperCase()}, ${p} point">${c}<sub aria-hidden="true">${p || ""}</sub></button>`;
  }).join("");
}

// ---- datafiles.js ----
// Genereret af tools/pack_data.py — ret ikke i hånden
const DATA_FILES = { words: "words-140df973d4.bin", info: "info-8d82ab7a54.bin", lister: "lister-2e50292f01.bin" };

// ---- dict.js ----



const dict = {
  list: null, // alle gyldige ordformer i sorteret rækkefølge (info-filen følger samme orden)
  words: null, // Set af alle gyldige ordformer (2-15 bogstaver)
  byLen: new Map(), // len -> array af ord
  anagrams: new Map(), // alfagram -> array af ord (kun len 2-8)
  ranked: new Map(), // len -> [{alpha, words}] sorteret efter trækvægt (faldende)
  info: null, // ordform -> [[lemma, ordklasse], ...] — indlæses dovent
};

// Hvor ordlisterne ligger (WordPress-pluginet sætter SCRABBLETRAENER_DATA_URL)
const DATA_URL = window.SCRABBLETRAENER_DATA_URL || "data/";
const CACHE_NAME = "scrabbletraener-data";

// Pakkede filer (se tools/pack_data.py) er gzip. Hvis serveren allerede har pakket
// dem ud (Content-Encoding), er de første bytes ikke gzip-magien, og så bruges de direkte.
async function gunzip(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

// Henter en datafil og gemmer den i browserens Cache Storage, så næste besøg
// ikke skal hente noget. Filnavnene indeholder en hash, så gamle versioner ryddes væk.
async function fetchData(name) {
  const url = new URL(DATA_URL + name, document.baseURI).href;
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch { cache = null; } // fx privat vindue eller file:// — så hentes der bare
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kunne ikke hente ${name} (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (cache) {
    try {
      await cache.put(url, new Response(bytes));
      const current = new Set(Object.values(DATA_FILES).map((f) => new URL(DATA_URL + f, document.baseURI).href));
      for (const req of await cache.keys()) if (!current.has(req.url)) cache.delete(req);
    } catch { /* fuld eller utilgængelig cache er ikke kritisk */ }
  }
  return bytes;
}

async function loadText(name, embeddedB64) {
  const bytes = embeddedB64
    ? Uint8Array.from(atob(embeddedB64), (c) => c.charCodeAt(0))
    : await fetchData(name);
  return gunzip(bytes);
}

// Præfikskodning: første tegn = chr(48 + antal bogstaver fælles med forrige ord)
function decodeWords(text) {
  const list = [];
  let prev = "";
  for (const line of text.split("\n")) {
    if (!line) continue;
    prev = prev.slice(0, line.charCodeAt(0) - 48) + line.slice(1);
    list.push(prev);
  }
  return list;
}

async function loadDict(onProgress) {
  const list = decodeWords(await loadText(DATA_FILES.words, window.EMBEDDED_WORDS_B64));
  dict.list = list;
  dict.words = new Set(list);

  for (const w of list) {
    const n = w.length;
    let arr = dict.byLen.get(n);
    if (!arr) dict.byLen.set(n, (arr = []));
    arr.push(w);
    if (n >= 2 && n <= 8) {
      const a = alphagram(w);
      let g = dict.anagrams.get(a);
      if (!g) dict.anagrams.set(a, (g = []));
      g.push(w);
    }
  }
  onProgress?.("Beregner sandsynligheder …");
  await new Promise((r) => setTimeout(r)); // lad UI'et tegne
  for (const len of [5, 6, 7, 8]) {
    const groups = new Map();
    for (const w of dict.byLen.get(len) || []) {
      const a = alphagram(w);
      if (!groups.has(a)) groups.set(a, dict.anagrams.get(a));
    }
    const ranked = [...groups.entries()]
      .map(([alpha, words]) => ({ alpha, words, weight: drawWeight(alpha) }))
      .filter((g) => g.weight > 0)
      .sort((a, b) => b.weight - a.weight);
    dict.ranked.set(len, ranked);
  }
}

function isValid(word) {
  return dict.words.has(word);
}

// Kroge: bogstaver der kan sættes foran/bagpå og stadig give et gyldigt ord
function hooks(word) {
  const front = [], back = [];
  for (const c of ALPHABET) {
    if (dict.words.has(c + word)) front.push(c);
    if (dict.words.has(word + c)) back.push(c);
  }
  return { front, back };
}

// Dovent opslag af lemma/ordklasse — hentes først når der er brug for den.
// Én linje pr. ord i samme orden som ordlisten; "=" = ordet selv, "^" = som forrige linje.
let infoPromise = null;
function loadInfo() {
  if (!infoPromise) {
    infoPromise = loadText(DATA_FILES.info, window.EMBEDDED_INFO_B64).then((text) => {
      const map = new Map();
      const lines = text.split("\n");
      let prev = [];
      for (let i = 0; i < dict.list.length; i++) {
        const w = dict.list[i], line = lines[i] || "";
        if (line !== "^") {
          prev = line ? line.split(";").map((e) => {
            const [lemma, pos] = e.split("|");
            return [lemma === "=" ? w : lemma, pos];
          }) : [];
        }
        if (prev.length) map.set(w, prev);
      }
      dict.info = map;
      return map;
    });
    infoPromise.catch(() => { infoPromise = null; }); // prøv igen næste gang
  }
  return infoPromise;
}

// Foreningens ordlister (navn, url, ord) — hentes først når quizzen åbnes
let listsPromise = null;
function loadLists() {
  if (!listsPromise) {
    listsPromise = loadText(DATA_FILES.lister, window.EMBEDDED_LISTER_B64).then((t) => JSON.parse(t));
    listsPromise.catch(() => { listsPromise = null; });
  }
  return listsPromise;
}

const POS_LABELS = {
  sb: "substantiv", vb: "verbum", adj: "adjektiv", adv: "adverbium",
  "præp": "præposition", konj: "konjunktion", pron: "pronomen",
  "udråbsord": "udråbsord", lydord: "lydord", talord: "talord",
  art: "artikel", formsubj: "formelt subjekt", iflerord: "del af fast udtryk",
  flerord: "fast udtryk", RO: "fra foreningens RO-liste",
};

// ---- app.js ----



const $ = (id) => document.getElementById(id);
const DAY = 864e5;

/* ---------- statistik (localStorage) ---------- */
const STATS_KEY = "dsf-traener-stats";
function freshStats() {
  return {
    anagram: { racks: 0, found: 0, missed: 0, perAlpha: {} },
    miniord: { right: 0, wrong: 0 }, // ældre fane, beholdes for gammel statistik
    lister: { right: 0, wrong: 0, bestStreak: 0, perList: {} },
    kroge: { rounds: 0, hits: 0, misses: 0, wrong: 0, points: 0, bestStreak: 0, review: {} }, // Hooks
    turnering: { runs: [], best: {} },
  };
}
function loadStats() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch { return {}; }
}
const stats = Object.assign(freshStats(), loadStats());
// ældre statistik: racks med missede ord kommer i gentagelse fra niveau 1
for (const e of Object.values(stats.anagram.perAlpha))
  if (e.box === undefined) e.box = e.missed > 0 ? 1 : 0;
function saveStats() {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* privat vindue */ }
}

/* ---------- navigation (faner med piletaster) ---------- */
const views = ["anagram", "turnering", "lister", "hooks", "dommer", "stats"];
const tabs = [...document.querySelectorAll("#st-nav [role=tab]")];
for (const btn of tabs) btn.addEventListener("click", () => showView(btn.dataset.view));
$("st-nav").addEventListener("keydown", (e) => {
  const i = tabs.indexOf(document.activeElement);
  if (i === -1) return;
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const tab = tabs[(next + tabs.length) % tabs.length];
  tab.focus();
  showView(tab.dataset.view, false);
});

function showView(name, focusInput = true) {
  for (const v of views) $(`view-${v}`).hidden = v !== name;
  for (const btn of tabs) {
    const on = btn.dataset.view === name;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on);
    btn.tabIndex = on ? 0 : -1;
  }
  if (name === "turnering") tuResume(); else tuPause();
  if (name === "stats") renderStats();
  if (name === "turnering" && !tu.running) tuShowBest();
  if (name === "lister" && !olCur) olStart();
  if (name === "hooks" && !hkCur) hkNext();
  if (["lister", "dommer", "anagram", "turnering", "hooks"].includes(name)) loadInfo();
  const input = { anagram: "an-input", dommer: "do-input", turnering: tu.running ? "tu-input" : null }[name];
  if (input && focusInput) focusQuiet($(input));
}

// Fokus uden at rulle siden (vigtigt når træneren står midt på en WordPress-side)
function focusQuiet(el) {
  if (!matchMedia("(pointer: coarse)").matches) el.focus({ preventScroll: true });
}

/* ---------- rack: brikker man kan trykke på ---------- */
function setupRack(rackEl, formEl, inputEl) {
  const coarse = matchMedia("(pointer: coarse)");
  function sync() {
    const counts = {};
    for (const c of inputEl.value.toLowerCase()) counts[c] = (counts[c] || 0) + 1;
    for (const b of rackEl.children) {
      const c = b.dataset.letter;
      const used = counts[c] > 0;
      if (used) counts[c]--;
      b.classList.toggle("used", used);
      b.setAttribute("aria-pressed", used);
    }
  }
  rackEl.addEventListener("click", (e) => {
    const b = e.target.closest("button.tile");
    if (!b || inputEl.readOnly) return;
    const c = b.dataset.letter;
    if (b.classList.contains("used")) {
      // tryk igen på en brugt brik fjerner det bogstav fra ordet
      const v = inputEl.value.toLowerCase(), i = v.lastIndexOf(c);
      if (i !== -1) inputEl.value = inputEl.value.slice(0, i) + inputEl.value.slice(i + 1);
    } else {
      inputEl.value += c.toUpperCase();
    }
    sync();
    const touch = e.pointerType ? e.pointerType === "touch" : coarse.matches;
    if (!touch) inputEl.focus({ preventScroll: true }); // ingen skærmtastatur på mobil
  });
  inputEl.addEventListener("input", sync);
  formEl.querySelector(".rack-shuffle").addEventListener("click", () => {
    const btns = [...rackEl.children];
    for (let i = btns.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [btns[i], btns[j]] = [btns[j], btns[i]];
    }
    rackEl.append(...btns);
  });
  return {
    set(letters) { rackEl.innerHTML = rackButtonsHTML(letters); sync(); },
    clear() { inputEl.value = ""; sync(); },
  };
}

/* ============================================================
   GENTAGELSE — racks med missede ord kommer igen med stigende mellemrum
   niveau 1: efter 4 racks · 2: 1 dag · 3: 3 dage · 4: 7 dage · 5: 21 dage · derefter lært
   ============================================================ */
const REVIEW_DAYS = [0, 0, 1, 3, 7, 21];
const MASTERED = 6;
const SAME_SESSION_GAP = 4;

function isDue(e) {
  return e.box >= 1 && e.box < MASTERED &&
    stats.anagram.racks >= (e.dueRack || 0) && Date.now() >= (e.dueTime || 0);
}
function dueAlphas(len) {
  return Object.entries(stats.anagram.perAlpha)
    .filter(([a, e]) => isDue(e) && (!len || a.length === len) && dict.anagrams.has(a))
    .map(([a]) => a);
}
function describeDue(e) {
  if (e.box >= MASTERED) return "lært";
  if (isDue(e)) return "klar nu";
  const racksLeft = (e.dueRack || 0) - stats.anagram.racks;
  if (racksLeft > 0) return `om ${racksLeft} rack${racksLeft === 1 ? "" : "s"}`;
  const days = Math.ceil(((e.dueTime || 0) - Date.now()) / DAY);
  return days <= 1 ? "i morgen" : `om ${days} dage`;
}

// Registrér et færdigspillet rack og planlæg næste gentagelse
function recordRack(alpha, missingCount) {
  const a = stats.anagram;
  a.racks++;
  const e = (a.perAlpha[alpha] ||= { seen: 0, missed: 0, box: 0 });
  e.seen++;
  if (missingCount) {
    e.missed += missingCount;
    a.missed += missingCount;
    e.box = 1;
    e.dueRack = a.racks + SAME_SESSION_GAP;
    e.dueTime = 0;
  } else if (e.box >= 1 && e.box < MASTERED) {
    e.box++;
    e.dueRack = 0;
    e.dueTime = e.box < MASTERED ? Date.now() + REVIEW_DAYS[e.box] * DAY : 0;
  }
  saveStats();
  return e;
}

function lemmaNote(w) {
  const entries = dict.info?.get(w);
  if (!entries) return "";
  const seen = new Set(), parts = [];
  for (const [lemma, pos] of entries) {
    const key = lemma + "|" + pos;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`${lemma} (${POS_LABELS[pos] || pos})`);
  }
  return `<span class="lemma">${parts.join(" · ")}</span>`;
}

function wordRowsHTML(found, missing) {
  const row = (w, cls) =>
    `<div class="found-word${cls}">${wordTilesHTML(w)}<span class="pts">${wordPoints(w)} p</span>${lemmaNote(w)}</div>`;
  return [...found].sort().map((w) => row(w, "")).join("") +
    [...missing].sort().map((w) => row(w, " missed")).join("");
}

function pickFromBand(len, band) {
  const ranked = dict.ranked.get(len) || [];
  let pool = ranked;
  if (band !== "all") {
    const [lo, hi] = band.split("-").map(Number);
    pool = ranked.slice(lo, Math.min(hi, ranked.length));
  }
  if (!pool.length) pool = ranked;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Fælles tjek af et gættet ord mod et rack
function checkGuess(w, group, found) {
  if (alphagram(w) !== group.alpha) return ["bad", `“${w.toUpperCase()}” bruger ikke præcis rackets bogstaver`];
  if (!group.words.includes(w)) return ["bad", `“${w.toUpperCase()}” står ikke i ordlisten`];
  if (found.has(w)) return ["", `“${w.toUpperCase()}” er allerede fundet`];
  return ["good", null];
}

function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ============================================================
   ANAGRAMJAGT
   ============================================================ */
let anGroup = null, anFound = new Set(), anRevealed = false;
const anRack = setupRack($("an-rack"), $("an-form"), $("an-input"));

function anPickGroup() {
  const len = +$("an-len").value;
  const mode = $("an-mode").value;
  if (mode !== "new") {
    const due = dueAlphas(mode === "review" ? 0 : len);
    if (due.length && (mode === "review" || Math.random() < 0.5)) {
      const alpha = due[Math.floor(Math.random() * due.length)];
      return { alpha, words: dict.anagrams.get(alpha), revisit: true };
    }
  }
  const g = pickFromBand(len, $("an-band").value);
  return { ...g, noReviews: mode === "review" };
}

function anNext(focus = true) {
  anGroup = anPickGroup();
  anFound = new Set();
  anRevealed = false;
  $("an-input").readOnly = false;
  anRack.set(anGroup.alpha);
  anRack.clear();
  $("an-found").innerHTML = "";
  $("an-feedback").textContent = " ";
  $("an-feedback").className = "feedback";
  anUpdateInfo();
  if (focus) focusQuiet($("an-input"));
}

function anUpdateInfo() {
  const total = anGroup.words.length;
  let extra = "";
  if (anGroup.revisit) {
    extra = ` · <span class="tag">gentagelse · niveau ${stats.anagram.perAlpha[anGroup.alpha].box}/5</span>`;
  } else if (anGroup.noReviews) {
    extra = " · ingen gentagelser venter lige nu — her er et nyt rack";
  }
  $("an-info").innerHTML =
    `Find alle gyldige ord med præcis disse bogstaver: <b>${anFound.size} af ${total}</b> fundet${extra}`;
}

$("an-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!anGroup) return;
  if (anRevealed) return anNext(); // Enter efter afsluttet rack = næste rack
  const w = $("an-input").value.trim().toLowerCase();
  anRack.clear();
  if (!w) return;
  const fb = $("an-feedback");
  const [cls, msg] = checkGuess(w, anGroup, anFound);
  if (msg) {
    fb.textContent = msg;
    fb.className = "feedback " + cls;
    return;
  }
  anFound.add(w);
  stats.anagram.found++;
  fb.textContent = `“${w.toUpperCase()}” — rigtigt! (${wordPoints(w)} point)`;
  fb.className = "feedback good";
  $("an-found").innerHTML = wordRowsHTML(anFound, []);
  anUpdateInfo();
  if (anFound.size === anGroup.words.length) anFinish(true);
});

function anFinish(solvedAll) {
  anRevealed = true;
  $("an-input").readOnly = true;
  const missing = anGroup.words.filter((w) => !anFound.has(w));
  const wasBox = stats.anagram.perAlpha[anGroup.alpha]?.box || 0;
  const e = recordRack(anGroup.alpha, missing.length);
  let review = "";
  if (missing.length) review = " Racket kommer igen om lidt.";
  else if (wasBox && e.box >= MASTERED) review = " Racket er nu lært!";
  else if (wasBox) review = ` Rykket op til niveau ${e.box}/5 — næste gang ${describeDue(e)}.`;
  const fb = $("an-feedback");
  if (solvedAll) {
    fb.textContent = `Alle ${anGroup.words.length} ord fundet!${review}`;
    fb.className = "feedback good";
  } else {
    fb.textContent = (missing.length ? `Du manglede ${missing.length} ord (vist med rødt).` : "Alle ord fundet!") + review;
    fb.className = "feedback " + (missing.length ? "bad" : "good");
  }
  const render = () => { $("an-found").innerHTML = wordRowsHTML(anFound, missing); };
  render();
  loadInfo().then(render, () => {});
  focusQuiet($("an-next"));
}

$("an-reveal").addEventListener("click", () => { if (anGroup && !anRevealed) anFinish(false); });
$("an-next").addEventListener("click", () => anNext());
for (const id of ["an-len", "an-band", "an-mode"]) $(id).addEventListener("change", () => anNext());

/* ============================================================
   TURNERING — racks på tid med point og rekorder
   ============================================================ */
const tu = {
  running: false, cfg: null, groups: [], i: 0, score: 0, results: [],
  group: null, found: new Set(), ended: false, remaining: 0, endAt: 0, timer: null, paused: false,
};
const tuRack = setupRack($("tu-rack"), $("tu-form"), $("tu-input"));

function tuReadCfg() {
  return {
    rounds: +$("tu-rounds").value, time: +$("tu-time").value,
    len: $("tu-len").value, band: $("tu-band").value,
  };
}
const tuKey = (c) => `${c.rounds}-${c.time}-${c.len}-${c.band}`;
function tuLabel(c) {
  const len = c.len === "78" ? "7+8" : c.len;
  const band = {
    "0-15": "top 15", "0-30": "top 30", "0-50": "top 50", "0-200": "top 200",
    "200-1000": "201–1.000", "1000-3000": "1.001–3.000", all: "alle",
  }[c.band];
  return `${c.rounds} racks · ${c.time} sek. · ${len} bogstaver · ${band}`;
}
function fmtDate(t) {
  return new Date(t).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" });
}

function tuShowBest() {
  const best = stats.turnering.best[tuKey(tuReadCfg())];
  $("tu-best").textContent = best
    ? `Din rekord med disse indstillinger: ${best.score} point (${fmtDate(best.date)}).`
    : "Ingen rekord med disse indstillinger endnu.";
}
for (const id of ["tu-rounds", "tu-time", "tu-len", "tu-band"]) $(id).addEventListener("change", tuShowBest);

function tuShow(part) {
  for (const p of ["setup", "play", "summary"]) $(`tu-${p}`).hidden = p !== part;
}

function tuStart() {
  const cfg = tuReadCfg();
  const seen = new Set(), groups = [];
  for (let tries = 0; groups.length < cfg.rounds && tries < cfg.rounds * 50; tries++) {
    const len = cfg.len === "78" ? (Math.random() < 0.5 ? 7 : 8) : +cfg.len;
    const g = pickFromBand(len, cfg.band);
    if (g && !seen.has(g.alpha)) { seen.add(g.alpha); groups.push(g); }
  }
  // fx 20 racks fra top 15: når alle forskellige er brugt, må racks gentages
  while (groups.length < cfg.rounds) {
    const len = cfg.len === "78" ? (Math.random() < 0.5 ? 7 : 8) : +cfg.len;
    groups.push(pickFromBand(len, cfg.band));
  }
  Object.assign(tu, { running: true, cfg, groups, i: 0, score: 0, results: [], paused: false });
  tuShow("play");
  tuShowRack();
}

function tuShowRack() {
  tu.group = tu.groups[tu.i];
  tu.found = new Set();
  tu.ended = false;
  tu.remaining = tu.cfg.time;
  $("tu-input").readOnly = false;
  tuRack.set(tu.group.alpha);
  tuRack.clear();
  $("tu-found").innerHTML = "";
  $("tu-feedback").textContent = " ";
  $("tu-feedback").className = "feedback";
  $("tu-skip").hidden = false;
  $("tu-next").hidden = true;
  tuUpdate();
  tuRunClock();
  focusQuiet($("tu-input"));
}

function tuUpdate() {
  $("tu-progress").innerHTML = `Rack <b>${tu.i + 1}</b> af ${tu.groups.length}`;
  $("tu-score").textContent = `${tu.score} p`;
  $("tu-info").innerHTML = `<b>${tu.found.size} af ${tu.group.words.length}</b> ord fundet`;
  $("tu-timer").textContent = fmtTime(Math.max(0, tu.remaining));
  $("tu-timebar").style.width = `${(100 * Math.max(0, tu.remaining)) / tu.cfg.time}%`;
  $("tu-timebar").classList.toggle("low", tu.remaining <= 10);
}

function tuRunClock() {
  clearInterval(tu.timer);
  tu.endAt = Date.now() + tu.remaining * 1000;
  tu.timer = setInterval(() => {
    tu.remaining = Math.ceil((tu.endAt - Date.now()) / 1000);
    tuUpdate();
    if (tu.remaining <= 0) tuEndRack(false, "Tiden er gået!");
  }, 200);
}
function tuPause() {
  if (!tu.running || tu.ended || tu.paused) return;
  clearInterval(tu.timer);
  tu.paused = true;
}
function tuResume() {
  if (!tu.running || tu.ended || !tu.paused) return;
  tu.paused = false;
  tuRunClock();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) tuPause(); else if (!$("view-turnering").hidden) tuResume();
});

$("tu-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!tu.running) return;
  if (tu.ended) return tuAdvance(); // Enter = næste rack
  const w = $("tu-input").value.trim().toLowerCase();
  tuRack.clear();
  if (!w) return;
  const fb = $("tu-feedback");
  const [cls, msg] = checkGuess(w, tu.group, tu.found);
  if (msg) {
    fb.textContent = msg;
    fb.className = "feedback " + cls;
    return;
  }
  tu.found.add(w);
  tu.score += 10;
  stats.anagram.found++;
  fb.textContent = `“${w.toUpperCase()}” — +10 point`;
  fb.className = "feedback good";
  $("tu-found").innerHTML = wordRowsHTML(tu.found, []);
  tuUpdate();
  if (tu.found.size === tu.group.words.length) {
    const bonus = Math.max(0, tu.remaining);
    tu.score += bonus;
    tuEndRack(true, `Alle ord fundet! +${bonus} bonuspoint for tiden.`);
  }
});

function tuEndRack(solved, message) {
  if (tu.ended) return;
  tu.ended = true;
  clearInterval(tu.timer);
  $("tu-input").readOnly = true;
  const missing = tu.group.words.filter((w) => !tu.found.has(w));
  tu.results.push({ alpha: tu.group.alpha, found: [...tu.found], missing, total: tu.group.words.length });
  recordRack(tu.group.alpha, missing.length);
  const fb = $("tu-feedback");
  fb.textContent = message + (missing.length ? ` Du manglede ${missing.length} ord.` : "");
  fb.className = "feedback " + (solved ? "good" : "bad");
  $("tu-found").innerHTML = wordRowsHTML(tu.found, missing);
  $("tu-skip").hidden = true;
  $("tu-next").hidden = false;
  $("tu-next").textContent = tu.i + 1 < tu.groups.length ? "Næste rack →" : "Se resultat →";
  tuUpdate();
  focusQuiet($("tu-next"));
}

function tuAdvance() {
  tu.i++;
  if (tu.i < tu.groups.length) tuShowRack(); else tuFinish();
}

function tuFinish() {
  tu.running = false;
  const found = tu.results.reduce((s, r) => s + r.found.length, 0);
  const total = tu.results.reduce((s, r) => s + r.total, 0);
  const solved = tu.results.filter((r) => !r.missing.length).length;
  const key = tuKey(tu.cfg);
  const run = { date: Date.now(), key, label: tuLabel(tu.cfg), score: tu.score, found, total, solved, racks: tu.results.length };
  const prev = stats.turnering.best[key];
  const record = !prev || run.score > prev.score;
  if (record) stats.turnering.best[key] = { score: run.score, date: run.date };
  stats.turnering.runs.unshift(run);
  stats.turnering.runs.length = Math.min(stats.turnering.runs.length, 30);
  saveStats();

  $("tu-sum-title").textContent = record && prev ? "Ny rekord!" : "Resultat";
  $("tu-sum-grid").innerHTML = [
    ["Point", tu.score],
    ["Ord fundet", `${found} / ${total}`],
    ["Løste racks", `${solved} / ${tu.results.length}`],
    ["Rekord", record ? tu.score : prev.score],
  ].map(([lbl, num]) => `<div class="stat"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`).join("");
  $("tu-sum-racks").innerHTML = tu.results.map((r) =>
    `<div class="weakrow"><span class="alpha">${r.alpha}</span>
     <span class="meta">${r.found.length}/${r.total} ord${r.missing.length ? " · manglede " + r.missing.map((w) => w.toUpperCase()).join(", ") : " · løst"}</span></div>`).join("");
  tuShow("summary");
  focusQuiet($("tu-again"));
}

function tuStop() {
  clearInterval(tu.timer);
  tu.running = false;
  tuShow("setup");
  tuShowBest();
}

$("tu-start").addEventListener("click", tuStart);
$("tu-again").addEventListener("click", tuStart);
$("tu-setup-btn").addEventListener("click", tuStop);
$("tu-skip").addEventListener("click", () => tuEndRack(false, "Rack opgivet."));
$("tu-next").addEventListener("click", tuAdvance);
$("tu-quit").addEventListener("click", () => { if (confirm("Afbryd dysten? Resultatet gemmes ikke.")) tuStop(); });

/* ============================================================
   ORDLISTER — står ordet på listen? Quiz i foreningens egne ordlister
   (scrabbleforening.wordpress.com/ordlister, hentet med tools/fetch_dsf_lists.py)
   ============================================================ */
const ol = stats.lister;
Object.assign(ol, { right: 0, wrong: 0, bestStreak: 0, perList: {}, ...ol });
const VOWELS = "aeiouyæøå", CONSONANTS = "bdfghjklmnprstv";
let olLists = null, olCur = null, olLocked = false, olStreak = 0;

async function olStart() {
  if (!olLists) {
    $("ol-name").textContent = "Henter ordlisterne …";
    try {
      olLists = (await loadLists()).map((l) => ({ ...l, set: new Set(l.words) }));
    } catch (err) {
      $("ol-name").textContent = `Ordlisterne kunne ikke hentes: ${err.message}`;
      return;
    }
    $("ol-list").insertAdjacentHTML("beforeend",
      olLists.map((l, i) => `<option value="${i}">${l.name}</option>`).join(""));
  }
  olNext();
}

// Et falsk ord, der ligner ordene på listen: ét bogstav skiftes til et af samme slags
// (vokal/konsonant). Præfiks, C/X/Z og A'erne i "Ord med 2 A'er" røres ikke, så
// ordet stadig "passer" til listen. Det må hverken stå på listen eller være et gyldigt ord.
function olFake(list) {
  const prefix = (list.name.match(/begynder med ([A-ZÆØÅ]+)-/) || [])[1]?.toLowerCase() || "";
  const keepA = /2 A/.test(list.name);
  for (let tries = 0; tries < 200; tries++) {
    const base = list.words[Math.floor(Math.random() * list.words.length)];
    const pos = [...base].map((_, i) => i).filter((i) =>
      i >= prefix.length && !"cxz".includes(base[i]) && !(keepA && base[i] === "a"));
    if (!pos.length) continue;
    const i = pos[Math.floor(Math.random() * pos.length)];
    let pool = VOWELS.includes(base[i]) ? VOWELS : CONSONANTS;
    if (keepA) pool = pool.replace("a", "");
    const c = pool[Math.floor(Math.random() * pool.length)];
    const fake = base.slice(0, i) + c + base.slice(i + 1);
    if (fake !== base && !list.set.has(fake) && !dict.words.has(fake)) return fake;
  }
  return null;
}

function olNext() {
  if (!olLists) return;
  olLocked = false;
  const sel = $("ol-list").value;
  const list = olLists[sel === "" ? Math.floor(Math.random() * olLists.length) : +sel];
  let word = null, onList = Math.random() < 0.5;
  if (!onList) word = olFake(list);
  if (!word) { onList = true; word = list.words[Math.floor(Math.random() * list.words.length)]; }
  olCur = { list, word, onList };
  $("ol-name").innerHTML = `Liste: <a href="${list.url}" target="_blank" rel="noopener">${list.name}</a>`;
  $("ol-word").innerHTML = wordTilesHTML(word, word.length > 8 ? "small" : "");
  $("ol-word").style.setProperty("--n", word.length); // mobil: brikkerne skaleres, så ordet står på én linje
  $("ol-feedback").textContent = " ";
  $("ol-feedback").className = "feedback";
  olUpdateMeta();
}

function olUpdateMeta() {
  $("ol-score").textContent = `${ol.right} / ${ol.right + ol.wrong}`;
  $("ol-streak").textContent = olStreak >= 3 ? `${olStreak} i træk` : "";
}

function olAnswer(saidYes) {
  if (olLocked || !olCur) return;
  olLocked = true;
  const { list, word, onList } = olCur;
  const right = saidYes === onList;
  const per = (ol.perList[list.name] ||= { right: 0, wrong: 0 });
  per[right ? "right" : "wrong"]++;
  ol[right ? "right" : "wrong"]++;
  olStreak = right ? olStreak + 1 : 0;
  ol.bestStreak = Math.max(ol.bestStreak, olStreak);
  saveStats();
  const W = `“${word.toUpperCase()}”`;
  const fact = onList
    ? `${W} står på listen. ${lemmaNote(word)}`
    : `${W} står ikke på listen — og er ikke et gyldigt ord.`;
  $("ol-feedback").innerHTML = (right ? "Rigtigt — " : "Forkert — ") + fact;
  $("ol-feedback").className = "feedback " + (right ? "good" : "bad");
  olUpdateMeta();
  setTimeout(olNext, right ? 1000 : 2600);
}

$("ol-yes").addEventListener("click", () => olAnswer(true));
$("ol-no").addEventListener("click", () => olAnswer(false));
$("ol-list").addEventListener("change", olNext);
document.addEventListener("keydown", (e) => {
  if ($("view-lister").hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) || e.target.isContentEditable) return;
  if (e.key === "j" || e.key === "J") olAnswer(true);
  if (e.key === "n" || e.key === "N") olAnswer(false);
});

/* ============================================================
   HOOKS — bogstaver der kan sættes foran/bagpå et ord
   Point pr. rigtigt hook = brikkens værdi + op til 5 for hvor sjældent hooket er.
   Forkert bogstav −3. Perfekt runde +5, og en stime af perfekte runder giver op til +10 ekstra.
   ============================================================ */
const hk = stats.kroge; // gemt under det gamle navn, så eksisterende statistik bevares
Object.assign(hk, { points: 0, wrong: 0, bestStreak: 0, review: {}, ...hk });
const HK_WRONG = -3, HK_PERFECT = 5, HK_REVIEW_GAP = 5;
const hookCache = new Map(); // len -> { entries, freq, max, weights }
let hkCur = null, hkChecked = false, hkSide = "front", hkStreak = 0;
const hkSel = { front: new Set(), back: new Set() };
const hkRecent = [];

function hookData(len) {
  let d = hookCache.get(len);
  if (d) return d;
  const freq = { front: {}, back: {} };
  const entries = (dict.byLen.get(len) || []).map((w) => {
    const h = hooks(w);
    for (const c of h.front) freq.front[c] = (freq.front[c] || 0) + 1;
    for (const c of h.back) freq.back[c] = (freq.back[c] || 0) + 1;
    return { w, front: h.front, back: h.back };
  });
  const max = {
    front: Math.max(1, ...Object.values(freq.front)),
    back: Math.max(1, ...Object.values(freq.back)),
  };
  d = { entries, freq, max, weights: {} };
  hookCache.set(len, d);
  return d;
}
// 0 = det mest almindelige hook for ordlængden (fx S bagpå), 1 = aldrig set før
function surprise(len, side, c) {
  const d = hookData(len);
  return 1 - (d.freq[side][c] || 0) / d.max[side];
}
function hookValue(len, side, c) {
  return points(c) + Math.round(5 * surprise(len, side, c));
}
function hookList(e) {
  return [...e.front.map((c) => ["front", c]), ...e.back.map((c) => ["back", c])];
}

// Vægtet udvælgelse: "overraskende" favoriserer sjældne hooks, "pointgivende" tunge hooks
function weightedPick(len, mode) {
  const d = hookData(len);
  if (!d.weights[mode]) {
    const L = len, withHooks = d.entries.filter((e) => e.front.length + e.back.length);
    const w = withHooks.map((e) => {
      const hs = hookList(e);
      // ord med rigtig mange hooks bliver en ren remse, så de nedprioriteres
      const manageable = hs.length <= 6 ? 1 : 6 / hs.length;
      if (mode === "points") {
        const top = hs.map(([side, c]) => hookValue(L, side, c)).sort((a, b) => b - a).slice(0, 4);
        return Math.pow(top.reduce((a, b) => a + b, 0), 1.5) * manageable ** 2;
      }
      if (mode === "surprise") {
        // mindst ét rigtig sjældent hook tæller mest
        const best = Math.max(...hs.map(([side, c]) => surprise(L, side, c)));
        return (Math.pow(best, 4) + 0.02) * manageable ** 2;
      }
      return 1;
    });
    let acc = 0;
    d.weights[mode] = { list: withHooks, cum: w.map((x) => (acc += x)), total: acc };
  }
  const { list, cum, total } = d.weights[mode];
  const r = Math.random() * total;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
  return list[lo];
}

function hkPick() {
  const sel = $("hk-len").value;
  const lens = sel === "24" ? [2, 3, 4] : [+sel];
  const fits = (w) => lens.includes(w.length);
  // gentagelse af ord, hvor du missede eller gættede forkert
  const due = Object.entries(hk.review).filter(([w, r]) => r <= hk.rounds && fits(w) && dict.words.has(w));
  if (due.length && Math.random() < 0.4) {
    const [w] = due[Math.floor(Math.random() * due.length)];
    return { w, ...hooks(w), review: true };
  }
  for (let tries = 0; tries < 8; tries++) {
    const len = lens[Math.floor(Math.random() * lens.length)];
    let e;
    if (Math.random() < 0.12) { // fælde: et ord helt uden hooks
      const none = hookData(len).entries.filter((x) => !x.front.length && !x.back.length);
      e = none[Math.floor(Math.random() * none.length)];
    }
    e ||= weightedPick(len, $("hk-mode").value);
    if (e && !hkRecent.includes(e.w)) return { ...e };
  }
  return { ...weightedPick(lens[0], "random") };
}

function lettersHTML(side) {
  return ALPHABET.map((c) =>
    `<button type="button" class="letter" data-side="${side}" data-letter="${c}" aria-pressed="false">${c}</button>`).join("");
}

function hkSetSide(side) {
  hkSide = side;
  for (const el of document.querySelectorAll("#view-hooks .hook-side"))
    el.classList.toggle("active", el.dataset.side === side);
}

function hkNext() {
  hkCur = hkPick();
  hkRecent.push(hkCur.w);
  if (hkRecent.length > 12) hkRecent.shift();
  hkChecked = false;
  hkSel.front.clear();
  hkSel.back.clear();
  $("hk-word").innerHTML = `<span class="tile hook-slot" aria-hidden="true">?</span>${wordTilesHTML(hkCur.w, "")}<span class="tile hook-slot" aria-hidden="true">?</span>`;
  $("hk-front").innerHTML = lettersHTML("front");
  $("hk-back").innerHTML = lettersHTML("back");
  $("hk-count-front").textContent = "";
  $("hk-count-back").textContent = "";
  $("hk-info").innerHTML = hkCur.review ? `<span class="tag">gentagelse — du missede noget her sidst</span>` : "&nbsp;";
  $("hk-feedback").textContent = " ";
  $("hk-feedback").className = "feedback";
  $("hk-result").innerHTML = "";
  $("hk-check").hidden = false;
  hkSetSide("front");
  hkUpdateMeta();
}

function hkUpdateMeta() {
  $("hk-score").textContent = `${hk.points} p`;
  $("hk-streak").textContent = hkStreak >= 2 ? `stime ${hkStreak}` : "";
}

function hkToggle(side, c) {
  if (hkChecked || !hkCur) return;
  const set = hkSel[side];
  set.has(c) ? set.delete(c) : set.add(c);
  const b = document.querySelector(`#hk-${side} [data-letter="${c}"]`);
  b?.setAttribute("aria-pressed", set.has(c));
  hkSetSide(side);
}

// ord med ét bogstav på hver side, fx S·ÅL·E — vises som en ekstra overraskelse
function doubleHooks(w) {
  if (w.length > 4) return [];
  const out = [];
  for (const a of ALPHABET) for (const b of ALPHABET)
    if (dict.words.has(a + w + b)) out.push(a + w + b);
  return out;
}

function hkCheck() {
  if (!hkCur || hkChecked) return;
  hkChecked = true;
  const e = hkCur, L = e.w.length;
  let pts = 0, hits = 0, misses = 0, wrong = 0;
  const rows = [], wrongWords = [];
  for (const side of ["front", "back"]) {
    const actual = e[side], guess = hkSel[side];
    for (const c of actual) {
      const word = side === "front" ? c + e.w : e.w + c;
      const v = hookValue(L, side, c);
      const hit = guess.has(c);
      if (hit) { hits++; pts += v; } else misses++;
      rows.push({ word, v, hit, rare: surprise(L, side, c) >= 0.75 });
    }
    for (const c of guess) if (!actual.includes(c)) {
      wrong++;
      pts += HK_WRONG;
      wrongWords.push(side === "front" ? c + e.w : e.w + c);
    }
    for (const b of document.querySelectorAll(`#hk-${side} .letter`)) {
      const c = b.dataset.letter, ok = actual.includes(c), picked = guess.has(c);
      b.classList.toggle("hit", ok && picked);
      b.classList.toggle("miss", ok && !picked);
      b.classList.toggle("wrong", !ok && picked);
      b.disabled = true;
    }
    $(`hk-count-${side}`).textContent = `· ${actual.length} ${actual.length === 1 ? "hook" : "hooks"}`;
  }
  const total = e.front.length + e.back.length;
  const perfect = !misses && !wrong;
  let bonus = 0;
  if (perfect) {
    hkStreak++;
    bonus = HK_PERFECT + Math.min(10, 2 * (hkStreak - 1));
    pts += bonus;
  } else {
    hkStreak = 0;
  }
  Object.assign(hk, {
    rounds: hk.rounds + 1, hits: hk.hits + hits, misses: hk.misses + misses,
    wrong: hk.wrong + wrong, points: hk.points + pts, bestStreak: Math.max(hk.bestStreak, hkStreak),
  });
  if (perfect) delete hk.review[e.w]; else hk.review[e.w] = hk.rounds + HK_REVIEW_GAP;
  saveStats();

  const fb = $("hk-feedback");
  const sign = pts >= 0 ? "+" : "−";
  if (!total && perfect) fb.textContent = `Rigtigt — “${e.w.toUpperCase()}” har ingen hooks! ${sign}${Math.abs(pts)} point`;
  else if (perfect) fb.textContent = `Perfekt! Alle ${total} hooks · ${sign}${Math.abs(pts)} point (heraf ${bonus} i bonus)`;
  else fb.textContent = `${hits} af ${total} hooks${wrong ? ` · ${wrong} forkert${wrong === 1 ? "" : "e"} (${wrong * HK_WRONG})` : ""} · ${sign}${Math.abs(pts)} point`;
  fb.className = "feedback " + (perfect ? "good" : pts > 0 ? "" : "bad");

  const render = () => {
    const sorted = rows.sort((x, y) => y.v - x.v);
    const rest = sorted.slice(10);
    const list = sorted.slice(0, 10).map((r) =>
      `<div class="found-word${r.hit ? "" : " missed"}">${wordTilesHTML(r.word)}<span class="pts">${r.hit ? "+" : ""}${r.v} p</span>` +
      `${r.rare ? '<span class="tag">sjældent</span>' : ""}${lemmaNote(r.word)}</div>`).join("");
    const dbl = doubleHooks(e.w);
    $("hk-result").innerHTML =
      (list ? `<div class="found">${list}</div>` : "") +
      (rest.length ? `<p class="hint">Og ${rest.length} mere: ${rest.map((r) => `<span class="${r.hit ? "" : "missed-text"}">${r.word.toUpperCase()}</span>`).join(", ")}</p>` : "") +
      (wrongWords.length ? `<p class="hint">Ikke gyldige: ${wrongWords.map((w) => w.toUpperCase()).join(", ")}</p>` : "") +
      (dbl.length ? `<p class="hint"><b>Overraskelse — begge sider:</b> ${dbl.slice(0, 8).map((w) => w.toUpperCase()).join(", ")}${dbl.length > 8 ? " …" : ""}</p>` : "");
  };
  render();
  loadInfo().then(render, () => {});
  $("hk-check").hidden = true;
  hkUpdateMeta();
  focusQuiet($("hk-next"));
}

$("view-hooks").addEventListener("click", (ev) => {
  const letter = ev.target.closest(".letter");
  if (letter) return hkToggle(letter.dataset.side, letter.dataset.letter);
  const label = ev.target.closest(".hook-label");
  if (label) hkSetSide(label.dataset.side);
});
document.addEventListener("keydown", (e) => {
  if ($("view-hooks").hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) || e.target.isContentEditable) return;
  const k = e.key.toLowerCase();
  if (k === "arrowleft" || k === "arrowright") {
    if (e.target.closest?.("[role=tablist]")) return; // piletaster i fanebjælken skifter fane
    e.preventDefault();
    hkSetSide(k === "arrowleft" ? "front" : "back");
  } else if (k === "enter") {
    if (e.target.tagName === "BUTTON") return; // knappen håndterer selv Enter
    e.preventDefault();
    hkChecked ? hkNext() : hkCheck();
  } else if (k.length === 1 && ALPHABET.includes(k)) {
    e.preventDefault();
    hkToggle(hkSide, k);
  }
});
$("hk-check").addEventListener("click", hkCheck);
$("hk-next").addEventListener("click", hkNext);
for (const id of ["hk-len", "hk-mode"]) $(id).addEventListener("change", hkNext);

/* ============================================================
   ORDDOMMER
   ============================================================ */
$("do-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const w = $("do-input").value.trim().toLowerCase();
  if (!w) return;
  const out = $("do-result");
  if (!/^[a-zæøå]{2,15}$/.test(w)) {
    out.innerHTML = `<div class="verdict bad"><h3>“${w.toUpperCase()}”</h3>
      Kun ord på 2–15 bogstaver (a–å) kan lægges.</div>`;
    return;
  }
  if (!isValid(w)) {
    out.innerHTML = `<div class="verdict bad"><h3>${wordTilesHTML(w)} </h3>
      <p><b>Ugyldigt.</b> Ordet står ikke i ordlisten (Retskrivningsordbogen/COR).</p></div>`;
    return;
  }
  await loadInfo();
  const entries = dict.info.get(w) || [];
  const seen = new Set();
  const lis = entries.filter(([l, p]) => !seen.has(l + p) && seen.add(l + p))
    .map(([l, p]) => `<li><b>${l}</b> <span class="pos">— ${POS_LABELS[p] || p}</span></li>`).join("");
  const h = hooks(w);
  const hookLine = (w.length < 15)
    ? `<p class="pos">Hooks — foran: ${h.front.length ? h.front.join(" ").toUpperCase() : "ingen"} ·
       bagpå: ${h.back.length ? h.back.join(" ").toUpperCase() : "ingen"}</p>` : "";
  out.innerHTML = `<div class="verdict good"><h3>${wordTilesHTML(w)}</h3>
    <p><b>Gyldigt</b> · ${wordPoints(w)} point (uden felter)</p>
    <ul>${lis}</ul>${hookLine}</div>`;
});

/* ============================================================
   STATISTIK
   ============================================================ */
function renderStats() {
  const a = stats.anagram, m = stats.lister, k = stats.kroge;
  const pct = (x, y) => (y ? Math.round((100 * x) / y) + " %" : "–");
  $("st-grid").innerHTML = [
    ["Racks spillet", a.racks],
    ["Ord fundet", a.found],
    ["Ord misset", a.missed],
    ["Anagram-træfsikkerhed", pct(a.found, a.found + a.missed)],
    ["Ordlister rigtige", `${m.right} / ${m.right + m.wrong}`],
    ["Ordlister-træfsikkerhed", pct(m.right, m.right + m.wrong)],
    ["Bedste stime i Ordlister", m.bestStreak || 0],
    ["Hooks-runder", k.rounds],
    ["Hooks-træfsikkerhed", pct(k.hits, k.hits + k.misses + (k.wrong || 0))],
    ["Hooks-point", k.points || 0],
    ["Bedste hooks-stime", k.bestStreak || 0],
  ].map(([lbl, num]) => `<div class="stat"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`).join("");

  const entries = Object.entries(a.perAlpha);
  const learning = entries.filter(([, e]) => e.box >= 1 && e.box < MASTERED);
  const due = learning.filter(([, e]) => isDue(e)).length;
  const mastered = entries.filter(([, e]) => e.box >= MASTERED).length;
  $("st-review").textContent = learning.length || mastered
    ? `${due} rack${due === 1 ? "" : "s"} klar til gentagelse nu · ${learning.length} under indlæring · ${mastered} lært. ` +
      "Vælg “Kun gentagelser” i Anagramjagt for at tage dem."
    : "Racks med missede ord dukker op her og kommer igen med stigende mellemrum, indtil du kan dem.";
  const weak = learning
    .sort((x, y) => isDue(y[1]) - isDue(x[1]) || y[1].missed - x[1].missed)
    .slice(0, 15);
  $("st-weak").innerHTML = weak.map(([alpha, s]) =>
    `<div class="weakrow"><span class="alpha">${alpha}</span>
     <span class="meta">niveau ${s.box}/5 · ${describeDue(s)} · ${s.missed} misset i alt ·
     ${(dict.anagrams.get(alpha) || []).length} mulige ord</span></div>`).join("");

  const runs = stats.turnering.runs;
  $("st-tour").innerHTML = runs.length
    ? runs.slice(0, 8).map((r) =>
        `<div class="weakrow"><span class="alpha">${r.score} p</span>
         <span class="meta">${fmtDate(r.date)} · ${r.label} · ${r.found}/${r.total} ord · ${r.solved}/${r.racks} racks løst
         ${stats.turnering.best[r.key]?.date === r.date ? " · <b>rekord</b>" : ""}</span></div>`).join("")
    : `<p class="hint">Ingen dyster endnu — prøv fanen “Dyst mod dig selv”.</p>`;
}
$("st-reset").addEventListener("click", () => {
  if (!confirm("Nulstil al statistik, gentagelser og rekorder?")) return;
  const fresh = freshStats();
  Object.assign(hk, fresh.kroge); // hk og ol peger på de gemte objekter — behold dem
  fresh.kroge = hk;
  Object.assign(ol, fresh.lister);
  fresh.lister = ol;
  hkStreak = 0;
  olStreak = 0;
  Object.assign(stats, fresh);
  saveStats();
  hkUpdateMeta();
  if (olLists) olUpdateMeta();
  renderStats();
});

/* ---------- start ---------- */
(async function init() {
  const loading = $("st-loading");
  try {
    await loadDict((msg) => { loading.querySelector("p").textContent = msg; });
  } catch (err) {
    loading.querySelector(".spinner")?.remove();
    loading.querySelector("p").textContent = `Ordlisten kunne ikke indlæses: ${err.message}. Prøv at genindlæse siden.`;
    return;
  }
  loading.hidden = true;
  $("view-anagram").hidden = false;
  anNext(false); // ingen autofokus ved sideindlæsning — siden må ikke rulle af sig selv
})();

})();
