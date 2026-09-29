import { alphagram, drawWeight, ALPHABET } from "./tiles.js";
import { DATA_FILES } from "./datafiles.js";

export const dict = {
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

export async function loadDict(onProgress) {
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

export function isValid(word) {
  return dict.words.has(word);
}

// Kroge: bogstaver der kan sættes foran/bagpå og stadig give et gyldigt ord
export function hooks(word) {
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
export function loadInfo() {
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

export const POS_LABELS = {
  sb: "substantiv", vb: "verbum", adj: "adjektiv", adv: "adverbium",
  "præp": "præposition", konj: "konjunktion", pron: "pronomen",
  "udråbsord": "udråbsord", lydord: "lydord", talord: "talord",
  art: "artikel", formsubj: "formelt subjekt", iflerord: "del af fast udtryk",
  flerord: "fast udtryk", RO: "fra foreningens RO-liste",
};
