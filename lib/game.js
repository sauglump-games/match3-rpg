import { Board } from './board.js';
import { Encounter, makeHero } from './combat.js';
import { mulberry32 } from './rng.js';
import { drawRelicOffers, getRelic } from './relics.js';
import { generateMap } from './map.js';
import { ENCOUNTER_POOLS, combatTierForLayer } from './bestiary.js';

const RELIC_OFFERS_PER_REWARD = 3;

export const DEFAULT_BOARD_SIZE = 8;
export const CAMP_HEAL_FRACTION = 0.4;
export const EVENT_HEAL_AMOUNT = 8;

// XP_THRESHOLDS[L-1] = total XP required to be at level L.
//   level 1 = 0, level 2 = 100, level 3 = 250, ... level 7 (max) = 4000.
const XP_THRESHOLDS = [0, 100, 250, 500, 1000, 2000, 4000];
const MAX_LEVEL = XP_THRESHOLDS.length;

export function xpForLevel(level) {
    if (level < 1) return 0;
    if (level > MAX_LEVEL) return XP_THRESHOLDS[MAX_LEVEL - 1];
    return XP_THRESHOLDS[level - 1];
}

export const HP_PER_LEVEL = 6;
export const MANA_PER_LEVEL = 5;

// Each map node represents a stretch of dungeon descent. Earlier nodes are
// 50 levels; deeper layers escalate by LEVELS_PER_LAYER_STEP per layer.
export const LEVELS_PER_LAYER_BASE = 50;
export const LEVELS_PER_LAYER_STEP = 25;

export function levelsForLayer(layer) {
    return LEVELS_PER_LAYER_BASE + layer * LEVELS_PER_LAYER_STEP;
}

/** Cumulative depth descended after reaching the given layer (inclusive). */
export function depthAtLayer(layer) {
    let cum = 0;
    for (let L = 0; L <= layer; L++) cum += levelsForLayer(L);
    return cum;
}

/** Total descent of a full run (sum across all layers). */
export function totalRunDepth(mapDepth) {
    let cum = 0;
    for (let L = 0; L < mapDepth; L++) cum += levelsForLayer(L);
    return cum;
}

export function defaultParty() {
    return [
        makeHero({ id: 'h1', name: 'Brom the Bold',  role: 'warrior', rank: 'front', maxHp: 32, ac: 4 }),
        makeHero({ id: 'h2', name: 'Sister Vera',    role: 'cleric',  rank: 'front', maxHp: 28, ac: 4, maxMana: 25 }),
        makeHero({ id: 'h3', name: 'Eldrin Ash',     role: 'mage',    rank: 'rear',  maxHp: 18, ac: 8, maxMana: 30 }),
        makeHero({ id: 'h4', name: 'Lila Quickfoot', role: 'rogue',   rank: 'rear',  maxHp: 22, ac: 6 }),
    ];
}

// Encounter pools live in `bestiary.js`, indexed by tier:
//   ENCOUNTER_POOLS.tier1 / .tier2 / .elite / .boss

const EVENT_TEMPLATES = [
    () => ({
        id: 'healing-shrine',
        title: 'Healing Shrine',
        body: 'A small altar pulses with green light. Touching it warms the party.',
        cta: 'Touch the shrine',
        effect: (game) => {
            for (const hero of game.party) {
                if (!hero.alive) continue;
                hero.hp = Math.min(hero.maxHp, hero.hp + EVENT_HEAL_AMOUNT);
            }
            return `Each hero recovers ${EVENT_HEAL_AMOUNT} HP.`;
        },
    }),
];

function pickFromPool(pool, rng) {
    return pool[Math.floor(rng() * pool.length)]();
}

/**
 * Game state machine.
 *
 * Phases:
 *   - 'map'         — pick the next node from the branching run map
 *   - 'combat'      — fight the engaged node's encounter
 *   - 'post-combat' — won; pick a relic and/or rest
 *   - 'event'       — engage the engaged node's event text
 *   - 'victory'     — boss defeated
 *   - 'defeat'      — party wiped
 */
export class Game {
    constructor({ seed = Date.now(), party = defaultParty(), runPlan = null, mapDepth = 6 } = {}) {
        this.seed = seed;
        this.rng = mulberry32(seed);
        this.party = party;
        this.scoreThisTurn = {};
        this.totalScore = {};
        this.ownedRelicIds = [];
        this.relicOffers = [];

        if (runPlan) {
            // Linear back-door for tests: behaves like the pre-map game.
            this.runPlan = runPlan;
            this.floor = 0;
            this.map = null;
            this.currentNodeId = null;
            this.currentEvent = null;
            this.#startLinearEncounter();
        } else {
            this.runPlan = null;
            this.map = generateMap({ seed: this.seed, depth: mapDepth });
            this.currentNodeId = null;       // last engaged node id
            this.currentEvent = null;
            this.phase = 'map';
        }
    }

