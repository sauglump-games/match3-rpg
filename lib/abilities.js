// AD&D 2e ability scores per ADR 0002 and reviews/rpg-fidelity-spec.md §1.
// Six abilities, range 3-18. Modifier tables come from the PHB (the EotB
// guide names them but doesn't tabulate). No special 18/00 STR yet — spec
// defers percentile strength to post-S-tier.
//
// This module is pure data + lookups. It does NOT apply modifiers to heroes
// at creation time; callers decide when to consume a modifier (Phase 3 wires
// STR-hit into attack rolls, Phase 2 reads WIS for bonus spells, etc.).

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITY_LABEL = {
    str: 'Strength',
    dex: 'Dexterity',
    con: 'Constitution',
    int: 'Intelligence',
    wis: 'Wisdom',
    cha: 'Charisma',
};

/** Average-human baseline used when a save or hero template omits abilities. */
export const DEFAULT_ABILITY_SCORE = 11;

export function defaultAbilities() {
    return { str: 11, dex: 11, con: 11, int: 11, wis: 11, cha: 11 };
}

/** 4d6-drop-lowest with a caller-supplied RNG. Returns an integer 3..18. */
export function rollAbility(rng) {
    const rolls = [
        1 + Math.floor(rng() * 6),
        1 + Math.floor(rng() * 6),
        1 + Math.floor(rng() * 6),
        1 + Math.floor(rng() * 6),
    ].sort((a, b) => a - b);
    return rolls[1] + rolls[2] + rolls[3];
}

/** Roll a full ability block (4d6-drop each, six times). */
export function rollAbilities(rng) {
    const out = {};
    for (const a of ABILITIES) out[a] = rollAbility(rng);
    return out;
}

