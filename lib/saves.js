// AD&D 2e saving throws per rpg-fidelity-spec.md §2.1. Five categories,
// d20 ≥ target = saved. Each row is [P/P/D, R/S/W, Pet/Poly, Breath, Spell].
// WIS magical-defense bonus adds to the Spell column only.
//
// Actors carry a precomputed `saves = { ppd, rsw, ptp, breath, spell }` vector
// so callers don't have to re-walk the class × level table each time. Saves
// are recomputed on level-up in game.js.

import { wisMagicDefenseMod } from './abilities.js';

export const SAVE_CATEGORIES = ['ppd', 'rsw', 'ptp', 'breath', 'spell'];

export const SAVE_LABEL = {
    ppd:    'Paralyzation / Poison / Death',
    rsw:    'Rod / Staff / Wand',
    ptp:    'Petrification / Polymorph',
    breath: 'Breath Weapon',
    spell:  'Spell',
};

// Spec §2.1: each row spans a level band. Lookup is "highest band ≤ level".
// `bandUpTo` is the top level of that row; rows are in ascending order.
//
// Warrior (Fighter/Paladin/Ranger):
const WARRIOR_SAVES = [
    { bandUpTo:  2, v: [14, 16, 15, 17, 17] },
    { bandUpTo:  4, v: [13, 15, 14, 16, 16] },
    { bandUpTo:  6, v: [11, 13, 12, 13, 14] },
    { bandUpTo:  8, v: [10, 12, 11, 12, 13] },
    { bandUpTo: 10, v: [ 8, 10,  9,  9, 11] },
    { bandUpTo: 12, v: [ 7,  9,  8,  8, 10] },
    { bandUpTo: 14, v: [ 5,  7,  6,  5,  8] },
    { bandUpTo: 16, v: [ 4,  6,  5,  4,  7] },
    { bandUpTo: 18, v: [ 3,  5,  4,  4,  6] },
    { bandUpTo: 20, v: [ 2,  4,  3,  3,  5] },
];

// Priest (Cleric/Druid):
const PRIEST_SAVES = [
    { bandUpTo:  3, v: [10, 14, 13, 16, 15] },
    { bandUpTo:  6, v: [ 9, 13, 12, 15, 14] },
    { bandUpTo:  9, v: [ 7, 11, 10, 13, 12] },
    { bandUpTo: 12, v: [ 6, 10,  9, 12, 11] },
    { bandUpTo: 15, v: [ 5,  9,  8, 11, 10] },
    { bandUpTo: 18, v: [ 4,  8,  7, 10,  9] },
    { bandUpTo: 20, v: [ 2,  6,  5,  8,  7] },
];

// Rogue (Thief):
const ROGUE_SAVES = [
    { bandUpTo:  4, v: [13, 14, 12, 16, 15] },
    { bandUpTo:  8, v: [12, 12, 11, 15, 13] },
    { bandUpTo: 12, v: [11, 10, 10, 13, 11] },
    { bandUpTo: 16, v: [10,  8,  9, 12,  9] },
    { bandUpTo: 20, v: [ 8,  6,  7, 10,  7] },
];

// Wizard (Mage):
const WIZARD_SAVES = [
    { bandUpTo:  5, v: [14, 11, 13, 15, 12] },
    { bandUpTo: 10, v: [13,  9, 11, 13, 10] },
    { bandUpTo: 15, v: [11,  7,  9, 11,  8] },
    { bandUpTo: 20, v: [10,  5,  7,  8,  6] },
];

function tableForRole(role) {
    switch (role) {
        case 'warrior':
        case 'fighter':
        case 'paladin':
        case 'ranger':
            return WARRIOR_SAVES;
        case 'cleric':
        case 'druid':
            return PRIEST_SAVES;
        case 'rogue':
        case 'thief':
            return ROGUE_SAVES;
        case 'mage':
        case 'wizard':
        case 'summoner':
            return WIZARD_SAVES;
        default:
            return WARRIOR_SAVES;
    }
}

function rowForLevel(table, level) {
    const lvl = Math.max(1, level | 0);
    for (const row of table) if (lvl <= row.bandUpTo) return row.v;
    return table[table.length - 1].v;
}

/**
 * Compute a fresh save vector for a hero at the given class-level.
 * Returns an object keyed by SAVE_CATEGORIES. These are raw target numbers;
 * the WIS magical-defense bonus is *not* pre-applied — it's added at roll
 * time in `rollSave`, because WIS can change via equipment later.
 */
export function savesForHero(role, level) {
    const row = rowForLevel(tableForRole(role), level);
    return {
        ppd:    row[0],
        rsw:    row[1],
        ptp:    row[2],
        breath: row[3],
        spell:  row[4],
    };
}

/**
 * Default save vector for a generic monster. Spec defers monster save tables
 * past S-tier; for Phase 4 we approximate "saves as a Fighter of half-HD".
 * HD is estimated from maxHp at a typical 1d8 hit die.
 */
export function defaultMonsterSaves(hd = 1) {
    const fighterLevel = Math.max(1, Math.min(20, Math.round(hd)));
    return savesForHero('warrior', fighterLevel);
}

export function normalizeSaveVector(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const k of SAVE_CATEGORIES) {
        const v = raw[k];
        out[k] = (typeof v === 'number' && Number.isFinite(v)) ? v : 20;
    }
    return out;
}

/**
 * Roll a saving throw against one category. Returns
 *   { saved, natural, target, total }
 * where `saved = total >= target`. Natural 1 always fails; natural 20 always
 * succeeds. WIS mag-def bonus applies only to the `spell` category (and only
 * when the actor has abilities, i.e., heroes — monsters skip the bonus).
 */
export function rollSave(actor, category, rng) {
    if (!SAVE_CATEGORIES.includes(category)) return { saved: false, natural: 0, target: 99, total: 0 };
    const saves = actor?.saves ?? {};
    const target = saves[category] ?? 20;
    const natural = 1 + Math.floor(rng() * 20);
    let mod = 0;
    if (category === 'spell' && actor?.abilities?.wis != null) {
        mod = wisMagicDefenseMod(actor.abilities.wis);
    }
    const total = natural + mod;
    let saved;
    if (natural === 1) saved = false;
    else if (natural === 20) saved = true;
    else saved = total >= target;
    return { saved, natural, target, total };
}