    // ----- map navigation -----

    reachableNodes() {
        if (!this.map) return [];
        if (this.currentNodeId === null) return this.map.layers[0];
        const cur = this.map.nodes[this.currentNodeId];
        return cur.next.map(id => this.map.nodes[id]);
    }

    isReachable(nodeId) {
        return this.reachableNodes().some(n => n.id === nodeId);
    }

    /** Engage a node: load the right phase/encounter/event. */
    pickNode(nodeId) {
        if (this.phase !== 'map') return false;
        if (!this.isReachable(nodeId)) return false;
        const node = this.map.nodes[nodeId];
        this.currentNodeId = nodeId;

        switch (node.type) {
            case 'combat':
            case 'elite':
            case 'boss':
                this.#startMapEncounter(node);
                return true;
            case 'camp':
                this.#applyCamp();
                this.phase = 'map'; // rest sites resolve instantly, return to map
                return true;
            case 'event': {
                this.currentEvent = pickFromPool(EVENT_TEMPLATES, this.rng);
                this.phase = 'event';
                return true;
            }
            default:
                return false;
        }
    }

    /** Player resolves an active event (single-button events for now). */
    resolveEvent() {
        if (this.phase !== 'event' || !this.currentEvent) return null;
        const message = this.currentEvent.effect(this);
        const consumed = this.currentEvent;
        this.currentEvent = null;
        this.phase = 'map';
        return { message, eventId: consumed.id };
    }

