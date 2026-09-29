import { wordPoints, wordTilesHTML, alphagram, rackButtonsHTML } from "./tiles.js";
import { dict, loadDict, isValid, hooks, loadInfo, POS_LABELS } from "./dict.js";

const $ = (id) => document.getElementById(id);
const DAY = 864e5;

/* ---------- statistik (localStorage) ---------- */
const STATS_KEY = "dsf-traener-stats";
function freshStats() {
  return {
    anagram: { racks: 0, found: 0, missed: 0, perAlpha: {} },
    miniord: { right: 0, wrong: 0 },
    kroge: { rounds: 0, hits: 0, misses: 0 },
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
const views = ["anagram", "turnering", "miniord", "kroge", "dommer", "stats"];
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
  if (name === "miniord" && !moWord) moNext();
  if (name === "kroge" && !krWord) krNext();
  if (["miniord", "dommer", "anagram", "turnering"].includes(name)) loadInfo();
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
let anGroup = null, anFound = new Set(), anTimer = null, anSeconds = 0, anRevealed = false;
const anRack = setupRack($("an-rack"), $("an-form"), $("an-input"));

function anStartTimer() {
  clearInterval(anTimer);
  anSeconds = 0;
  $("an-timer").textContent = "0:00";
  anTimer = setInterval(() => { $("an-timer").textContent = fmtTime(++anSeconds); }, 1000);
}

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
  anStartTimer();
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
  clearInterval(anTimer);
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
    fb.textContent = `Alle ${anGroup.words.length} ord fundet på ${fmtTime(anSeconds)}!${review}`;
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
  const band = { "0-200": "top 200", "200-1000": "201–1.000", "1000-3000": "1.001–3.000", all: "alle" }[c.band];
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
$("tu-quit").addEventListener("click", () => { if (confirm("Afbryd turneringen? Resultatet gemmes ikke.")) tuStop(); });

/* ============================================================
   MINIORD — gyldigt/ugyldigt-quiz for 2-3-bogstavsord
   ============================================================ */
let moWord = null, moIsReal = false, moLocked = false;

function randomFake(len) {
  const letters = "abcdefghijklmnopqrstuvxyzæøå";
  const pool = dict.byLen.get(len);
  for (let tries = 0; tries < 100; tries++) {
    const base = pool[Math.floor(Math.random() * pool.length)];
    const i = Math.floor(Math.random() * len);
    const c = letters[Math.floor(Math.random() * letters.length)];
    const fake = base.slice(0, i) + c + base.slice(i + 1);
    if (!dict.words.has(fake)) return fake;
  }
  return null;
}

function moNext() {
  moLocked = false;
  const sel = $("mo-len").value;
  const len = sel === "23" ? (Math.random() < 0.4 ? 2 : 3) : +sel;
  moIsReal = Math.random() < 0.5;
  if (moIsReal) {
    const pool = dict.byLen.get(len);
    moWord = pool[Math.floor(Math.random() * pool.length)];
  } else {
    moWord = randomFake(len) || dict.byLen.get(len)[0];
    moIsReal = dict.words.has(moWord);
  }
  $("mo-word").innerHTML = wordTilesHTML(moWord, "");
  $("mo-feedback").textContent = " ";
  $("mo-feedback").className = "feedback";
}

function moAnswer(saidReal) {
  if (moLocked || !moWord) return;
  moLocked = true;
  const right = saidReal === moIsReal;
  stats.miniord[right ? "right" : "wrong"]++;
  saveStats();
  const fb = $("mo-feedback");
  const note = moIsReal ? lemmaNote(moWord) : "";
  fb.innerHTML = right
    ? `Rigtigt — “${moWord.toUpperCase()}” er ${moIsReal ? "gyldigt" : "ikke et ord"}. ${note}`
    : `Forkert — “${moWord.toUpperCase()}” er ${moIsReal ? "faktisk gyldigt!" : "ikke et gyldigt ord."} ${note}`;
  fb.className = "feedback " + (right ? "good" : "bad");
  $("mo-score").textContent = `${stats.miniord.right} / ${stats.miniord.right + stats.miniord.wrong}`;
  setTimeout(moNext, right ? 900 : 2100);
}

$("mo-yes").addEventListener("click", () => moAnswer(true));
$("mo-no").addEventListener("click", () => moAnswer(false));
$("mo-len").addEventListener("change", moNext);
document.addEventListener("keydown", (e) => {
  if ($("view-miniord").hidden || ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) || e.target.isContentEditable) return;
  if (e.key === "j" || e.key === "J") moAnswer(true);
  if (e.key === "n" || e.key === "N") moAnswer(false);
});

/* ============================================================
   KROGE
   ============================================================ */
let krWord = null;

function krNext() {
  const len = +$("kr-len").value;
  const pool = dict.byLen.get(len);
  // vælg helst ord som faktisk har kroge (80 % af trækkene)
  for (let tries = 0; ; tries++) {
    krWord = pool[Math.floor(Math.random() * pool.length)];
    const h = hooks(krWord);
    if (h.front.length + h.back.length > 0 || tries > 30 || Math.random() < 0.2) break;
  }
  $("kr-word").innerHTML = wordTilesHTML(krWord, "");
  $("kr-front").value = "";
  $("kr-back").value = "";
  $("kr-result").innerHTML = "";
  focusQuiet($("kr-front"));
}

$("kr-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!krWord) return;
  const h = hooks(krWord);
  const guessF = new Set($("kr-front").value.toLowerCase().replace(/[^a-zæøå]/g, ""));
  const guessB = new Set($("kr-back").value.toLowerCase().replace(/[^a-zæøå]/g, ""));
  const render = (label, actual, guess, makeWord) => {
    const chips = [];
    for (const c of actual) {
      const cls = guess.has(c) ? "hit" : "miss";
      chips.push(`<span class="chip ${cls}" title="${makeWord(c)}">${makeWord(c)}</span>`);
    }
    for (const c of guess) if (!actual.includes(c))
      chips.push(`<span class="chip wrong">${makeWord(c)}</span>`);
    const hits = actual.filter((c) => guess.has(c)).length;
    stats.kroge.hits += hits;
    stats.kroge.misses += actual.length - hits;
    return `<p><b>${label}</b> (${hits}/${actual.length} fundet): ${chips.join(" ") || "<i>ingen kroge</i>"}</p>`;
  };
  stats.kroge.rounds++;
  const html =
    render("Foran", h.front, guessF, (c) => c + krWord) +
    render("Bagpå", h.back, guessB, (c) => krWord + c);
  saveStats();
  $("kr-result").innerHTML = `<div class="hookres">${html}</div>`;
});

