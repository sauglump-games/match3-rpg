import { Board } from './board.js';
import {
    Encounter, makeHero, addItemToInventory, scaleEnemy, forEachAliveHero,
    refillPartySlots, refreshPartyDailyUses,
} from './combat.js';
import { recomputeMaxSlots } from './spell-slots.js';
import { casterColor, getSpell } from './spells.js';
import { equipmentSpellSlotBonus } from './items.js';
import { thac0ForHero } from './thac0.js';
import { savesForHero } from './saves.js';
import { recomputeDailyMax } from './class-features.js';
import { primeRequisiteXpMultiplier } from './abilities.js';
import { defaultMageKnownSpells, scribeSpell } from './spells.js';
import { mulberry32 } from './rng.js';
import { generateMap } from './map.js';
import { ENCOUNTER_POOLS, combatTierForLayer, makeMonster } from './bestiary.js';
import { itemsByRarity } from './items.js';
import { defaultFactionRelations, shiftRelation, getFaction } from './factions.js';
import { instantiateQuest, getQuestTemplate } from './quests.js';
import { allQuestKits, getQuestKit } from './quest-kits.js';
import { generateSolvableQuest } from './quest-generator.js';
import { createQuestRunner } from './quest-runner.js';
import { getLore } from './lore.js';
import { rollElementOffers } from './elements.js';
import {
    EVENT_TEMPLATES,
    pickFromPool,
    pickRandomItem,
    giveItemToParty,
    isChoiceAvailable,
} from './events.js';
import { serializeGame, hydrateGame } from './save-schema.js';

export { EVENT_HEAL_AMOUNT, partyHasClass, isChoiceAvailable } from './events.js';

const ELEMENT_OFFERS_PER_REWARD = 3;

export const DEFAULT_BOARD_SIZE = 8;
export const CAMP_HEAL_FRACTION = 0.4;

// Run-scope resources.
//   rations: consumed when camping; without one, the rest is fitful.
//   torches: consumed when leaving the map for a node; without one,
//            enemies in the next encounter deal a darkness penalty.
export const STARTING_RATIONS = 3;
export const STARTING_TORCHES = 4;
export const FITFUL_REST_HP_LOSS = 5;
export const DARKNESS_DAMAGE_PCT = 0.20;

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
export const MAX_PARTY_SIZE = 6;

// Monster scaling:
//   scale = (1 + layer * LAYER_SCALE) * (1 + (partyAvg - 1) * LEVEL_SCALE)
// Bosses get a mild bump because they're already hand-tuned, but still feel
// the party-level factor.
export const LAYER_SCALE_PER_STEP = 0.08;
export const LEVEL_SCALE_PER_LEVEL = 0.10;
export const BOSS_LAYER_SCALE_DIVISOR = 2;

// ----- recruit pool -----

