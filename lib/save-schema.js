// Serialization for a Game instance. Kept separate from game.js so the shape
// of a save record is declared in one place, not woven through the state
// machine. When adding persistent fields, update SCHEMA_FIELDS + any custom
// serialize/hydrate cases below. Migrations live here too.

import { Board } from './board.js';
import { Encounter } from './combat.js';
import { defaultFactionRelations } from './factions.js';
import { createQuestRunnerFromSnapshot } from './quest-runner.js';
import { findEventTemplate } from './events.js';
import { mulberry32 } from './rng.js';
import { STARTING_RATIONS, STARTING_TORCHES } from './game.js';
import { normalizeAbilities } from './abilities.js';
import { freshSlotState, normalizeSlotState, recomputeMaxSlots } from './spell-slots.js';
import { equipmentSpellSlotBonus } from './items.js';
import { thac0ForHero } from './thac0.js';
import { savesForHero, normalizeSaveVector } from './saves.js';

// Bumped to 2 when the mana pool was replaced with prepared spell slots
// (rpg-fidelity-plan.md Phase 2). Older v1 saves are migrated on load.
export const SAVE_VERSION = 2;

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

// Declarative field list for fields that round-trip as plain JSON (no custom
// serialize/hydrate logic beyond deep-clone / default-fallback). One row per
// field keeps "serialize wrote X but hydrate forgot to read it" bugs rare.
//
// Each entry: [name, { clone?: boolean, default?: any }]
//   clone:   true  → deepClone on write, deepClone on read
//            false → shallow spread ({ ...x }) on write, ?? default on read
//            undefined → raw assignment both ways (primitives)
//   default: value used when the saved data is missing this field
const SCHEMA_FIELDS = [
    ['seed'],
    ['runStartedAt', { default: () => Date.now() }],
    ['phase', { default: 'map' }],
    ['party', { clone: true, default: () => [] }],
    ['scoreThisTurn', { clone: 'shallow', default: () => ({}) }],
    ['totalScore', { clone: 'shallow', default: () => ({}) }],
    ['elementOffers', { clone: true, default: () => [] }],
    ['lootOffer', { clone: 'nullable' }],
    ['recruitOffer', { clone: 'nullable' }],
    ['factions', { clone: 'shallow', default: () => defaultFactionRelations() }],
    ['quests', { clone: true, default: () => [] }],
    ['questFlags', { clone: 'shallow', default: () => ({}) }],
    ['codex', { clone: true, default: () => [] }],
    ['nextNodeOverride', { default: null }],
    ['lootChanceBonus', { default: 0 }],
    ['elementOfferFloor', { default: 0 }],
    ['scoutAhead', { default: 0 }],
    ['pendingRecruitRoll', { default: false }],
    ['rations', { default: () => STARTING_RATIONS }],
    ['torches', { default: () => STARTING_TORCHES }],
    ['darkness', { default: false }],
    ['map', { clone: 'nullable' }],
    ['currentNodeId', { default: null }],
];

function cloneField(value, mode) {
    if (mode === true) return deepClone(value);
    if (mode === 'shallow') return { ...value };
    if (mode === 'nullable') return value ? deepClone(value) : null;
    return value;
}

function defaultValue(spec) {
    if (!spec || !('default' in spec)) return undefined;
    return typeof spec.default === 'function' ? spec.default() : spec.default;
}

/** Serialize a Game instance into a plain-JSON save record. */
export function serializeGame(game) {
    const out = { version: SAVE_VERSION, rngState: game.rng.getState() };
    for (const [name, spec] of SCHEMA_FIELDS) {
        out[name] = cloneField(game[name], spec?.clone);
    }
    out.currentEventId = game.currentEvent?.id ?? null;
    out.currentTemplate = game.currentTemplate
        ? { name: game.currentTemplate.name, boss: !!game.currentTemplate.boss }
        : null;
    out.board = game.board
        ? { rows: game.board.rows, cols: game.board.cols, grid: game.board.snapshot() }
        : null;
    out.encounter = game.encounter ? {
        enemies: deepClone(game.encounter.enemies),
        turn: game.encounter.turn,
        ultMeter: game.encounter.ultMeter,
        collectedXp: game.encounter.collectedXp,
        creditedDeaths: [...game.encounter._creditedDeaths],
    } : null;
    out.generatedQuests = deepClone(game.generatedQuests);
    out.questRunnerSnapshots = game.questRunners.map(r => r.toSnapshot());
    out.questRewardsFired = Array.from(game.questRewardsFired);
    out.questRewardMessages = { ...game.questRewardMessages };
    return out;
}

