// Officiel dansk brikfordeling: 98 bogstavbrikker + 2 blanke = 100.
// [antal, point] — q og w findes ikke som brikker (kun via blank).
export const DIST = {
  a: [7, 1], b: [4, 3], c: [2, 8], d: [5, 2], e: [9, 1], f: [3, 3],
  g: [3, 3], h: [2, 4], i: [4, 3], j: [2, 4], k: [4, 3], l: [5, 2],
  m: [3, 3], n: [6, 1], o: [5, 2], p: [2, 4], r: [6, 1], s: [5, 2],
  t: [5, 2], u: [3, 3], v: [3, 3], x: [1, 8], y: [2, 4], z: [1, 8],
  "æ": [2, 4], "ø": [2, 4], "å": [2, 4],
};
export const BLANKS = 2;

export const ALPHABET = "abcdefghijklmnopqrstuvwxyzæøå".split("");
const ORDER = new Map(ALPHABET.map((c, i) => [c, i]));

export function points(letter) {
  const d = DIST[letter];
  return d ? d[1] : 0; // q/w kan kun lægges med blank (0 point)
}

export function tileCount(letter) {
  const d = DIST[letter];
  return d ? d[0] : 0;
}

export function wordPoints(word) {
  let s = 0;
  for (const c of word) s += points(c);
  return s;
}

// Alfagram: ordets bogstaver i dansk alfabetisk orden (a-z, æ, ø, å)
export function alphagram(word) {
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
export function drawWeight(alpha) {
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
export function drawRack(size) {
  const bag = [];
  for (const [c, [n]] of Object.entries(DIST)) for (let i = 0; i < n; i++) bag.push(c);
  const rack = [];
  for (let i = 0; i < size; i++) {
    const j = Math.floor(Math.random() * bag.length);
    rack.push(bag.splice(j, 1)[0]);
  }
  return rack;
}

export function tileHTML(letter, size = "") {
  const cls = "tile" + (size ? " " + size : "") + (DIST[letter] ? "" : " blank");
  const p = points(letter);
  return `<span class="${cls}" aria-hidden="true">${letter}<sub>${p || ""}</sub></span>`;
}

// Et ord som brikker; skærmlæsere får hele ordet i stedet for bogstav for bogstav
export function wordTilesHTML(word, size = "small") {
  return `<span class="word" role="img" aria-label="${word.toUpperCase()}">` +
    [...word].map((c) => tileHTML(c, size)).join("") + "</span>";
}

// Et rack af brikker, man kan trykke på for at bygge et ord
export function rackButtonsHTML(letters) {
  return [...letters].map((c, i) => {
    const p = points(c);
    const cls = "tile" + (DIST[c] ? "" : " blank");
    return `<button type="button" class="${cls}" data-i="${i}" data-letter="${c}" ` +
      `aria-label="${c.toUpperCase()}, ${p} point">${c}<sub aria-hidden="true">${p || ""}</sub></button>`;
  }).join("");
}
