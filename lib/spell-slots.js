// Prepared-spell slots per AD&D 2e / EotB (rpg-fidelity-spec.md §4.1).
// Replaces the mana pool. Casters memorize spells into a finite number of
// slots per spell-level; each cast consumes one slot. Slots refresh at Camp.
//
// Per ADR 0002: "score is fuel; slots are the container." Casting also
// requires color score (handled at the Game layer), but slot availability
// is the primary gate and lives here.

import { wisBonusSpells } from './abilities.js';

// Indexed by caster level. Row is [L1, L2, L3, L4, L5] slots at that level.
// A class gains access to a spell level as soon as its row at that character
// level has a value >0 for that spell level. Spec §4.1.

const MAGE_SLOTS = [
    [],               // L0 unused
    [1],              // L1
    [2],              // L2
    [2, 1],           // L3
    [3, 2],           // L4
    [4, 2, 1],        // L5
    [4, 2, 2],        // L6
    [4, 3, 2, 1],     // L7
    [4, 3, 3, 2],     // L8
    [4, 3, 3, 2, 1],  // L9
    [4, 4, 3, 2, 2],  // L10
    [4, 4, 4, 3, 3],  // L11
];

const CLERIC_SLOTS = [
    [],               // L0
    [1],              // L1
    [2],              // L2
    [2, 1],           // L3
    [3, 2],           // L4
    [3, 3, 1],        // L5
    [3, 3, 2],        // L6
    [3, 3, 2, 1],     // L7
    [3, 3, 3, 2],     // L8
    [4, 4, 3, 2, 1],  // L9
    [4, 4, 3, 3, 2],  // L10
];

// Paladins gain divine spells starting at L9 (spec §4.1).
const PALADIN_SLOTS = [
    [], [], [], [], [], [], [], [], [],  // L0..L8 none
    [1],       // L9
    [2],       // L10
    [2, 1],    // L11
];

// AD&D 2e Druid progression (PHB p.35). Druids level up one spell level
// behind Clerics at low tiers and cap at L7 (spec §2.1 notes their L14
// AD&D cap). We reproduce the AD&D 2e table here up to L10 since our
// party level cap is well below the Druid cap.
const DRUID_SLOTS = [
    [],               // L0
    [2],              // L1
    [3],              // L2
    [3, 1],           // L3
    [3, 2],           // L4
    [3, 3, 1],        // L5
    [3, 3, 2],        // L6
    [3, 3, 2, 1],     // L7
    [3, 3, 3, 2],     // L8
    [4, 3, 3, 2, 1],  // L9
    [4, 4, 3, 2, 2],  // L10
];

// Partial-caster Rangers (spec §4.1): draw from a tiny druid/priest list
// starting at char-L8 with 1 L1 slot, L9 adds a second, L10 unlocks L2, etc.
const RANGER_SLOTS = [
    [], [], [], [], [], [], [], [],  // L0..L7: none
    [1],       // L8
    [2],       // L9
    [2, 1],    // L10
    [2, 2],    // L11
    [3, 2, 1], // L12
];

function tableForRole(role) {
    switch (role) {
        case 'mage':    return MAGE_SLOTS;
        case 'cleric':  return CLERIC_SLOTS;
        case 'druid':   return DRUID_SLOTS;
        case 'paladin': return PALADIN_SLOTS;
        case 'ranger':  return RANGER_SLOTS;
        default:        return null;   // non-caster
    }
}

export const DIVINE_CASTERS = new Set(['cleric', 'druid', 'paladin']);

export function isCasterRole(role) {
    return tableForRole(role) !== null;
}

/**
 * Max slots by level for a hero at their current level, WIS bonus included
 * for divine casters. Returns `{ 1: n, 2: n, … }` — only levels with >0
 * slots are present. Non-casters return `{}`.
 */
export function maxSlotsForHero(role, level, abilities = {}) {
    const table = tableForRole(role);
    if (!table) return {};
    const rowIdx = Math.max(0, Math.min(level, table.length - 1));
    const row = table[rowIdx] ?? [];
    const out = {};
    for (let i = 0; i < row.length; i++) {
        if (row[i] > 0) out[i + 1] = row[i];
    }
    if (DIVINE_CASTERS.has(role)) {
        const bonus = wisBonusSpells(abilities.wis ?? 11);
        for (const [lvl, extra] of Object.entries(bonus)) {
            // WIS bonus only applies at spell levels the caster can already cast.
            if ((out[lvl] ?? 0) > 0 && extra > 0) out[lvl] += extra;
        }
    }
    return out;
}

/** Fresh slot state for a new hero: all slots full (used = 0). */
export function freshSlotState(role, level, abilities) {
    const max = maxSlotsForHero(role, level, abilities);
    const used = {};
    for (const lvl of Object.keys(max)) used[lvl] = 0;
    return { max, used };
}

/** Remaining slots at a given spell level. */
export function availableSlots(slots, level) {
    if (!slots?.max || !slots?.used) return 0;
    return Math.max(0, (slots.max[level] ?? 0) - (slots.used[level] ?? 0));
}

/** Spend one slot of a given level. Returns true on success. */
export function consumeSlot(slots, level) {
    if (availableSlots(slots, level) <= 0) return false;
    slots.used[level] = (slots.used[level] ?? 0) + 1;
    return true;
}

/** Refill all slots to full (Camp). No-op on non-casters. */
export function refillAllSlots(slots) {
    if (!slots?.used) return;
    for (const lvl of Object.keys(slots.used)) slots.used[lvl] = 0;
}

/**
 * Recompute `slots.max` after a level-up, ability change, or equipment swap.
 * Preserves `slots.used` across the recompute; prunes used entries for levels
 * that no longer exist and zero-initializes entries for newly-unlocked levels.
 */
export function recomputeMaxSlots(slots, role, level, abilities, itemBonus = {}) {
    const base = maxSlotsForHero(role, level, abilities);
    const max = { ...base };
    for (const [lvl, n] of Object.entries(itemBonus)) {
        if (n > 0) max[lvl] = (max[lvl] ?? 0) + n;
    }
    slots.max = max;
    for (const lvl of Object.keys(slots.used)) {
        if (!(lvl in max)) delete slots.used[lvl];
    }
    for (const lvl of Object.keys(max)) {
        if (!(lvl in slots.used)) slots.used[lvl] = 0;
    }
    return slots;
}

/**
 * Normalize saved slot data from disk. Ensures { max, used } both exist as
 * plain objects with numeric values. Used by save-schema.js on hydrate.
 */
export function normalizeSlotState(raw) {
    if (!raw || typeof raw !== 'object') return { max: {}, used: {} };
    const max = {};
    const used = {};
    if (raw.max && typeof raw.max === 'object') {
        for (const [k, v] of Object.entries(raw.max)) {
            if (Number.isFinite(v)) max[k] = Math.max(0, Math.floor(v));
        }
    }
    if (raw.used && typeof raw.used === 'object') {
        for (const [k, v] of Object.entries(raw.used)) {
            if (Number.isFinite(v)) used[k] = Math.max(0, Math.floor(v));
        }
    }
    for (const k of Object.keys(max)) if (!(k in used)) used[k] = 0;
    return { max, used };
}