/**
 * Populate a freshly-constructed Game instance with values from `data`.
 * Returns the same `game` reference.
 *
 * Mid-event randomized state (e.g., the puzzle pedestals' correct answer)
 * is intentionally NOT preserved — the event is re-instantiated from its
 * template on load, so the puzzle re-rolls. Deliberate trade-off to avoid
 * serializing closures.
 */
export function hydrateGame(game, data) {
    if (!data) throw new Error('Unrecognized save format.');
    if (data.version === 1) {
        // In-place migration: v1 heroes carried mana/maxMana; slots are now
        // the caster resource. Recompute slots from class+level+abilities
        // (plus any equipment bonuses) and start full. The player loses
        // whatever partial mana pool they had, but all slots are fresh, so
        // the swap is always non-punitive.
        data = { ...data, version: SAVE_VERSION };
    } else if (data.version !== SAVE_VERSION) {
        throw new Error('Unrecognized save format.');
    }
    game.rng = mulberry32(data.seed);
    game.rng.setState(data.rngState);
    for (const [name, spec] of SCHEMA_FIELDS) {
        const stored = data[name];
        if (stored === undefined || stored === null) {
            const fallback = defaultValue(spec);
            game[name] = fallback !== undefined ? fallback : stored ?? null;
            continue;
        }
        game[name] = cloneField(stored, spec?.clone);
    }
    game.runPlan = null;
    game.floor = 0;

    // Phase 1 migration: heroes get a normalized abilities block. Phase 2
    // migration: heroes get a spell-slot state (normalized if present,
    // freshly derived from class+level if not); legacy mana fields stripped.
    // Phase 3 migration: heroes get a THAC0 derived from class+level when
    // the save predates the field.
    for (const hero of game.party ?? []) {
        hero.abilities = normalizeAbilities(hero.abilities);
        delete hero.mana;
        delete hero.maxMana;
        if (hero.slots) {
            hero.slots = normalizeSlotState(hero.slots);
            recomputeMaxSlots(hero.slots, hero.role, hero.level ?? 1, hero.abilities,
                              equipmentSpellSlotBonus(hero));
        } else {
            hero.slots = freshSlotState(hero.role, hero.level ?? 1, hero.abilities);
            recomputeMaxSlots(hero.slots, hero.role, hero.level ?? 1, hero.abilities,
                              equipmentSpellSlotBonus(hero));
        }
        if (typeof hero.thac0 !== 'number') {
            hero.thac0 = thac0ForHero(hero.role, hero.level ?? 1);
        }
        // Phase 4 migration: saving-throw vector.
        const normalizedSaves = normalizeSaveVector(hero.saves);
        hero.saves = normalizedSaves ?? savesForHero(hero.role, hero.level ?? 1);
    }

    if (data.board) {
        game.board = new Board({ rows: data.board.rows, cols: data.board.cols, rng: game.rng });
        game.board.grid = deepClone(data.board.grid);
    } else {
        game.board = null;
    }

    if (data.encounter) {
        game.encounter = new Encounter({
            party: game.party,
            enemies: data.encounter.enemies,
            rng: game.rng,
        });
        game.encounter.turn = data.encounter.turn ?? 0;
        game.encounter.ultMeter = data.encounter.ultMeter ?? 0;
        game.encounter.collectedXp = data.encounter.collectedXp ?? 0;
        game.encounter._creditedDeaths = new Set(data.encounter.creditedDeaths ?? []);
    } else {
        game.encounter = null;
    }

    if (data.currentEventId) {
        const factory = findEventTemplate(data.currentEventId);
        game.currentEvent = factory ? factory() : null;
        if (!game.currentEvent && game.phase === 'event') game.phase = 'map';
    } else {
        game.currentEvent = null;
    }
    game.currentTemplate = data.currentTemplate ?? null;

    if (Array.isArray(data.generatedQuests) && Array.isArray(data.questRunnerSnapshots)) {
        game.generatedQuests = deepClone(data.generatedQuests);
        game.questRunners = game.generatedQuests.map((q, i) =>
            createQuestRunnerFromSnapshot(q, data.questRunnerSnapshots[i]));
    } else {
        game.generatedQuests = [];
        game.questRunners = [];
    }
    game.questRewardsFired = new Set(data.questRewardsFired ?? []);
    game.questRewardMessages = { ...(data.questRewardMessages ?? {}) };

    return game;
}