    #startMapEncounter(node) {
        let template;
        if (node.type === 'boss') {
            template = pickFromPool(ENCOUNTER_POOLS.boss, this.rng);
        } else if (node.type === 'elite') {
            template = pickFromPool(ENCOUNTER_POOLS.elite, this.rng);
        } else {
            const tier = combatTierForLayer(node.layer, this.map.depth);
            template = pickFromPool(ENCOUNTER_POOLS[tier], this.rng);
        }
        this.currentTemplate = template;
        this.board = new Board({ size: DEFAULT_BOARD_SIZE, rng: this.rng });
        this.encounter = new Encounter({ party: this.party, enemies: template.enemies, rng: this.rng });
        this.scoreThisTurn = {};
        this.phase = 'combat';
        this.#runRelicHook('onEncounterStart', this.encounter);
    }

    // ----- linear back-door (tests only) -----

    #startLinearEncounter() {
        const template = this.runPlan[this.floor];
        this.currentTemplate = template;
        this.board = new Board({ size: DEFAULT_BOARD_SIZE, rng: this.rng });
        this.encounter = new Encounter({ party: this.party, enemies: template.enemies, rng: this.rng });
        this.scoreThisTurn = {};
        this.phase = 'combat';
        this.#runRelicHook('onEncounterStart', this.encounter);
    }

    // ----- relic plumbing -----

    #runRelicHook(name, ...args) {
        for (const id of this.ownedRelicIds) {
            const relic = getRelic(id);
            const fn = relic?.hooks?.[name];
            if (typeof fn === 'function') fn(...args);
        }
    }

    #applyScoreModifiers(score) {
        let current = score;
        for (const id of this.ownedRelicIds) {
            const relic = getRelic(id);
            const fn = relic?.hooks?.modifyScore;
            if (typeof fn === 'function') {
                const next = fn(current);
                if (next) current = next;
            }
        }
        return current;
    }

    ownedRelics() {
        return this.ownedRelicIds.map(id => getRelic(id)).filter(Boolean);
    }

    pickRelic(id) {
        if (this.phase !== 'post-combat') return false;
        if (!this.relicOffers.includes(id)) return false;
        this.ownedRelicIds.push(id);
        this.relicOffers = [];
        return true;
    }

    skipReward() {
        if (this.phase !== 'post-combat') return false;
        this.relicOffers = [];
        return true;
    }

    // ----- combat ergonomics -----

    canCastUltimate() {
        return this.phase === 'combat' && this.encounter.canCastUltimate();
    }

    castUltimate() {
        if (!this.canCastUltimate()) return null;
        const result = this.encounter.castUltimate();
        if (!result) return null;
        if (result.status === 'victory') this.#onCombatVictory(result.events);
        return result;
    }

    canCastSpell(spellId, casterId) {
        return this.phase === 'combat' && this.encounter.canCastSpell(spellId, casterId);
    }

    castSpell(spellId, casterId) {
        if (this.phase !== 'combat') return null;
        const result = this.encounter.castSpell(spellId, casterId);
        if (!result) return null;
        if (result.status === 'victory') this.#onCombatVictory(result.events);
        return result;
    }

    isBossFloor() {
        return !!this.currentTemplate?.boss;
    }

    encounterName() {
        return this.currentTemplate?.name ?? '';
    }

    floorLabel() {
        if (this.runPlan) return `${this.floor + 1} / ${this.runPlan.length}`;
        if (!this.map) return '';
        const total = totalRunDepth(this.map.depth);
        const node = this.currentNodeId ? this.map.nodes[this.currentNodeId] : null;
        if (!node) return `0 / ${total}`;
        return `${depthAtLayer(node.layer)} / ${total}`;
    }

    trySwap(r1, c1, r2, c2) {
        if (this.phase !== 'combat') return { ok: false };
        const result = this.board.swap(r1, c1, r2, c2);
        if (!result.ok) return result;
        for (const [color, value] of Object.entries(result.scoreByColor)) {
            this.scoreThisTurn[color] = (this.scoreThisTurn[color] || 0) + value;
            this.totalScore[color] = (this.totalScore[color] || 0) + value;
        }
        return result;
    }

    commitTurn() {
        if (this.phase !== 'combat') return null;
        const rawScore = this.scoreThisTurn;
        this.scoreThisTurn = {};
        const score = this.#applyScoreModifiers(rawScore);
        const turnResult = this.encounter.resolveTurn(score);

        if (turnResult.status === 'defeat') {
            this.phase = 'defeat';
        } else if (turnResult.status === 'victory') {
            this.#onCombatVictory(turnResult.events);
        } else {
            this.#runRelicHook('onTurnEnd', this.encounter);
        }
        return { score, rawScore, ...turnResult };
    }

    #onCombatVictory(events) {
        // Award XP from this encounter to every alive hero, then check for level-ups.
        const xpEach = this.encounter.collectedXp;
        if (xpEach > 0) {
            for (const hero of this.party) {
                if (!hero.alive) continue;
                hero.xp += xpEach;
                events?.push({ type: 'xp-gain', targetId: hero.id, amount: xpEach });
            }
            this.#processLevelUps(events);
        }
        if (this.isBossFloor()) {
            this.phase = 'victory';
            return;
        }
        this.phase = 'post-combat';
        this.relicOffers = drawRelicOffers(this.ownedRelicIds, RELIC_OFFERS_PER_REWARD, this.rng);
    }

    #processLevelUps(events) {
        for (const hero of this.party) {
            while (hero.level < MAX_LEVEL && hero.xp >= xpForLevel(hero.level + 1)) {
                hero.level += 1;
                hero.maxHp += HP_PER_LEVEL;
                hero.hp = Math.min(hero.maxHp, hero.hp + HP_PER_LEVEL);
                if (hero.maxMana > 0) {
                    hero.maxMana += MANA_PER_LEVEL;
                    hero.mana = Math.min(hero.maxMana, hero.mana + MANA_PER_LEVEL);
                }
                events?.push({ type: 'level-up', targetId: hero.id, level: hero.level });
            }
        }
    }

    /** Free heal after winning a fight (post-combat) — does not consume a node. */
    camp() {
        if (this.phase !== 'post-combat') return false;
        this.#applyCamp();
        return true;
    }

    #applyCamp() {
        for (const hero of this.party) {
            if (!hero.alive) continue;
            const heal = Math.floor(hero.maxHp * CAMP_HEAL_FRACTION);
            hero.hp = Math.min(hero.maxHp, hero.hp + heal);
            hero.shield = 0;
            if (hero.maxMana > 0) hero.mana = hero.maxMana;
        }
    }

    /** From post-combat, advance: linear → next floor; map → return to map. */
    advance() {
        if (this.phase !== 'post-combat') return false;
        if (this.runPlan) {
            this.floor += 1;
            if (this.floor >= this.runPlan.length) {
                this.phase = 'victory';
            } else {
                this.#startLinearEncounter();
            }
        } else {
            this.phase = 'map';
        }
        return true;
    }

    status() {
        return this.phase;
    }
}