// Per-class ability score templates. Each class's prime requisite hits 16 so
// the prime-req XP bonus (rpg-fidelity-spec.md §1) fires for default heroes.
// Secondary stats lean into the role (Fighter CON high, Mage DEX for AC, etc).
// Rangers need all three of STR / DEX / WIS ≥13 to qualify; we set all three
// to 16 so the prime-req bonus also fires.
const ABILITY_TEMPLATES = {
    warrior: { str: 16, dex: 13, con: 15, int: 10, wis: 10, cha: 10 },
    cleric:  { str: 13, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
    mage:    { str:  9, dex: 13, con: 11, int: 17, wis: 11, cha: 10 },
    rogue:   { str: 11, dex: 17, con: 12, int: 12, wis: 10, cha: 11 },
    druid:   { str: 10, dex: 11, con: 13, int: 11, wis: 16, cha: 14 },
    paladin: { str: 15, dex: 11, con: 14, int: 10, wis: 12, cha: 17 },
    ranger:  { str: 16, dex: 16, con: 13, int: 10, wis: 16, cha: 10 },
    summoner:{ str:  9, dex: 12, con: 11, int: 13, wis: 14, cha: 16 },
};

const RECRUIT_TEMPLATES = {
    warrior: { hpRange: [28, 32], ac: 4, rank: 'front', abilities: ABILITY_TEMPLATES.warrior },
    cleric:  { hpRange: [26, 30], ac: 4, rank: 'front', abilities: ABILITY_TEMPLATES.cleric  },
    mage:    { hpRange: [16, 20], ac: 8, rank: 'rear' , abilities: ABILITY_TEMPLATES.mage    },
    rogue:   { hpRange: [20, 24], ac: 6, rank: 'rear' , abilities: ABILITY_TEMPLATES.rogue   },
    druid:   { hpRange: [22, 26], ac: 7, rank: 'rear' , abilities: ABILITY_TEMPLATES.druid   },
    paladin: { hpRange: [30, 34], ac: 4, rank: 'front', abilities: ABILITY_TEMPLATES.paladin },
    ranger:  { hpRange: [26, 30], ac: 5, rank: 'front', abilities: ABILITY_TEMPLATES.ranger  },
};

const RECRUIT_NAMES = {
    warrior: ['Grim Marrow', 'Rolf Bareblade', 'Mara Ironheel'],
    cleric:  ['Father Giles', 'Sister Tibble', 'Brother Halsten'],
    mage:    ['Vex the Pale', 'Edric Stormeye', 'Caella Dustsong'],
    rogue:   ['Pip Underglove', 'Crow', 'Sneak'],
    druid:   ['Wren Greenleaf', 'Briar Thornroot', 'Mira Stagheart'],
    paladin: ['Sir Damon', 'Lady Issa', 'Brother Kael'],
    ranger:  ['Tamlin Swiftarrow', 'Eda Two-Blades', 'Vale Shadowstep'],
};

function rollInRange(rng, [lo, hi]) {
    return lo + Math.floor(rng() * (hi - lo + 1));
}

// Themed acts derived from the current map node's layer. Keeps the run feeling
// like a journey through three places without changing the underlying systems.
const ACT_THEMES = [
    { num: 'I',   name: 'Sewer',   id: 'sewer' },
    { num: 'II',  name: 'Ruins',   id: 'ruins' },
    { num: 'III', name: 'Sanctum', id: 'sanctum' },
];

export function actForLayer(layer, depth) {
    if (depth <= 0) return ACT_THEMES[0];
    const idx = Math.min(ACT_THEMES.length - 1, Math.floor((layer / depth) * ACT_THEMES.length));
    return ACT_THEMES[idx];
}

function generateRecruit(rng, partyAvgLevel = 1) {
    const roles = Object.keys(RECRUIT_TEMPLATES);
    const role = roles[Math.floor(rng() * roles.length)];
    const tmpl = RECRUIT_TEMPLATES[role];
    const names = RECRUIT_NAMES[role];
    const name = names[Math.floor(rng() * names.length)];
    const id = `recruit-${role}-${Math.floor(rng() * 100000)}`;
    return makeHero({
        id, name, role,
        rank: tmpl.rank,
        maxHp: rollInRange(rng, tmpl.hpRange),
        ac: tmpl.ac,
        level: Math.max(1, Math.floor(partyAvgLevel)),
        abilities: tmpl.abilities,
    });
}

function partyAvgLevel(party) {
    const alive = party.filter(p => p.alive);
    if (alive.length === 0) return 1;
    return alive.reduce((s, p) => s + p.level, 0) / alive.length;
}

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
        makeHero({ id: 'h1', name: 'Brom the Bold',  role: 'warrior', rank: 'front', maxHp: 32, ac: 4, abilities: ABILITY_TEMPLATES.warrior }),
        makeHero({ id: 'h2', name: 'Sister Vera',    role: 'cleric',  rank: 'front', maxHp: 28, ac: 4, abilities: ABILITY_TEMPLATES.cleric  }),
        makeHero({ id: 'h3', name: 'Eldrin Ash',     role: 'mage',    rank: 'rear',  maxHp: 18, ac: 8, abilities: ABILITY_TEMPLATES.mage    }),
        makeHero({ id: 'h4', name: 'Lila Quickfoot', role: 'rogue',   rank: 'rear',  maxHp: 22, ac: 6, abilities: ABILITY_TEMPLATES.rogue   }),
    ];
}

// Encounter pools live in `bestiary.js`, indexed by tier:
//   ENCOUNTER_POOLS.tier1 / .tier2 / .elite / .boss

// ---------------------------------------------------------------------------
// Events
//
// An event has multiple choices. Each choice may be gated by the presence of
// a class in the party (`requires.class`). The choice's `effect(game)` returns
// a short message string and may mutate game state (heal, damage, give item,
// gain ration, etc.).
// ---------------------------------------------------------------------------

/**
 * Game state machine.
 *
 * Phases:
 *   - 'map'         — pick the next node from the branching run map
 *   - 'combat'      — fight the engaged node's encounter
 *   - 'post-combat' — won; pick an element drop and/or rest
 *   - 'event'       — engage the engaged node's event text
 *   - 'victory'     — boss defeated
 *   - 'defeat'      — party wiped
 */
