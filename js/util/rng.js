// Seedable random number generator (mulberry32) plus utilities.
window.BBGM_RNG = (function () {
  function makeRng(seed) {
    let s = seed >>> 0;
    if (s === 0) s = 0x9e3779b9;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStringToSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rint(rng, lo, hi) {
    return Math.floor(rng() * (hi - lo + 1)) + lo;
  }

  function rfloat(rng, lo, hi) {
    return rng() * (hi - lo) + lo;
  }

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function pickWeighted(rng, items, getWeight) {
    let total = 0;
    for (const it of items) total += getWeight(it);
    let r = rng() * total;
    for (const it of items) {
      r -= getWeight(it);
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  function shuffle(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Box-Muller normal
  function rnormal(rng, mean = 0, stdev = 1) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  return { makeRng, hashStringToSeed, rint, rfloat, pick, pickWeighted, shuffle, rnormal, clamp };
})();
