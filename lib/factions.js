// Factions: named groups the party can side with, anger, or ignore.
// Relations are run-scoped (reset every run). Cult always starts hostile and
// is the boss faction — diplomacy doesn't apply.
//
// Relation values: 'hostile' (-1) | 'neutral' (0) | 'allied' (+1)
// adjustFaction shifts the relation by one step in the requested direction
// and clamps at the ends. Locked factions (e.g., Cult) never shift.

export const RELATIONS = ['hostile', 'neutral', 'allied'];

export const FACTIONS = {
    dwarves: {
        id: 'dwarves',
        name: 'Dwarves',
        glyph: '⛰',
        defaultRelation: 'neutral',
        locked: false,
        description: 'Surface-dwelling clans of the deep mountain.',
    },
    drow: {
        id: 'drow',
        name: 'Drow',
        glyph: '🕷',
        defaultRelation: 'neutral',
        locked: false,
        description: 'Underdark traders and assassins.',
    },
    cult: {
        id: 'cult',
        name: 'Cult',
        glyph: '👁',
        defaultRelation: 'hostile',
        locked: true,
        description: 'Servants of the Lich King. Always hostile.',
    },
};

export function listFactionIds() {
    return Object.keys(FACTIONS);
}

export function getFaction(id) {
    return FACTIONS[id] ?? null;
}

export function defaultFactionRelations() {
    const out = {};
    for (const id of listFactionIds()) out[id] = FACTIONS[id].defaultRelation;
    return out;
}

const ORDER = { hostile: 0, neutral: 1, allied: 2 };
const REVERSE_ORDER = ['hostile', 'neutral', 'allied'];

/**
 * Shift a faction relation by `delta` steps. Returns the new relation, or
 * null if the faction is locked.
 */
export function shiftRelation(currentRelation, delta) {
    const idx = ORDER[currentRelation] ?? 1;
    const next = Math.max(0, Math.min(REVERSE_ORDER.length - 1, idx + delta));
    return REVERSE_ORDER[next];
}
