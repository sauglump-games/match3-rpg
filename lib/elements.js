// 16 fantasy magic elements × 4 grades. The stash is the persistent meta-
// progression layer of the game: drops fall into it after every fight, the
// player crafts them up through grades (16-of-N → 1-of-(N+1)), and combines
// them into potions (see potions.js) whose effects only influence procedural
// generation — never hero stats or combat math.
//
// Stash shape:  { [elementId]: [gradeIcount, gradeIIcount, gradeIIIcount, gradeIVcount] }
//   - slot 0 holds grade I, slot 3 holds grade IV
//   - missing keys are treated as all-zero

export const GRADES = ['I', 'II', 'III', 'IV'];
export const MAX_GRADE = GRADES.length;
export const CRAFT_RATIO = 16;

export const ELEMENTS = [
    { id: 'fire',       name: 'Fire',       family: 'classical',  desc: 'Primal flame; the first of the four.' },
    { id: 'water',      name: 'Water',      family: 'classical',  desc: 'Flowing, patient, unyielding.' },
    { id: 'earth',      name: 'Earth',      family: 'classical',  desc: 'Stone and soil — the body of the world.' },
    { id: 'air',        name: 'Air',        family: 'classical',  desc: 'Breath and wind; the carrier of sound.' },
    { id: 'aether',     name: 'Aether',     family: 'quintessence', desc: 'The fifth element; substance of stars.' },
    { id: 'salt',       name: 'Salt',       family: 'alchemical', desc: 'Body: what remains after the fire.' },
    { id: 'sulfur',     name: 'Sulfur',     family: 'alchemical', desc: 'Soul: the fire that is not consumed.' },
    { id: 'mercury',    name: 'Mercury',    family: 'alchemical', desc: 'Spirit: the quick and the between.' },
    { id: 'ice',        name: 'Ice',        family: 'elemental',  desc: 'Stillness so cold it locks fate in place.' },
    { id: 'lightning',  name: 'Lightning',  family: 'elemental',  desc: 'The moment before it touches ground.' },
    { id: 'shadow',     name: 'Shadow',     family: 'esoteric',   desc: 'Borrowed darkness, richer than ink.' },
    { id: 'light',      name: 'Light',      family: 'esoteric',   desc: 'Bottled dawn; bright to the point of salt.' },
    { id: 'blood',      name: 'Blood',      family: 'vital',      desc: 'The first alphabet of bindings.' },
    { id: 'bone',       name: 'Bone',       family: 'vital',      desc: 'Memory, hardened into architecture.' },
    { id: 'moonstone',  name: 'Moonstone',  family: 'celestial',  desc: 'Pale ore that whispers tides.' },
    { id: 'starlight',  name: 'Starlight',  family: 'celestial',  desc: 'Old light still moving through the dark.' },
];

const BY_ID = new Map(ELEMENTS.map(e => [e.id, e]));

export function getElement(id) { return BY_ID.get(id) ?? null; }
export function listElementIds() { return ELEMENTS.map(e => e.id); }

// ----- stash (meta-persistent inventory of elements) -----

/** Empty stash: every element 0 at every grade. */
export function emptyStash() {
    const out = {};
    for (const e of ELEMENTS) out[e.id] = [0, 0, 0, 0];
    return out;
}

/** Ensure the stash has a row for `elementId` and return it. */
function stashRow(stash, elementId) {
    if (!stash[elementId]) stash[elementId] = [0, 0, 0, 0];
    return stash[elementId];
}

/** Read the count of an element at a given grade (1-indexed). */
export function stashCount(stash, elementId, grade) {
    const row = stash[elementId];
    if (!row) return 0;
    return row[grade - 1] ?? 0;
}

/** Add `count` of an element-grade to the stash (mutates). Returns the new count. */
export function addToStash(stash, elementId, grade, count = 1) {
    if (!getElement(elementId)) throw new Error(`Unknown element: ${elementId}`);
    if (grade < 1 || grade > MAX_GRADE) throw new Error(`Bad grade: ${grade}`);
    const row = stashRow(stash, elementId);
    row[grade - 1] += count;
    return row[grade - 1];
}

/** Remove `count` of an element-grade. Returns true on success, false if insufficient. */
export function takeFromStash(stash, elementId, grade, count = 1) {
    if (stashCount(stash, elementId, grade) < count) return false;
    const row = stashRow(stash, elementId);
    row[grade - 1] -= count;
    return true;
}

/** Can we craft one of the next grade from `fromGrade`? */
export function canCraftUpgrade(stash, elementId, fromGrade) {
    if (fromGrade < 1 || fromGrade >= MAX_GRADE) return false;
    return stashCount(stash, elementId, fromGrade) >= CRAFT_RATIO;
}

/**
 * Craft one of grade (fromGrade+1) by consuming CRAFT_RATIO of fromGrade.
 * Returns true on success, false if not enough stock or grade invalid.
 */
export function craftUpgrade(stash, elementId, fromGrade) {
    if (!canCraftUpgrade(stash, elementId, fromGrade)) return false;
    takeFromStash(stash, elementId, fromGrade, CRAFT_RATIO);
    addToStash(stash, elementId, fromGrade + 1, 1);
    return true;
}

/** Total elements owned (sum across all grades, for UI headers). */
export function totalStashSize(stash) {
    let n = 0;
    for (const row of Object.values(stash)) {
        for (const c of row) n += c;
    }
    return n;
}

// ----- post-fight element drop generation -----

/**
 * Roll `count` element+grade offers for the post-fight dialog.
 * Grade distribution is weighted by encounter difficulty:
 *   - base encounters favour grade I; layer progression and elite/boss flags
 *     shift probability mass upward.
 * All 16 elements are candidates on every roll; repeats are allowed across
 * offers so a lucky player can pick a double.
 */
export function rollElementOffers({ count = 3, layer = 0, depth = 6, elite = false, boss = false, rng = Math.random } = {}) {
    const offers = [];
    for (let i = 0; i < count; i++) {
        offers.push(rollSingleOffer({ layer, depth, elite, boss, rng }));
    }
    return offers;
}

function rollSingleOffer({ layer, depth, elite, boss, rng }) {
    const element = ELEMENTS[Math.floor(rng() * ELEMENTS.length)];
    const progress = Math.max(0, Math.min(1, depth > 0 ? layer / depth : 0));
    // Probability table per layer progress. Higher layer = rarer grades more likely.
    // [gradeI, gradeII, gradeIII, gradeIV]
    let weights;
    if (boss) {
        weights = [0.10, 0.40, 0.35, 0.15];
    } else if (elite) {
        weights = [0.30, 0.45, 0.20, 0.05];
    } else if (progress < 0.33) {
        weights = [0.75, 0.22, 0.03, 0.00];
    } else if (progress < 0.66) {
        weights = [0.55, 0.35, 0.09, 0.01];
    } else {
        weights = [0.35, 0.40, 0.20, 0.05];
    }
    const grade = weightedPick(weights, rng) + 1; // 1..4
    return { elementId: element.id, grade };
}

function weightedPick(weights, rng) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
    }
    return weights.length - 1;
}
