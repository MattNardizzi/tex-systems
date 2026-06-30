/* ----------------------------------------------------------------------------
   typingAssist — the typed line's quiet keyboard aid.

   Two jobs, both client-side, both instant (sub-millisecond), both offline:
   - autocorrect: fix an ordinary typo on a word boundary (SymSpell symmetric-
     delete over a frequency-ranked vocabulary), conservatively and reversibly.
   - complete: the most-likely completion of the word being typed (a frequency
     trie), used as the GENERAL fallback when Tex has no grounded completion.

   It is deliberately NOT neural: the research is unambiguous that an in-browser
   LM is 100MB–2GB to download and decodes at sub-second speed — wrong for a
   faint, always-on aid. SymSpell + a trie hit ~iOS-2015 quality at ~75KB and
   <1ms, and stay silent when unsure (which is the soul: never confidently
   wrong). The vocabulary is lazy-loaded ONLY when someone types, as its own
   chunk — never in the main bundle.

   Doctrine: this is the USER's typing aid, not Tex's voice. It completes/cor-
   rects ordinary English only; the moment a token could be a grounded entity,
   the caller's grounded path wins. It abstains generously.
---------------------------------------------------------------------------- */

let _ready = false;
let _loading = null;
let _dict = null; /* Set<string> — is-this-a-real-word */
let _rank = null; /* Map<string, number> — 0 = most frequent */
let _deletes = null; /* Map<deleteKey, string[]> — SymSpell index (maxED 1) */
let _trie = null; /* completion trie; each node carries its most-frequent word */

const MAX_ED = 1; /* single-char typos (sub/ins/del/transpose) — the common ones */

/* All strings obtained by deleting exactly one character. */
function deletes1(word) {
  const out = [];
  for (let i = 0; i < word.length; i += 1) {
    out.push(word.slice(0, i) + word.slice(i + 1));
  }
  return out;
}

/* Damerau–Levenshtein (optimal string alignment), bounded — so a transposition
   ("teh"→"the") costs 1, not 2. Returns a number > maxED once it's hopeless. */
function osaDistance(a, b, maxED) {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > maxED) return maxED + 1;
  let prevPrev = new Array(bl + 1).fill(0);
  let prev = new Array(bl + 1);
  let cur = new Array(bl + 1);
  for (let j = 0; j <= bl; j += 1) prev[j] = j;
  for (let i = 1; i <= al; i += 1) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= bl; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrev[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxED) return maxED + 1;
    const t = prevPrev;
    prevPrev = prev;
    prev = cur;
    cur = t;
  }
  return prev[bl];
}

/* Lazy build — load the vocabulary chunk and index it once, on first use. */
export function init() {
  if (_ready) return Promise.resolve();
  if (_loading) return _loading;
  _loading = import("./typingDict.js")
    .then(({ WORDS }) => {
      const words = WORDS.split(" ");
      _dict = new Set(words);
      _rank = new Map();
      _deletes = new Map();
      _trie = {};
      for (let r = 0; r < words.length; r += 1) {
        const w = words[r];
        _rank.set(w, r);
        /* SymSpell index: map each single-char deletion of w back to w. */
        for (const d of deletes1(w)) {
          const bucket = _deletes.get(d);
          if (bucket) bucket.push(w);
          else _deletes.set(d, [w]);
        }
        /* completion trie: every node remembers the most-frequent word beneath. */
        let node = _trie;
        for (let i = 0; i < w.length; i += 1) {
          const ch = w[i];
          node.c = node.c || {};
          node = node.c[ch] || (node.c[ch] = {});
          if (node.best === undefined || r < node.best) {
            node.best = r;
            node.word = w;
          }
        }
      }
      _ready = true;
    })
    .catch(() => {
      /* Honest failure: stay un-ready → no correction, no completion. */
      _loading = null;
    });
  return _loading;
}

export function isReady() {
  return _ready;
}

/* Correct a single just-finished word, or return null to leave it alone.
   Conservative by design: only touches an all-lowercase out-of-dictionary token
   that has ONE dominant close real word. Never corrects proper nouns, acronyms,
   URLs, code, or anything already a real word (the caller also gates on those). */
export function correct(word) {
  if (!_ready || !word || word.length < 2) return null;
  if (!/^[a-z]+$/.test(word)) return null; /* protect caps / digits / symbols */
  if (_dict.has(word)) return null; /* already a real word — don't touch it */
  const maxED = word.length <= 4 ? 1 : MAX_ED;

  const cands = new Set();
  const buk = _deletes.get(word);
  if (buk) for (const w of buk) cands.add(w); /* dict words that delete to `word` */
  for (const d of deletes1(word)) {
    const b = _deletes.get(d);
    if (b) for (const w of b) cands.add(w);
    if (_dict.has(d)) cands.add(d); /* a deletion of `word` is itself a word */
  }
  if (cands.size === 0) return null;

  let best = null;
  let bestED = maxED + 1;
  let bestRank = Infinity;
  let tieAtBest = false;
  for (const w of cands) {
    const ed = osaDistance(word, w, maxED);
    if (ed > maxED) continue;
    const r = _rank.get(w);
    if (ed < bestED || (ed === bestED && r < bestRank)) {
      best = w;
      bestED = ed;
      bestRank = r;
      tieAtBest = false;
    } else if (ed === bestED && r === bestRank) {
      tieAtBest = true;
    }
  }
  if (!best || tieAtBest) return null;
  /* Only correct toward a reasonably common word — avoid "fixing" a typo into an
     obscure dictionary entry the user didn't mean. */
  if (bestRank > 7000) return null;
  return best === word ? null : best;
}

/* The most-likely completion SUFFIX of the word being typed (general fallback).
   Abstains on short prefixes, on non-alpha, and when the best word in the
   subtree is the prefix itself (a common whole word — don't nag). */
export function complete(prefix, minLen = 3) {
  if (!_ready || !prefix || prefix.length < minLen) return "";
  if (!/^[a-z]+$/.test(prefix)) return "";
  let node = _trie;
  for (let i = 0; i < prefix.length; i += 1) {
    node = node.c && node.c[prefix[i]];
    if (!node) return "";
  }
  const w = node.word;
  if (!w || w.length <= prefix.length) return "";
  /* Only the common tail of the vocabulary — keep completions familiar. */
  if (node.best > 6000) return "";
  return w.slice(prefix.length);
}