export class Game {
    constructor({ seed = Date.now(), party = defaultParty(), runPlan = null, mapDepth = null } = {}) {
        this.runStartedAt = Date.now();
        this.seed = seed;
        this.rng = mulberry32(seed);
        this.party = party;
        this.scoreThisTurn = {};
        this.totalScore = {};
        this.gemsMatchedThisTurn = {};
        this.elementOffers = [];           // array of { elementId, grade } post-fight
        this.lootOffer = null;
        this.recruitOffer = null;
        this.factions = defaultFactionRelations();
        this.quests = [];                  // active + completed quest instances
        this.questFlags = {};              // ad-hoc booleans events check (e.g. "have-banner")
        this.codex = [];                   // discovered lore fragments (run-scoped)
        // Procgen-only state mutated by consumed potions:
        this.nextNodeOverride = null;      // 'camp' | 'elite' (one-shot, potion)
        this.lootChanceBonus = 0;          // additive bonus to drop chance (potion)
        this.elementOfferFloor = 0;        // one-shot: minimum grade of next offers
        this.scoutAhead = 0;               // number of future branches revealed
        this.pendingRecruitRoll = false;   // potion-granted free recruit at next map
        this.rations = STARTING_RATIONS;
        this.torches = STARTING_TORCHES;
        this.darkness = false;

        // Generated quests auto-attach when a map exists. Each successfully
        // grounded kit produces one runner; runners advance silently as
        // `pickNode` fires and camp ticks roll interference draws.
        this.generatedQuests = [];
        this.questRunners = [];
        this.questRewardsFired = new Set();
        this.questRewardMessages = {};    // keyed by kitId

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
            // Map size scales with the party's average level. A fresh L1 group
            // gets the base map; veteran groups (e.g., from a future "carry
            // forward" mode) get longer, wider runs.
            const partyLevel = partyAvgLevel(party);
            this.map = generateMap({ seed: this.seed, depth: mapDepth, partyLevel });
            this.currentNodeId = null;       // last engaged node id
            this.currentEvent = null;
            this.phase = 'map';
            this.#seedGeneratedQuests();
        }
    }

    /**
     * Ground every available quest kit against this run's map and attach a
     * runner for each kit that solves. Seeds are derived from the run seed
     * so quest generation is deterministic and does not perturb `this.rng`.
     */
    #seedGeneratedQuests() {
        if (!this.map) return;
        const kits = allQuestKits();
        for (let i = 0; i < kits.length; i++) {
            const kit = kits[i];
            const seed = (this.seed ^ (0x9E3779B1 * (i + 1))) >>> 0;
            const quest = generateSolvableQuest({ map: this.map, kit, seed, attempts: 8 });
            if (!quest) continue;
            this.generatedQuests.push(quest);
            this.questRunners.push(createQuestRunner(quest));
        }
    }

    /**
     * Map of nodeId → array of quest markers for the map renderer. Only active
     * runners with a planting still unclaimed (the `at(entity,nodeId)` fact is
     * still in the runner's state) contribute markers. A node with the key
     * already picked up no longer gets marked.
     */
    questMarkersByNode() {
        const out = {};
        for (let i = 0; i < this.questRunners.length; i++) {
            const runner = this.questRunners[i];
            if (runner.status() !== 'active') continue;
            const state = runner.state();
            const quest = this.generatedQuests[i];
            for (const planting of Object.values(quest.plantings)) {
                const stillThere = state.has(`at(${planting.entity},${planting.nodeId})`);
                if (!stillThere) continue;
                out[planting.nodeId] ??= [];
                out[planting.nodeId].push({
                    kitId: quest.kitId,
                    entity: planting.entity,
                    label:  planting.label,
                });
            }
        }
        return out;
    }

    /** Summaries for the quest tab: title, status, next hint, plantings. */
    generatedQuestSummaries() {
        return this.questRunners.map((runner, i) => {
            const quest = this.generatedQuests[i];
            const plantings = {};
            for (const [key, p] of Object.entries(quest.plantings)) {
                const node = this.map?.nodes?.[p.nodeId] ?? null;
                plantings[key] = { ...p, layer: node?.layer ?? null };
            }
            const bossLayer = this.map?.nodes?.[quest.bossNodeId]?.layer ?? null;
            return {
                kitId:       quest.kitId,
                title:       quest.title,
                description: quest.description,
                status:      runner.status(),
                nextHint:    runner.nextHint(),
                plantings,
                bossNodeId:  quest.bossNodeId,
                bossLayer,
                location:    runner.location(),
                firedInterferences: Array.from(runner.firedInterferences()),
                rewardMessage: this.questRewardMessages[quest.kitId] ?? null,
            };
        });
    }

    /**
     * Fire kit rewards for any runner that has newly flipped to `completed`.
     * Rewards fire at most once per kit per run. The kit's reward function
     * receives the standard item-dispensing deps and returns a human log
     * line that we stash for the quest-tab UI.
     */
    fireQuestRewards() {
        for (let i = 0; i < this.questRunners.length; i++) {
            const runner = this.questRunners[i];
            if (runner.status() !== 'completed') continue;
            const quest = this.generatedQuests[i];
            if (this.questRewardsFired.has(quest.kitId)) continue;
            const kit = getQuestKit(quest.kitId);
            if (!kit?.reward) {
                this.questRewardsFired.add(quest.kitId);
                continue;
            }
            const message = kit.reward(this, {
                pickRandomItem: (rarities) => pickRandomItem(this, rarities),
                giveItemToParty: (item, prefix) => giveItemToParty(this, item, prefix),
            });
            this.questRewardsFired.add(quest.kitId);
            if (message) this.questRewardMessages[quest.kitId] = message;
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

        // Apply a one-shot potion-granted override (Shadow Draught / Sulfurous Lure). We
        // mutate the node type for THIS engagement only — bosses are excluded
        // so you can't trivially Camp the Lich King.
        if (this.nextNodeOverride && (node.type === 'combat' || node.type === 'elite')) {
            node.type = this.nextNodeOverride;
            this.nextNodeOverride = null;
        }

        // Every generated quest gets a chance to advance. Runners silently
        // update location, auto-fire pickups/unlocks, and re-plan. Runners
        // whose state is already `completed` or `failed` are still polled
        // (enterNode is a no-op when it can't change anything).
        for (const runner of this.questRunners) runner.enterNode(nodeId);
        this.fireQuestRewards();

        switch (node.type) {
            case 'combat':
            case 'elite':
            case 'boss':
                this.#startMapEncounter(node);
                return true;
            case 'camp':
                this.#applyCamp();
                this.#tickQuestInterferences();
                this.phase = 'map'; // rest sites resolve instantly, return to map
                return true;
            case 'event': {
                this.currentEvent = pickFromPool(EVENT_TEMPLATES, this.rng);
                this.phase = 'event';
                return true;
            }
            case 'recruit': {
                this.recruitOffer = generateRecruit(this.rng, partyAvgLevel(this.party));
                this.phase = 'recruit';
                return true;
            }
            default:
                return false;
        }
    }

    /**
     * Roll a single interference draw per active runner whenever a camp-style
     * rest point is reached. Draws are gated by each card's `requires` fact,
     * so drawing against a runner whose state doesn't match the deck is a
     * safe no-op.
     */
    #tickQuestInterferences() {
        for (const runner of this.questRunners) {
            if (runner.status() !== 'active') continue;
            runner.drawInterference({ rng: this.rng });
        }
        // Interferences can (rarely) flip a runner to completed via add-fact
        // effects (e.g., a gift). Fire rewards here too.
        this.fireQuestRewards();
    }

    // ----- recruit handling -----

    /**
     * Accept the offered recruit. If the party has room, simply add them.
     * If the party is full and `replaceHeroId` is given, evict that hero
     * and add the recruit. Returns true on success or one of:
     * 'no-offer', 'party-full' (no replacement chosen), 'no-such-hero'.
     */
    acceptRecruit(replaceHeroId = null) {
        if (this.phase !== 'recruit' || !this.recruitOffer) return 'no-offer';
        if (this.party.length < MAX_PARTY_SIZE) {
            this.party.push(this.recruitOffer);
            this.recruitOffer = null;
            this.phase = 'map';
            return true;
        }
        if (!replaceHeroId) return 'party-full';
        const idx = this.party.findIndex(h => h.id === replaceHeroId);
        if (idx < 0) return 'no-such-hero';
        this.party.splice(idx, 1, this.recruitOffer);
        this.recruitOffer = null;
        this.phase = 'map';
        return true;
    }

    declineRecruit() {
        if (this.phase !== 'recruit') return false;
        this.recruitOffer = null;
        this.phase = 'map';
        return true;
    }

    // ----- factions -----

    factionRelation(factionId) {
        return this.factions[factionId] ?? 'neutral';
    }

    /**
     * Adjust a faction's relation by `delta` steps (-1, +1, etc.).
     * Locked factions (Cult) never shift. Returns the new relation, or
     * null if locked / unknown.
     */
    adjustFaction(factionId, delta) {
        const def = getFaction(factionId);
        if (!def) return null;
        if (def.locked) return this.factions[factionId];
        const current = this.factions[factionId] ?? def.defaultRelation;
        const next = shiftRelation(current, delta);
        this.factions[factionId] = next;
        return next;
    }

    // ----- quests -----

    activeQuests() { return this.quests.filter(q => q.state === 'active'); }
    completedQuests() { return this.quests.filter(q => q.state === 'completed'); }
    findQuest(id) { return this.quests.find(q => q.id === id) ?? null; }

    /**
     * Add a quest to the run if not already present. Returns the quest
     * instance (existing or new), or null if the template is unknown.
     */
    acceptQuest(templateId) {
        const existing = this.findQuest(templateId);
        if (existing) return existing;
        const inst = instantiateQuest(templateId);
        if (!inst) return null;
        this.quests.push(inst);
        return inst;
    }

    /**
     * Mark one step of an active quest complete. If every step is done,
     * the quest's reward fires and it transitions to 'completed'.
     * Returns { completed, message? } or null if the step couldn't advance.
     */
    /**
     * Add a lore fragment to the codex if not already present.
     * Returns the fragment (or null if the id is unknown / already known).
     */
    discoverLore(loreId) {
        if (this.codex.some(l => l.id === loreId)) return null;
        const lore = getLore(loreId);
        if (!lore) return null;
        this.codex.push({ ...lore, foundAtTurn: this.encounter?.turn ?? 0 });
        return lore;
    }

    advanceQuestStep(questId, stepId) {
        const q = this.findQuest(questId);
        if (!q || q.state !== 'active') return null;
        const step = q.steps.find(s => s.id === stepId);
        if (!step || step.completed) return null;
        step.completed = true;
        if (q.steps.every(s => s.completed)) {
            q.state = 'completed';
            const tmpl = getQuestTemplate(q.id);
            const message = tmpl?.reward?.(this, {
                pickRandomItem: (rarities) => pickRandomItem(this, rarities),
                giveItemToParty: (item, prefix) => giveItemToParty(this, item, prefix),
            }) ?? null;
            return { completed: true, message };
        }
        return { completed: false };
    }

    /**
     * Player resolves an active event by picking one of its choices. Returns
     * { message, eventId, choiceId } on success, or null if the choice isn't
     * valid (unknown id or class-gated and class not in party).
     */
    resolveEvent(choiceId) {
        if (this.phase !== 'event' || !this.currentEvent) return null;
        const choice = this.currentEvent.choices.find(c => c.id === choiceId);
        if (!choice) return null;
        if (!isChoiceAvailable(this, choice)) return null;
        const message = choice.effect(this);
        const consumed = this.currentEvent;
        this.currentEvent = null;
        this.phase = 'map';
        return { message, eventId: consumed.id, choiceId: choice.id };
    }

    #startMapEncounter(node) {
        this.#burnTorch();
        const { template, board, encounter } = this.#loadEncounter(node);
        this.currentTemplate = template;
        this.board = board;
        this.encounter = encounter;
        this.currentEncounterScale = this.#applyRunModifiers(encounter, node);
        if (node.type === 'boss') this.#applyBossQuestModifiers();
        this.scoreThisTurn = {};
        this.gemsMatchedThisTurn = {};
        this.phase = 'combat';
    }

    /** Burn a torch. Without one, the next encounter is in darkness. */
    #burnTorch() {
        if (this.torches > 0) {
            this.torches -= 1;
            this.darkness = false;
        } else {
            this.darkness = true;
        }
    }

    /** Pick a template for the node and build a fresh board + encounter pair. */
    #loadEncounter(node) {
        let template;
        if (node.type === 'boss') {
            template = pickFromPool(ENCOUNTER_POOLS.boss, this.rng);
        } else if (node.type === 'elite') {
            template = pickFromPool(ENCOUNTER_POOLS.elite, this.rng);
        } else {
            const tier = combatTierForLayer(node.layer, this.map.depth);
            template = pickFromPool(ENCOUNTER_POOLS[tier], this.rng);
        }
        const board = new Board({ size: DEFAULT_BOARD_SIZE, rng: this.rng });
        const encounter = new Encounter({ party: this.party, enemies: template.enemies, rng: this.rng });
        return { template, board, encounter };
    }

    /**
     * Apply run-scoped modifiers to a freshly-loaded encounter: depth+party-level
     * scaling, then darkness if the party has no torch. Bosses take a gentler
     * layer bump since they're hand-tuned. Returns the scale factor used.
     */
    #applyRunModifiers(encounter, node) {
        const partyAvg = this.party.reduce((s, p) => s + p.level, 0) / Math.max(1, this.party.length);
        const layerScale = node.type === 'boss'
            ? 1 + (node.layer * LAYER_SCALE_PER_STEP) / BOSS_LAYER_SCALE_DIVISOR
            : 1 + node.layer * LAYER_SCALE_PER_STEP;
        const levelScale = 1 + (partyAvg - 1) * LEVEL_SCALE_PER_LEVEL;
        const scale = layerScale * levelScale;
        for (const e of encounter.enemies) scaleEnemy(e, scale);

        if (this.darkness) {
            for (const e of encounter.enemies) {
                e.damage = Math.ceil(e.damage * (1 + DARKNESS_DAMAGE_PCT));
                for (const intent of e.intentRotation) {
                    if (typeof intent.amount === 'number') {
                        intent.amount = Math.ceil(intent.amount * (1 + DARKNESS_DAMAGE_PCT));
                    }
                }
            }
        }
        return scale;
    }

    /**
     * Quest payoffs that take effect at the moment the boss encounter starts.
     * - phylactery-riddle (all 3 clues): the Phylactery is reduced to 1 HP
     * - cult-mole (befriended): the boss starts the fight stunned for 1 turn
     * - hydra-hunt (failed/fled): a Hydra joins the boss as backup
     */
    #applyBossQuestModifiers() {
        // Phylactery Riddle — frail phylactery
        if (this.questFlags.phylacteryRiddleSolved) {
            const phylactery = this.encounter.enemies.find(
                e => e.id === 'phylactery' || e.name === 'Phylactery'
            );
            if (phylactery) phylactery.hp = 1;
        }

        // Cult Mole — boss begins stunned for one turn
        if (this.questFlags.cultMoleSet) {
            const boss = this.encounter.enemies[0];
            if (boss) {
                boss.statuses ??= [];
                // appliedOnTurn = -1 so the freshness rule doesn't skip the tick;
                // duration 1 means it expires after the first turn ends.
                boss.statuses.push({ kind: 'stun', duration: 1, severity: 0, appliedOnTurn: -1 });
            }
        }

        // Hydra Hunt — Hydra reinforces the boss if the player fled and
        // never resolved the quest some other way.
        const hydraQuest = this.findQuest('hydra-hunt');
        const hydraUnresolved = this.questFlags.hydraStalking
            && (!hydraQuest || hydraQuest.state !== 'completed');
        if (hydraUnresolved) {
            const hydraId = `hydra-boss-${Math.floor(Math.random() * 100000)}`;
            const hydra = makeMonster('hydra', hydraId);
            this.encounter.enemies.push(hydra);
        }
    }

    // ----- linear back-door (tests only) -----

    #startLinearEncounter() {
        const template = this.runPlan[this.floor];
        this.currentTemplate = template;
        this.board = new Board({ size: DEFAULT_BOARD_SIZE, rng: this.rng });
        this.encounter = new Encounter({ party: this.party, enemies: template.enemies, rng: this.rng });
        this.scoreThisTurn = {};
        this.phase = 'combat';
        // (No relic hook here — relics under the new design only fire on acquire.)
    }

    // ----- element offers (post-fight reward) -----

    /**
     * Player picks one of the three offered element drops. Returns the
     * picked { elementId, grade } descriptor on success (caller is
     * responsible for applying it to the persistent meta-stash), or null.
     * Players MUST pick — there is no skip.
     */
    pickElementOffer(offerIndex) {
        if (this.phase !== 'post-combat') return null;
        const offer = this.elementOffers[offerIndex];
        if (!offer) return null;
        this.elementOffers = [];
        return { ...offer };
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

    /**
     * Casting a prepared spell gates on BOTH a slot of the spell's level
     * AND sufficient color score in scoreThisTurn (per ADR 0002: "score is
     * fuel; slots are the container"). Encounter owns the slot check; Game
     * owns the score check because scoreThisTurn lives here.
     */
    canCastSpell(spellId, casterId) {
        if (this.phase !== 'combat') return false;
        if (!this.encounter.canCastSpell(spellId, casterId)) return false;
        const spell = getSpell(spellId);
        const caster = this.party.find(p => p.id === casterId);
        const color = casterColor(caster?.role);
        if (!color || !spell) return false;
        const available = this.scoreThisTurn?.[color] ?? 0;
        return available >= spell.scoreCost;
    }

    castSpell(spellId, casterId) {
        if (!this.canCastSpell(spellId, casterId)) return null;
        const spell = getSpell(spellId);
        const caster = this.party.find(p => p.id === casterId);
        const color = casterColor(caster.role);
        const result = this.encounter.castSpell(spellId, casterId);
        if (!result) return null;
        this.scoreThisTurn[color] = Math.max(0, (this.scoreThisTurn[color] ?? 0) - spell.scoreCost);
        if (result.status === 'victory') this.#onCombatVictory(result.events);
        return result;
    }

    // ----- class features (Phase 5) -----
    //
    // These sit alongside castSpell because they are combat actions gated by
    // class + per-day / per-combat uses rather than by color score. The
    // Encounter owns the actual mutation; Game only checks phase and forwards.

    canTurnUndead(heroId) {
        return this.phase === 'combat' && this.encounter.canTurnUndead(heroId);
    }

    turnUndead(heroId) {
        if (!this.canTurnUndead(heroId)) return null;
        const result = this.encounter.turnUndead(heroId);
        if (!result) return null;
        if (result.status === 'victory') this.#onCombatVictory(result.events);
        return result;
    }

    canLayOnHands(heroId, targetId) {
        return this.phase === 'combat' && this.encounter.canLayOnHands(heroId, targetId);
    }

    layOnHands(heroId, targetId) {
        if (!this.canLayOnHands(heroId, targetId)) return null;
        return this.encounter.layOnHands(heroId, targetId);
    }

    canShapechange(heroId) {
        return this.phase === 'combat' && this.encounter.canShapechange(heroId);
    }

    shapechange(heroId) {
        if (!this.canShapechange(heroId)) return null;
        return this.encounter.shapechange(heroId);
    }

    /**
     * Attempt to scribe `spellId` into the hero's spellbook. Consumes the
     * run's RNG so success is deterministic with the seed. Returns the raw
     * `scribeSpell` result — `{ success, roll, target, spellId }` on a
     * legitimate attempt or `{ error }` when refused (not a mage / unknown
     * spell / already known).
     */
    attemptScribeSpell(heroId, spellId) {
        const hero = this.party.find(p => p.id === heroId);
        if (!hero) return { error: 'no-such-hero' };
        return scribeSpell(hero, spellId, this.rng);
    }

    isBossFloor() {
        return !!this.currentTemplate?.boss;
    }

    encounterName() {
        return this.currentTemplate?.name ?? '';
    }

    /** The current themed act based on the engaged map node, or null in linear mode. */
    currentAct() {
        if (!this.map) return null;
        const node = this.currentNodeId ? this.map.nodes[this.currentNodeId] : null;
        if (!node) return null;
        return actForLayer(node.layer, this.map.depth);
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
        // Count gems cleared per color so we can log a grouped summary on commit.
        for (const cascade of result.cascades ?? []) {
            for (const match of cascade.matches ?? []) {
                const c = match.color;
                const n = match.cells?.length ?? 0;
                this.gemsMatchedThisTurn[c] = (this.gemsMatchedThisTurn[c] || 0) + n;
            }
        }
        return result;
    }

    commitTurn() {
        if (this.phase !== 'combat') return null;
        const rawScore = this.scoreThisTurn;
        const gemsMatched = this.gemsMatchedThisTurn;
        this.scoreThisTurn = {};
        this.gemsMatchedThisTurn = {};
        // Score is no longer modified by relics (procgen-only contract).
        const score = rawScore;
        const turnResult = this.encounter.resolveTurn(score);

        // Lead the events with a grouped summary of gems matched this turn so
        // the combat log records the player's board output.
        const summary = { type: 'gem-summary', counts: { ...gemsMatched } };
        turnResult.events = [summary, ...turnResult.events];

        if (turnResult.status === 'defeat') {
            this.phase = 'defeat';
        } else if (turnResult.status === 'victory') {
            this.#onCombatVictory(turnResult.events);
        }
        return { score, rawScore, gemsMatched, ...turnResult };
    }

    #onCombatVictory(events) {
        // Award XP from this encounter to every alive hero, then check for level-ups.
        const xpEach = this.encounter.collectedXp;
        if (xpEach > 0) {
            // Spec §1: heroes whose prime requisite is ≥16 earn +10% XP.
            // Award is per-hero so a party with mixed primes sees different
            // numbers on each card — this is intentional and visible.
            forEachAliveHero(this.party, hero => {
                const mult = primeRequisiteXpMultiplier(hero.role, hero.abilities);
                const gain = Math.floor(xpEach * mult);
                hero.xp += gain;
                events?.push({ type: 'xp-gain', targetId: hero.id, amount: gain, mult });
            });
            this.#processLevelUps(events);
        }
        if (this.isBossFloor()) {
            this.phase = 'victory';
            return;
        }
        this.phase = 'post-combat';
        this.elementOffers = this.#rollElementOffers();
        this.lootOffer = this.#rollLootDrop();
    }

    /**
     * Generate 3 post-fight element drop offers. Grade distribution scales
     * with encounter difficulty (layer, elite/boss). A consumed Aether Prism
     * potion forces every offer to grade III or higher, then clears itself.
     */
    #rollElementOffers() {
        const node = this.currentNodeId ? this.map?.nodes?.[this.currentNodeId] : null;
        const elite = node?.type === 'elite';
        const boss = node?.type === 'boss';
        const layer = node?.layer ?? 0;
        const depth = this.map?.depth ?? 6;
        let offers = rollElementOffers({
            count: ELEMENT_OFFERS_PER_REWARD, layer, depth, elite, boss, rng: this.rng,
        });
        if (this.elementOfferFloor > 0) {
            const floor = this.elementOfferFloor;
            offers = offers.map(o => ({ ...o, grade: Math.max(o.grade, floor) }));
            this.elementOfferFloor = 0;
        }
        return offers;
    }

    /**
     * Roll a single loot drop. Returns an item descriptor or null.
     * Drop chance and rarity escalate with the current node type/depth.
     */
    #rollLootDrop() {
        const node = this.currentNodeId ? this.map?.nodes?.[this.currentNodeId] : null;
        const isElite = node?.type === 'elite';
        const baseChance = isElite ? 1.0 : 0.5;
        const dropChance = Math.min(1, baseChance + (this.lootChanceBonus ?? 0));
        if (this.rng() >= dropChance) return null;

        // Weighted by tier: layer < midpoint → mostly common; midpoint+ → mix; elite → bias rare
        let pool;
        if (isElite) {
            pool = [...itemsByRarity('rare'), ...itemsByRarity('uncommon')];
        } else {
            const tier = node ? combatTierForLayer(node.layer, this.map.depth) : 'tier1';
            pool = tier === 'tier1'
                ? [...itemsByRarity('common'), ...itemsByRarity('common'), ...itemsByRarity('uncommon')]
                : [...itemsByRarity('uncommon'), ...itemsByRarity('common'), ...itemsByRarity('rare')];
        }
        if (pool.length === 0) return null;
        return pool[Math.floor(this.rng() * pool.length)];
    }

    /**
     * Player accepts the current loot drop for a specific hero. The item is
     * placed in that hero's inventory. Returns true on success, or one of:
     * 'no-offer', 'no-such-hero', 'inventory-full'.
     */
    pickItem(heroId) {
        if (this.phase !== 'post-combat') return 'wrong-phase';
        if (!this.lootOffer) return 'no-offer';
        const hero = this.party.find(p => p.id === heroId);
        if (!hero) return 'no-such-hero';
        const ok = addItemToInventory(hero, this.lootOffer);
        if (!ok) return 'inventory-full';
        this.lootOffer = null;
        return true;
    }

    /** Discard the current loot offer (player chose not to take it). */
    skipLoot() {
        if (this.phase !== 'post-combat') return false;
        this.lootOffer = null;
        return true;
    }

    #processLevelUps(events) {
        for (const hero of this.party) {
            while (hero.level < MAX_LEVEL && hero.xp >= xpForLevel(hero.level + 1)) {
                hero.level += 1;
                hero.maxHp += HP_PER_LEVEL;
                hero.hp = Math.min(hero.maxHp, hero.hp + HP_PER_LEVEL);
                // Rebuild slot caps for the new class-level row; preserves any
                // already-spent slots, fills new rows at zero-used.
                if (hero.slots) {
                    recomputeMaxSlots(hero.slots, hero.role, hero.level, hero.abilities,
                                      equipmentSpellSlotBonus(hero));
                }
                // THAC0 improves with level per the class progression table.
                hero.thac0 = thac0ForHero(hero.role, hero.level);
                // Saves improve in bands per the class progression (spec §2.1).
                hero.saves = savesForHero(hero.role, hero.level);
                // Class features unlock or scale on level-up (Druid shapechange
                // arrives at L7; other roles keep their existing caps).
                recomputeDailyMax(hero);
                // Mages gain access to spells of their new level via the
                // auto-learn default (spec §4.3). Scroll scribing still
                // feeds spells above or adjacent to the tier.
                if (hero.role === 'mage' && hero.knownSpells instanceof Set) {
                    const fresh = defaultMageKnownSpells(hero.level);
                    for (const id of fresh) hero.knownSpells.add(id);
                }
                events?.push({ type: 'level-up', targetId: hero.id, level: hero.level });
            }
        }
    }

    /**
     * Free heal after winning a fight (post-combat) — does not consume a node.
     * Returns 'rested' on a normal rest, 'fitful' if no ration was available,
     * or false if not in post-combat phase.
     */
    camp() {
        if (this.phase !== 'post-combat') return false;
        return this.#applyCamp();
    }

    /**
     * Camp consumes a ration. With a ration: heal CAMP_HEAL_FRACTION, refill
     * every caster's prepared spell slots (rpg-fidelity-spec.md §4.2), clear
     * shields. Without: party loses FITFUL_REST_HP_LOSS HP and gets nothing
     * else — fitful rest does NOT refill slots.
     */
    #applyCamp() {
        if (this.rations <= 0) {
            forEachAliveHero(this.party, hero => {
                hero.hp = Math.max(1, hero.hp - FITFUL_REST_HP_LOSS);
            });
            return 'fitful';
        }
        this.rations -= 1;
        forEachAliveHero(this.party, hero => {
            const heal = Math.floor(hero.maxHp * CAMP_HEAL_FRACTION);
            hero.hp = Math.min(hero.maxHp, hero.hp + heal);
            hero.shield = 0;
        });
        refillPartySlots(this.party);
        refreshPartyDailyUses(this.party);
        return 'rested';
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

    // ----- persistence -----

    /**
     * Serialize the entire run to plain JSON. Shape is declared in save-schema.js
     * so adding a field is a single-site change. Functions (event effects,
     * spell casts, intent rotations) are not serialized; they re-attach on
     * fromJSON by looking up their template ids.
     */
    toJSON() {
        return serializeGame(this);
    }

    /** Restore a Game from a serialized snapshot. */
    static fromJSON(data) {
        // Construct via `new` so private methods (#applyScoreModifiers, etc.)
        // are installed on the instance — Object.create(Game.prototype) would
        // skip them and `this.#foo()` later would throw. The freshly-generated
        // map/encounter are discarded by hydrateGame's assignments.
        const game = new Game({ seed: data.seed, party: data.party ?? defaultParty() });
        return hydrateGame(game, data);
    }
}