$("kr-next").addEventListener("click", krNext);
$("kr-len").addEventListener("change", krNext);

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
    ? `<p class="pos">Kroge — foran: ${h.front.length ? h.front.join(" ").toUpperCase() : "ingen"} ·
       bagpå: ${h.back.length ? h.back.join(" ").toUpperCase() : "ingen"}</p>` : "";
  out.innerHTML = `<div class="verdict good"><h3>${wordTilesHTML(w)}</h3>
    <p><b>Gyldigt</b> · ${wordPoints(w)} point (uden felter)</p>
    <ul>${lis}</ul>${hookLine}</div>`;
});

/* ============================================================
   STATISTIK
   ============================================================ */
function renderStats() {
  const a = stats.anagram, m = stats.miniord, k = stats.kroge;
  const pct = (x, y) => (y ? Math.round((100 * x) / y) + " %" : "–");
  $("st-grid").innerHTML = [
    ["Racks spillet", a.racks],
    ["Ord fundet", a.found],
    ["Ord misset", a.missed],
    ["Anagram-træfsikkerhed", pct(a.found, a.found + a.missed)],
    ["Miniord rigtige", `${m.right} / ${m.right + m.wrong}`],
    ["Miniord-træfsikkerhed", pct(m.right, m.right + m.wrong)],
    ["Kroge-runder", k.rounds],
    ["Kroge-træfsikkerhed", pct(k.hits, k.hits + k.misses)],
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
    : `<p class="hint">Ingen turneringer endnu — prøv fanen Turnering.</p>`;
}
$("st-reset").addEventListener("click", () => {
  if (!confirm("Nulstil al statistik, gentagelser og turneringsrekorder?")) return;
  Object.assign(stats, freshStats());
  saveStats();
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
  $("mo-score").textContent = `${stats.miniord.right} / ${stats.miniord.right + stats.miniord.wrong}`;
  anNext(false); // ingen autofokus ved sideindlæsning — siden må ikke rulle af sig selv
})();
