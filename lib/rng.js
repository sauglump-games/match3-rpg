/**
 * mulberry32 PRNG. Returns a callable rng with `getState`/`setState` so the
 * sequence can be persisted and resumed mid-run.
 *
 * Usage:
 *   const rng = mulberry32(seed);
 *   rng();              // 0..1 float
 *   const s = rng.getState();
 *   ...
 *   const rng2 = mulberry32(0);
 *   rng2.setState(s);   // resume from where rng() left off
 */
export function mulberry32(seed) {
    let state = seed >>> 0;
    function rng() {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    rng.getState = () => state >>> 0;
    rng.setState = (s) => { state = (s >>> 0); };
    return rng;
}