/** Clamp to 3..18 and coerce any missing entries to 11. Used on load/migrate. */
export function normalizeAbilities(abilities) {
    const out = defaultAbilities();
    if (!abilities) return out;
    for (const a of ABILITIES) {
        const v = abilities[a];
        if (typeof v === 'number' && Number.isFinite(v)) {
            out[a] = Math.max(3, Math.min(18, Math.round(v)));
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// STR — melee to-hit / damage / weight allowance
// Spec §1.1 STR table. Weight is in coins (AD&D 2e), used later for encumbrance.
// ---------------------------------------------------------------------------

const STR_TABLE = [
    // [upToScore, hit, dmg, weight]
    [3,  -3, -1,   5],
    [5,  -2, -1,  10],
    [7,  -1,  0,  20],
    [9,   0,  0,  35],
    [11,  0,  0,  40],
    [13,  0,  0,  45],
    [15,  0,  0,  55],
    [16,  0, +1,  70],
    [17, +1, +1,  85],
    [18, +1, +2, 110],
];

function strRow(score) {
    for (const row of STR_TABLE) if (score <= row[0]) return row;
    return STR_TABLE[STR_TABLE.length - 1];
}

export function strHitMod(score)    { return strRow(score)[1]; }
export function strDamageMod(score) { return strRow(score)[2]; }
export function strWeightLimit(score) { return strRow(score)[3]; }

// ---------------------------------------------------------------------------
// DEX — missile to-hit / AC adjustment / reaction adj
// AC adj is SUBTRACTED from AC (descending AC; lower is better).
// ---------------------------------------------------------------------------

const DEX_TABLE = [
    [3,  -3, +4, -3],
    [5,  -2, +3, -2],
    [8,  -1, +2, -1],
    [14,  0,  0,  0],
    [15,  0, -1,  0],
    [16, +1, -2, +1],
    [17, +2, -3, +2],
    [18, +3, -4, +3],
];

function dexRow(score) {
    for (const row of DEX_TABLE) if (score <= row[0]) return row;
    return DEX_TABLE[DEX_TABLE.length - 1];
}

export function dexMissileMod(score) { return dexRow(score)[1]; }
/** AD&D descending-AC adjustment. Subtract this number from the base AC to apply. */
export function dexAcAdj(score)      { return dexRow(score)[2]; }
export function dexReactionMod(score){ return dexRow(score)[3]; }

// ---------------------------------------------------------------------------
// CON — HP bonus per hit die, with extended range for warriors
// Non-warrior cap is +2; Fighter/Paladin/Ranger can reach +4 at CON 18.
// ---------------------------------------------------------------------------

const CON_HP_TABLE = [
    // [upTo, nonWarrior, warrior]
    [3,  -2, -2],
    [6,  -1, -1],
    [14,  0,  0],
    [15, +1, +1],
    [16, +2, +2],
    [17, +2, +3],
    [18, +2, +4],
];

function conRow(score) {
    for (const row of CON_HP_TABLE) if (score <= row[0]) return row;
    return CON_HP_TABLE[CON_HP_TABLE.length - 1];
}

const WARRIOR_ROLES = new Set(['warrior', 'fighter', 'paladin', 'ranger']);

export function conHpMod(score, role) {
    const warrior = WARRIOR_ROLES.has(role);
    return warrior ? conRow(score)[2] : conRow(score)[1];
}

// Spec §1.1 CON table — system-shock % (survive polymorph / petrification /
// magical shocks) and resurrection-survival % (Raise Dead). Percentages are
// AD&D 2e PHB values. Callers convert to a success roll via d% ≤ target.

const CON_SYS_SHOCK = [
    // [upTo, sysShock%, resSurvival%]
    [3,  35, 40],
    [4,  40, 45],
    [5,  45, 50],
    [6,  50, 55],
    [7,  55, 60],
    [8,  60, 65],
    [9,  65, 70],
    [10, 70, 75],
    [11, 75, 80],
    [12, 80, 85],
    [13, 85, 88],
    [14, 88, 90],
    [15, 90, 92],
    [16, 95, 94],
    [17, 97, 96],
    [18, 99, 98],
    [19, 99, 99],
];

function conSysRow(score) {
    for (const row of CON_SYS_SHOCK) if (score <= row[0]) return row;
    return CON_SYS_SHOCK[CON_SYS_SHOCK.length - 1];
}

export function conSystemShock(score)       { return conSysRow(score)[1]; }
export function conResurrectionSurvival(score) { return conSysRow(score)[2]; }

/**
 * Roll d100 ≤ conResurrectionSurvival(CON). Returns true if the hero survives
 * a Raise Dead attempt. Used by the cleric Raise Dead spell (spec §5).
 */
export function rollResurrectionSurvival(score, rng) {
    const target = conResurrectionSurvival(score);
    const roll = 1 + Math.floor(rng() * 100);
    return { roll, target, survived: roll <= target };
}

// ---------------------------------------------------------------------------
// INT — max spell level + learn %.  Mages get no bonus slots from INT.
// ---------------------------------------------------------------------------

const INT_TABLE = [
    [9,  4, 35],
    [12, 5, 55],
    [14, 6, 65],
    [16, 7, 75],
    [17, 8, 85],
    [18, 9, 95],
];

function intRow(score) {
    for (const row of INT_TABLE) if (score <= row[0]) return row;
    return INT_TABLE[INT_TABLE.length - 1];
}

export function intMaxSpellLevel(score) { return intRow(score)[0] <= 8 ? 0 : intRow(score)[1]; }
export function intLearnPct(score)      { return intRow(score)[2]; }

// ---------------------------------------------------------------------------
// WIS — bonus cleric/paladin/druid spell slots + magical-defense adj
// WIS mag-def is ADDED to the save-vs-spell roll.
// ---------------------------------------------------------------------------

const WIS_TABLE = [
    // [upTo, bonusL1, bonusL2, bonusL3, bonusL4, magDef]
    [12, 0, 0, 0, 0,  0],
    [13, 1, 0, 0, 0,  0],
    [14, 2, 0, 0, 0,  0],
    [15, 2, 1, 0, 0, +1],
    [16, 2, 2, 0, 0, +2],
    [17, 2, 2, 1, 0, +3],
    [18, 2, 2, 1, 1, +4],
];

function wisRow(score) {
    for (const row of WIS_TABLE) if (score <= row[0]) return row;
    return WIS_TABLE[WIS_TABLE.length - 1];
}

/** Returns { 1, 2, 3, 4 } map of bonus slots per spell level. */
export function wisBonusSpells(score) {
    const row = wisRow(score);
    return { 1: row[1], 2: row[2], 3: row[3], 4: row[4] };
}

export function wisMagicDefenseMod(score) { return wisRow(score)[5]; }

// ---------------------------------------------------------------------------
// CHA — max henchmen, loyalty, reaction adj. Used later for recruit checks.
// ---------------------------------------------------------------------------

const CHA_TABLE = [
    [3,  1,  -30, -25],
    [8,  3,   -5,   0],
    [13, 5,    0,   0],
    [15, 7,  +15, +15],
    [17, 10, +30, +30],
    [18, 15, +40, +35],
];

function chaRow(score) {
    for (const row of CHA_TABLE) if (score <= row[0]) return row;
    return CHA_TABLE[CHA_TABLE.length - 1];
}

export function chaMaxHenchmen(score) { return chaRow(score)[1]; }
export function chaLoyaltyMod(score)  { return chaRow(score)[2]; }
export function chaReactionMod(score) { return chaRow(score)[3]; }

// ---------------------------------------------------------------------------
// Prime-requisite XP bonus (§1, Character Guide §4.1). +10% when every prime
// requisite is >= 16. Class -> list of prime-requisite abilities.
// ---------------------------------------------------------------------------

export const PRIME_REQUISITES = {
    warrior: ['str'],
    fighter: ['str'],
    paladin: ['str', 'cha'],
    ranger:  ['str', 'dex', 'wis'],
    mage:    ['int'],
    cleric:  ['wis'],
    druid:   ['wis', 'cha'],
    rogue:   ['dex'],
    thief:   ['dex'],
    summoner: ['cha'], // non-AD&D project class; use CHA as closest thematic fit
};

/** Returns 1.10 when every prime requisite is >=16 for this role, else 1.0. */
export function primeRequisiteXpMultiplier(role, abilities) {
    const primes = PRIME_REQUISITES[role];
    if (!primes || !abilities) return 1;
    for (const p of primes) {
        if ((abilities[p] ?? 0) < 16) return 1;
    }
    return 1.10;
}
