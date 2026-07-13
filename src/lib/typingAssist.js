/* ----------------------------------------------------------------------------
   typingAssist — the typed line's quiet keyboard aid.

   One job, client-side, instant (sub-millisecond), offline:
   - complete: the most-likely completion of the word being typed (a frequency
     trie), used as the GENERAL fallback when Tex has no grounded completion.

   It is deliberately NOT neural: the research is unambiguous that an in-browser
   LM is 100MB–2GB to download and decodes at sub-second speed — wrong for a
   faint, always-on aid. A frequency trie hits ~iOS-2015 quality at a fraction
   of that, in <1ms, and stays silent when unsure (which is the soul: never
   confidently wrong). The vocabulary is lazy-loaded ONLY when someone types, as
   its own chunk — never in the main bundle.

   Doctrine: this is the USER's typing aid, not Tex's voice. It completes ordin-
   ary English only; the moment a token could be a grounded entity, the caller's
   grounded path wins. It abstains generously. (An earlier SymSpell autocorrect
   pass was retired: a surface that silently edits the operator's own words is
   the aid being confidently wrong.)
---------------------------------------------------------------------------- */

let _ready = false;
let _loading = null;
let _trie = null; /* completion trie; each node carries its most-frequent word */

/* Lazy build — load the vocabulary chunk and index it once, on first use. */
export function init() {
  if (_ready) return Promise.resolve();
  if (_loading) return _loading;
  _loading = import("./typingDict.js")
    .then(({ WORDS }) => {
      const words = WORDS.split(" ");
      _trie = {};
      for (let r = 0; r < words.length; r += 1) {
        const w = words[r];
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
      /* Honest failure: stay un-ready → no completion. */
      _loading = null;
    });
  return _loading;
}

export function isReady() {
  return _ready;
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
