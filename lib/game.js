import { Board } from './board.js';
import { Encounter, makeHero, addItemToInventory, equipItem, scaleEnemy } from './combat.js';
import { mulberry32 } from './rng.js';
import { generateMap } from './map.js';
import { ENCOUNTER_POOLS, combatTierForLayer, makeMonster } from './bestiary.js';
import { itemsByRarity } from './items.js';
import { defaultFactionRelations, shiftRelation, getFaction } from './factions.js';
import { instantiateQuest, getQuestTemplate } from './quests.js';
import { getLore } from './lore.js';
import { getItem } from './items.js';
import { rollElementOffers } from './elements.js';

const ELEMENT_OFFERS_PER_REWARD = 3;

export const DEFAULT_BOARD_SIZE = 8;
export const CAMP_HEAL_FRACTION = 0.4;
export const EVENT_HEAL_AMOUNT = 8;

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
export const MANA_PER_LEVEL = 5;
export const MAX_PARTY_SIZE = 6;

// Monster scaling:
//   scale = (1 + layer * LAYER_SCALE) * (1 + (partyAvg - 1) * LEVEL_SCALE)
// Bosses get a mild bump because they're already hand-tuned, but still feel
// the party-level factor.
export const LAYER_SCALE_PER_STEP = 0.08;
export const LEVEL_SCALE_PER_LEVEL = 0.10;
export const BOSS_LAYER_SCALE_DIVISOR = 2;

// ----- recruit pool -----

const RECRUIT_TEMPLATES = {
    warrior: { hpRange: [28, 32], mana: 0,  ac: 4, rank: 'front' },
    cleric:  { hpRange: [26, 30], mana: 24, ac: 4, rank: 'front' },
    mage:    { hpRange: [16, 20], mana: 30, ac: 8, rank: 'rear'  },
    rogue:   { hpRange: [20, 24], mana: 0,  ac: 6, rank: 'rear'  },
    druid:   { hpRange: [22, 26], mana: 22, ac: 7, rank: 'rear'  },
    paladin: { hpRange: [30, 34], mana: 0,  ac: 4, rank: 'front' },
};

const RECRUIT_NAMES = {
    warrior: ['Grim Marrow', 'Rolf Bareblade', 'Mara Ironheel'],
    cleric:  ['Father Giles', 'Sister Tibble', 'Brother Halsten'],
    mage:    ['Vex the Pale', 'Edric Stormeye', 'Caella Dustsong'],
    rogue:   ['Pip Underglove', 'Crow', 'Sneak'],
    druid:   ['Wren Greenleaf', 'Briar Thornroot', 'Mira Stagheart'],
    paladin: ['Sir Damon', 'Lady Issa', 'Brother Kael'],
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

// Named adventurers whose remains may be found mid-run.
const FALLEN_ADVENTURERS = [
    {
        loreId: 'epitaph-tod',
        name: 'Tod Uphill', role: 'rogue', rank: 'rear',
        maxHp: 24, ac: 5, maxMana: 0, level: 2,
        gear: ['dagger'],
    },
    {
        loreId: 'epitaph-beorham',
        name: 'Beorham the Bright', role: 'paladin', rank: 'front',
        maxHp: 32, ac: 4, maxMana: 0, level: 2,
        gear: ['plate-mail', 'longsword-plus-1'],
    },
    {
        loreId: 'epitaph-ileria',
        name: 'Ileria of the Spire', role: 'mage', rank: 'rear',
        maxHp: 18, ac: 8, maxMana: 30, level: 2,
        gear: ['mage-robe'],
    },
];

function buildFallenAdventurer(template, partyAvg) {
    const id = `remains-${template.role}-${Math.floor(Math.random() * 100000)}`;
    const hero = makeHero({
        id, name: template.name, role: template.role, rank: template.rank,
        maxHp: template.maxHp, ac: template.ac, maxMana: template.maxMana,
        level: Math.max(template.level, Math.floor(partyAvg)),
    });
    // Auto-equip starting gear if the slot is empty.
    for (const itemId of template.gear) {
        const item = getItem(itemId);
        if (!item) continue;
        addItemToInventory(hero, item);
        equipItem(hero, itemId);
    }
    return hero;
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
        maxMana: tmpl.mana,
        level: Math.max(1, Math.floor(partyAvgLevel)),
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
        makeHero({ id: 'h1', name: 'Brom the Bold',  role: 'warrior', rank: 'front', maxHp: 32, ac: 4 }),
        makeHero({ id: 'h2', name: 'Sister Vera',    role: 'cleric',  rank: 'front', maxHp: 28, ac: 4, maxMana: 25 }),
        makeHero({ id: 'h3', name: 'Eldrin Ash',     role: 'mage',    rank: 'rear',  maxHp: 18, ac: 8, maxMana: 30 }),
        makeHero({ id: 'h4', name: 'Lila Quickfoot', role: 'rogue',   rank: 'rear',  maxHp: 22, ac: 6 }),
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

export function partyHasClass(game, classRole) {
    return game.party.some(h => h.alive && h.role === classRole);
}

function pickRandomItem(game, rarities) {
    const pool = [];
    for (const r of rarities) pool.push(...itemsByRarity(r));
    if (pool.length === 0) return null;
    return pool[Math.floor(game.rng() * pool.length)];
}

function giveItemToParty(game, item, prefix) {
    if (!item) return `${prefix}.`;
    for (const hero of game.party) {
        if (!hero.alive) continue;
        if (addItemToInventory(hero, item)) {
            return `${prefix}. You find a ${item.name} (now in ${hero.name}'s pack).`;
        }
    }
    return `${prefix}. You find a ${item.name}, but no one has room for it.`;
}

const EVENT_TEMPLATES = [
    () => ({
        id: 'healing-shrine',
        title: 'Healing Shrine',
        body: 'A small altar pulses with green light. The party feels welcomed.',
        choices: [
            {
                id: 'touch',
                label: 'Touch the shrine',
                effect: (game) => {
                    for (const hero of game.party) {
                        if (!hero.alive) continue;
                        hero.hp = Math.min(hero.maxHp, hero.hp + EVENT_HEAL_AMOUNT);
                    }
                    return `Each hero recovers ${EVENT_HEAL_AMOUNT} HP.`;
                },
            },
            {
                id: 'pray',
                label: 'Pray sincerely',
                requires: { class: 'cleric' },
                effect: (game) => {
                    for (const hero of game.party) {
                        if (!hero.alive) continue;
                        hero.hp = Math.min(hero.maxHp, hero.hp + 14);
                        if (hero.maxMana > 0) hero.mana = Math.min(hero.maxMana, hero.mana + 8);
                    }
                    return 'A divine warmth fills the party. Every hero recovers 14 HP and 8 MP.';
                },
            },
            { id: 'leave', label: 'Move on', effect: () => 'The party leaves the shrine untouched.' },
        ],
    }),

    () => ({
        id: 'wounded-pilgrim',
        title: 'A Wounded Pilgrim',
        body: 'A robed traveler kneels by the path, clutching a bleeding wound.',
        choices: [
            {
                id: 'heal-divine',
                label: 'Heal them with divine power',
                requires: { class: 'cleric' },
                effect: (game) => {
                    game.rations += 1;
                    return 'The pilgrim is healed. They press a ration of pilgrim-bread into your hands. (+1 🍖)';
                },
            },
            {
                id: 'bandage',
                label: 'Bandage the wound',
                effect: () => 'You wrap the wound. The pilgrim limps onward, grateful.',
            },
            {
                id: 'rob',
                label: 'Take what you can use',
                effect: (game) => {
                    game.rations += 1;
                    return 'You strip the pilgrim of their bread. (+1 🍖) The party feels colder.';
                },
            },
            { id: 'leave', label: 'Walk past', effect: () => 'You leave the pilgrim to their fate.' },
        ],
    }),

    () => ({
        id: 'locked-chest',
        title: 'Locked Chest',
        body: 'A heavy wooden chest, padlocked with a rusted iron clasp.',
        choices: [
            {
                id: 'pick',
                label: 'Pick the lock',
                requires: { class: 'rogue' },
                effect: (game) => {
                    const item = pickRandomItem(game, ['uncommon', 'common']);
                    return giveItemToParty(game, item, 'You spring the lock cleanly');
                },
            },
            {
                id: 'force',
                label: 'Force it open',
                requires: { class: 'warrior' },
                effect: (game) => {
                    const warrior = game.party.find(h => h.alive && h.role === 'warrior');
                    if (warrior) warrior.hp = Math.max(1, warrior.hp - 4);
                    const item = pickRandomItem(game, ['common']);
                    return giveItemToParty(game, item, 'You smash the lock at the cost of 4 HP');
                },
            },
            { id: 'leave', label: 'Leave it', effect: () => 'You walk on, eyeing the chest.' },
        ],
    }),

    () => ({
        id: 'sealed-rune-door',
        title: 'Sealed Rune Door',
        body: 'A door etched with glowing runes. The air smells of ozone.',
        choices: [
            {
                id: 'read',
                label: 'Read the runes',
                requires: { class: 'mage' },
                effect: (game) => {
                    const item = pickRandomItem(game, ['uncommon']);
                    return giveItemToParty(game, item, 'The runes spell a forgotten name. The door slides open.');
                },
            },
            {
                id: 'smash',
                label: 'Smash through',
                effect: (game) => {
                    for (const hero of game.party) {
                        if (!hero.alive) continue;
                        hero.hp = Math.max(1, hero.hp - 6);
                    }
                    const item = pickRandomItem(game, ['common']);
                    return giveItemToParty(game, item, 'You break through, but the runes lash back. Everyone takes 6 HP damage');
                },
            },
            { id: 'leave', label: 'Turn around', effect: () => 'You leave the door sealed.' },
        ],
    }),

    () => ({
        id: 'mysterious-mushroom',
        title: 'Mysterious Mushroom',
        body: 'A bright purple mushroom grows from a corpse. It pulses faintly.',
        choices: [
            {
                id: 'eat-druid',
                label: 'Identify and prepare',
                requires: { class: 'druid' },
                effect: (game) => {
                    for (const hero of game.party) {
                        if (!hero.alive) continue;
                        hero.hp = Math.min(hero.maxHp, hero.hp + 10);
                    }
                    return 'The druid prepares the mushroom safely. Each hero recovers 10 HP.';
                },
            },
            {
                id: 'eat-risky',
                label: 'Eat it raw',
                effect: (game) => {
                    if (game.rng() < 0.5) {
                        for (const hero of game.party) {
                            if (!hero.alive) continue;
                            hero.hp = Math.min(hero.maxHp, hero.hp + 10);
                        }
                        return 'It was harmless! Each hero recovers 10 HP.';
                    }
                    for (const hero of game.party) {
                        if (!hero.alive) continue;
                        hero.hp = Math.max(1, hero.hp - 5);
                    }
                    return 'It was poisonous! Each hero loses 5 HP.';
                },
            },
            { id: 'leave', label: 'Leave it be', effect: () => 'Wisdom prevails. You move on.' },
        ],
    }),

    () => ({
        id: 'old-inscription',
        title: 'Old Inscription',
        body: 'Words in an ancient tongue, carved into a black stone slab.',
        choices: [
            {
                id: 'read',
                label: 'Read aloud',
                effect: (game) => {
                    game.discoverLore('inscription-stone');
                    return 'The words echo: "He who holds the gem holds the world." (Codex updated.)';
                },
            },
            { id: 'leave', label: 'Move on', effect: () => 'The words remain unspoken.' },
        ],
    }),

    () => {
        const tmpl = FALLEN_ADVENTURERS[Math.floor(Math.random() * FALLEN_ADVENTURERS.length)];
        return {
            id: 'adventurers-remains',
            title: "An Adventurer's Remains",
            body: `A weathered skeleton, half-buried in dust. A rusted plate names them: ${tmpl.name}.`,
            choices: [
                {
                    id: 'inspect',
                    label: 'Read the epitaph',
                    effect: (game) => {
                        game.discoverLore(tmpl.loreId);
                        return `You commit ${tmpl.name}'s story to memory. (Codex updated.)`;
                    },
                },
                {
                    id: 'resurrect',
                    label: `Resurrect ${tmpl.name}`,
                    effect: (game) => {
                        if (game.party.length >= 6) {
                            return `Your band is full. ${tmpl.name} remains at peace.`;
                        }
                        const partyAvg = game.party.reduce((s, p) => s + p.level, 0) / game.party.length;
                        const hero = buildFallenAdventurer(tmpl, partyAvg);
                        game.party.push(hero);
                        game.discoverLore(tmpl.loreId);
                        return `${tmpl.name} stirs and stands, gear and all. They join the party.`;
                    },
                },
                { id: 'leave', label: 'Leave the bones in peace', effect: () => 'You leave the dead undisturbed.' },
            ],
        };
    },

    () => {
        // Crystal Pedestals — pick the right color or take damage.
        const colors = ['red', 'blue', 'green'];
        const correct = colors[Math.floor(Math.random() * 3)];
        const wrongPenalty = (game) => {
            for (const hero of game.party) {
                if (!hero.alive) continue;
                hero.hp = Math.max(1, hero.hp - 5);
            }
            return 'The crystal flares angrily. Each hero loses 5 HP.';
        };
        const correctReward = (game) => {
            const item = pickRandomItem(game, ['rare', 'uncommon']);
            return giveItemToParty(game, item, 'The crystal opens a hidden compartment');
        };
        return {
            id: 'crystal-pedestals',
            title: 'Three Crystal Pedestals',
            body: 'Three pedestals stand in a triangle, each with a humming crystal: red, blue, green. Only one is safe.',
            choices: [
                {
                    id: 'study',
                    label: 'Study the runes underfoot',
                    requires: { class: 'mage' },
                    effect: (game) => {
                        game.discoverLore('pedestal-riddle');
                        return `The mage reads the runes: "Color of dawn opens the door." (Hint: pick ${correct}.)`;
                    },
                },
                { id: 'red',   label: 'Touch the red crystal',   effect: correct === 'red'   ? correctReward : wrongPenalty },
                { id: 'blue',  label: 'Touch the blue crystal',  effect: correct === 'blue'  ? correctReward : wrongPenalty },
                { id: 'green', label: 'Touch the green crystal', effect: correct === 'green' ? correctReward : wrongPenalty },
                { id: 'leave', label: 'Leave the pedestals', effect: () => 'You step back from the pedestals.' },
            ],
        };
    },

    () => ({
        id: 'lost-banner',
        title: 'A Wounded Dwarven Scout',
        body: 'A dwarf with a fresh axe-wound clutches a scrap of map. ' +
              '"They took our banner. Find it and bring it back to camp — we\'ll reward you well."',
        choices: [
            {
                id: 'accept-quest',
                label: 'Take the quest and the banner',
                effect: (game) => {
                    game.acceptQuest('aid-the-dwarves');
                    game.advanceQuestStep('aid-the-dwarves', 'find-banner');
                    game.questFlags.haveBanner = true;
                    return 'You take the banner. Now to find the Dwarven Camp.';
                },
            },
            {
                id: 'rob-scout',
                label: 'Rob the scout',
                effect: (game) => {
                    game.rations += 1;
                    game.adjustFaction('dwarves', -1);
                    return 'You rob the scout for their pack. (+1 🍖) The Dwarves grow hostile.';
                },
            },
            { id: 'leave', label: 'Walk past', effect: () => 'You leave the scout to bleed alone.' },
        ],
    }),

    () => ({
        id: 'dwarven-camp',
        title: 'Dwarven Camp',
        body: 'A ring of stone tents, dwarves drinking around a low fire. ' +
              'A grey-bearded captain eyes you over the rim of a tankard.',
        choices: [
            {
                id: 'return-banner',
                label: 'Return the dwarven banner',
                effect: (game) => {
                    if (!game.questFlags.haveBanner) {
                        return 'The captain frowns. "What banner? Be off."';
                    }
                    game.questFlags.haveBanner = false;
                    const result = game.advanceQuestStep('aid-the-dwarves', 'return-banner');
                    if (result?.completed) {
                        return result.message ?? 'The dwarves cheer. The captain claps you on the shoulder.';
                    }
                    return 'You hand over the banner. The dwarves nod gratefully.';
                },
            },
            {
                id: 'deliver-hand',
                label: 'Deliver the black-iron hand',
                effect: (game) => {
                    if (!game.questFlags.haveSeveredHand) {
                        return 'The captain raises an eyebrow. "What hand?"';
                    }
                    game.questFlags.haveSeveredHand = false;
                    const result = game.advanceQuestStep('severed-hand', 'deliver-hand');
                    if (result?.completed) {
                        return result.message ?? 'The dwarves restore their king. You are forever in their debt.';
                    }
                    return 'You hand over the hand. The dwarves go silent in reverence.';
                },
            },
            {
                id: 'trade-rations',
                label: 'Trade 1 ration for healing',
                effect: (game) => {
                    if (game.rations <= 0) return 'You have no rations to trade.';
                    game.rations -= 1;
                    for (const hero of game.party) {
                        if (!hero.alive) continue;
                        hero.hp = Math.min(hero.maxHp, hero.hp + 12);
                    }
                    return 'You hand over a ration. A dwarven healer tends every hero (+12 HP each).';
                },
            },
            { id: 'leave', label: 'Move on', effect: () => 'You nod and continue past.' },
        ],
    }),

    // ===========================================================
    // === Quest-driving events =================================
    // ===========================================================

    () => ({
        id: 'black-iron-hand',
        title: 'A Black-Iron Hand',
        body: 'A black-iron hand lies among the rubble. Dwarven runes are scratched into the wrist.',
        choices: [
            {
                id: 'take-hand',
                label: 'Take the hand',
                effect: (game) => {
                    if (game.questFlags.haveSeveredHand) {
                        return 'You already carry one such relic — you leave this one be.';
                    }
                    game.acceptQuest('severed-hand');
                    game.advanceQuestStep('severed-hand', 'find-hand');
                    game.questFlags.haveSeveredHand = true;
                    return 'You take the hand. It feels colder than the iron should be.';
                },
            },
            { id: 'leave', label: 'Leave it', effect: () => 'You leave the relic where it lies.' },
        ],
    }),

    () => ({
        id: 'drow-patrol-prisoner',
        title: 'Drow Patrol',
        body: 'Three drow drag a hooded prisoner along the path. Their poison-tipped crossbows track you.',
        choices: [
            {
                id: 'bribe',
                label: 'Bribe with 1 ration',
                effect: (game) => {
                    if (game.rations <= 0) return 'You have no rations to offer.';
                    game.rations -= 1;
                    game.acceptQuest('free-the-prisoner');
                    game.questFlags.prisonerBribed = true;
                    game.adjustFaction('drow', +1);
                    game.advanceQuestStep('free-the-prisoner', 'resolve');
                    return 'The drow take your ration and release the prisoner.';
                },
            },
            {
                id: 'fight',
                label: 'Attack the patrol',
                effect: (game) => {
                    for (const h of game.party) {
                        if (!h.alive) continue;
                        h.hp = Math.max(1, h.hp - 8);
                    }
                    game.acceptQuest('free-the-prisoner');
                    game.questFlags.prisonerLiberatedByForce = true;
                    game.adjustFaction('drow', -1);
                    if (game.party.length < MAX_PARTY_SIZE) {
                        const id = `freed-prisoner-${Math.floor(Math.random() * 100000)}`;
                        const avg = game.party.reduce((s, p) => s + p.level, 0) / game.party.length;
                        const hero = makeHero({
                            id, name: 'Freed Prisoner', role: 'rogue', rank: 'rear',
                            maxHp: 24, ac: 6, level: Math.max(1, Math.floor(avg)),
                        });
                        game.party.push(hero);
                        game.advanceQuestStep('free-the-prisoner', 'resolve');
                        return 'The fight is brutal but you free the prisoner. They take up arms with you. (Each hero takes 8 HP.)';
                    }
                    game.advanceQuestStep('free-the-prisoner', 'resolve');
                    return 'The fight is brutal. The prisoner thanks you and runs into the dark.';
                },
            },
            { id: 'leave', label: 'Walk past', effect: () => 'You leave the prisoner to their fate.' },
        ],
    }),

    () => ({
        id: 'crumbled-tome',
        title: 'A Crumbled Tome',
        body: 'A book turns to dust as you open it, but a single page survives — a name in old script.',
        choices: [
            {
                id: 'memorize',
                label: 'Memorize the name',
                effect: (game) => {
                    game.acceptQuest('phylactery-riddle');
                    if (game.questFlags.phylacteryClue1) return 'You already know this name.';
                    game.questFlags.phylacteryClue1 = true;
                    game.advanceQuestStep('phylactery-riddle', 'clue-1');
                    return 'You commit the first fragment to memory.';
                },
            },
            { id: 'leave', label: 'Move on', effect: () => 'The name is lost to dust.' },
        ],
    }),

    () => ({
        id: 'whispering-mirror',
        title: 'A Whispering Mirror',
        body: 'A cracked mirror whispers a fragment of a name in a voice not your own.',
        choices: [
            {
                id: 'listen',
                label: 'Listen and remember',
                effect: (game) => {
                    game.acceptQuest('phylactery-riddle');
                    if (game.questFlags.phylacteryClue2) return 'You already know this fragment.';
                    game.questFlags.phylacteryClue2 = true;
                    game.advanceQuestStep('phylactery-riddle', 'clue-2');
                    return 'A second fragment joins the first.';
                },
            },
            { id: 'leave', label: 'Cover the mirror and move on', effect: () => 'You leave the whispers behind.' },
        ],
    }),

    () => ({
        id: 'bone-inscription',
        title: 'Bone Inscription',
        body: 'A skull bears a third name carved into its forehead.',
        choices: [
            {
                id: 'study',
                label: 'Study the inscription',
                effect: (game) => {
                    game.acceptQuest('phylactery-riddle');
                    if (game.questFlags.phylacteryClue3) return 'You already know this fragment.';
                    game.questFlags.phylacteryClue3 = true;
                    game.advanceQuestStep('phylactery-riddle', 'clue-3');
                    return 'The third fragment completes the name.';
                },
            },
            { id: 'leave', label: 'Leave the skull alone', effect: () => 'You leave the bones in peace.' },
        ],
    }),

    () => ({
        id: 'hydra-stalks',
        title: 'A Hydra Stalks the Path',
        body: 'A five-headed shadow moves through the brambles ahead. It has not seen you yet.',
        choices: [
            {
                id: 'lure-into-pit',
                label: 'Lure it into a pit',
                requires: { class: 'warrior' },
                effect: (game) => {
                    for (const h of game.party) {
                        if (!h.alive) continue;
                        h.hp = Math.max(1, h.hp - 6);
                    }
                    game.acceptQuest('hydra-hunt');
                    game.advanceQuestStep('hydra-hunt', 'defeat-hydra');
                    return 'You bait the Hydra over the pit. It crashes through. (Each hero takes 6 HP.)';
                },
            },
            {
                id: 'sneak-past',
                label: 'Sneak past',
                requires: { class: 'rogue' },
                effect: (game) => {
                    game.acceptQuest('hydra-hunt');
                    game.advanceQuestStep('hydra-hunt', 'defeat-hydra');
                    return 'The rogue leads the party past unnoticed. The Hydra moves on.';
                },
            },
            {
                id: 'flee',
                label: 'Sound the retreat',
                effect: (game) => {
                    game.acceptQuest('hydra-hunt');
                    game.questFlags.hydraStalking = true;
                    const q = game.findQuest('hydra-hunt');
                    if (q && q.state === 'active') q.state = 'failed';
                    return 'You retreat. The Hydra is still out there, hunting. You feel its breath at the boss chamber.';
                },
            },
        ],
    }),

    () => ({
        id: 'friendly-acolyte',
        title: 'A Doubting Acolyte',
        body: 'A cult acolyte stops you. "I... I don\'t want to do this anymore. The Lich King is mad."',
        choices: [
            {
                id: 'recruit-mole',
                label: 'Promise to free them after the boss falls',
                effect: (game) => {
                    game.acceptQuest('cult-mole');
                    game.advanceQuestStep('cult-mole', 'befriend');
                    return 'They slip back into the cult to sabotage from within.';
                },
            },
            {
                id: 'kill',
                label: 'Strike them down',
                effect: () => 'You leave the acolyte dead. They take their doubts with them.',
            },
            { id: 'leave', label: 'Walk past', effect: () => 'You leave the acolyte to their doubts.' },
        ],
    }),
];

function pickFromPool(pool, rng) {
    return pool[Math.floor(rng() * pool.length)]();
}

/** Whether a given choice is currently selectable for this game's party. */
export function isChoiceAvailable(game, choice) {
    if (!choice) return false;
    if (choice.requires?.class && !partyHasClass(game, choice.requires.class)) return false;
    return true;
}

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
            case 'recruit': {
                this.recruitOffer = generateRecruit(this.rng, partyAvgLevel(this.party));
                this.phase = 'recruit';
                return true;
            }
            default:
                return false;
        }
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
        // Burn a torch. Without one, the next encounter is in darkness.
        if (this.torches > 0) {
            this.torches -= 1;
            this.darkness = false;
        } else {
            this.darkness = true;
        }

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

        // Depth + party-level scaling. Bosses are hand-tuned so they take a
        // gentler layer bump; non-bosses feel the full formula.
        const partyAvg = this.party.reduce((s, p) => s + p.level, 0) / Math.max(1, this.party.length);
        const layerScale = node.type === 'boss'
            ? 1 + (node.layer * LAYER_SCALE_PER_STEP) / BOSS_LAYER_SCALE_DIVISOR
            : 1 + node.layer * LAYER_SCALE_PER_STEP;
        const levelScale = 1 + (partyAvg - 1) * LEVEL_SCALE_PER_LEVEL;
        const scale = layerScale * levelScale;
        for (const e of this.encounter.enemies) {
            scaleEnemy(e, scale);
        }
        this.currentEncounterScale = scale;

        // Darkness stacks on top of scaling.
        if (this.darkness) {
            for (const e of this.encounter.enemies) {
                e.damage = Math.ceil(e.damage * (1 + DARKNESS_DAMAGE_PCT));
                for (const intent of e.intentRotation) {
                    if (typeof intent.amount === 'number') {
                        intent.amount = Math.ceil(intent.amount * (1 + DARKNESS_DAMAGE_PCT));
                    }
                }
            }
        }

        // Boss-engagement quest payoffs (Phylactery Riddle, Cult Mole, Hydra).
        if (node.type === 'boss') this.#applyBossQuestModifiers();

        this.scoreThisTurn = {};
        this.gemsMatchedThisTurn = {};
        this.phase = 'combat';
        // (No relic hook here — relics under the new design only fire on acquire.)
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
                if (hero.maxMana > 0) {
                    hero.maxMana += MANA_PER_LEVEL;
                    hero.mana = Math.min(hero.maxMana, hero.mana + MANA_PER_LEVEL);
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
     * Camp consumes a ration. With a ration: heal CAMP_HEAL_FRACTION,
     * refill caster mana, clear shields. Without: party loses
     * FITFUL_REST_HP_LOSS HP and gets nothing else.
     * Returns one of: 'rested', 'fitful'.
     */
    #applyCamp() {
        if (this.rations <= 0) {
            for (const hero of this.party) {
                if (!hero.alive) continue;
                hero.hp = Math.max(1, hero.hp - FITFUL_REST_HP_LOSS);
            }
            return 'fitful';
        }
        this.rations -= 1;
        for (const hero of this.party) {
            if (!hero.alive) continue;
            const heal = Math.floor(hero.maxHp * CAMP_HEAL_FRACTION);
            hero.hp = Math.min(hero.maxHp, hero.hp + heal);
            hero.shield = 0;
            if (hero.maxMana > 0) hero.mana = hero.maxMana;
        }
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
     * Serialize the entire run to plain JSON. Functions (event effects, spell
     * casts, relic hooks, intent rotations) are NOT serialized; they are
     * re-attached on `fromJSON` by looking up their template ids.
     *
     * Mid-event randomized state (e.g., the puzzle pedestals' correct answer)
     * is intentionally NOT preserved — reload re-instantiates the event from
     * its template, so the puzzle re-rolls. This is a deliberate trade-off
     * to avoid serializing closures.
     */
    toJSON() {
        return {
            version: 1,
            seed: this.seed,
            rngState: this.rng.getState(),
            runStartedAt: this.runStartedAt,
            phase: this.phase,
            party: deepClone(this.party),
            scoreThisTurn: { ...this.scoreThisTurn },
            totalScore: { ...this.totalScore },
            elementOffers: deepClone(this.elementOffers),
            lootOffer: this.lootOffer ? deepClone(this.lootOffer) : null,
            recruitOffer: this.recruitOffer ? deepClone(this.recruitOffer) : null,
            factions: { ...this.factions },
            quests: deepClone(this.quests),
            questFlags: { ...this.questFlags },
            codex: deepClone(this.codex),
            nextNodeOverride: this.nextNodeOverride,
            lootChanceBonus: this.lootChanceBonus,
            elementOfferFloor: this.elementOfferFloor,
            scoutAhead: this.scoutAhead,
            pendingRecruitRoll: this.pendingRecruitRoll,
            rations: this.rations,
            torches: this.torches,
            darkness: this.darkness,
            map: this.map ? deepClone(this.map) : null,
            currentNodeId: this.currentNodeId,
            currentEventId: this.currentEvent?.id ?? null,
            currentTemplate: this.currentTemplate
                ? { name: this.currentTemplate.name, boss: !!this.currentTemplate.boss }
                : null,
            board: this.board
                ? { rows: this.board.rows, cols: this.board.cols, grid: this.board.snapshot() }
                : null,
            encounter: this.encounter ? {
                enemies: deepClone(this.encounter.enemies),
                turn: this.encounter.turn,
                ultMeter: this.encounter.ultMeter,
                collectedXp: this.encounter.collectedXp,
                creditedDeaths: [...this.encounter._creditedDeaths],
            } : null,
        };
    }

    /** Restore a Game from a serialized snapshot. */
    static fromJSON(data) {
        if (!data || data.version !== 1) {
            throw new Error('Unrecognized save format.');
        }
        // Construct via `new` so private methods (#applyScoreModifiers, etc.)
        // are installed on the instance — Object.create(Game.prototype) would
        // skip them and `this.#foo()` later would throw. The freshly-generated
        // map/encounter are discarded by the assignments below.
        const game = new Game({ seed: data.seed, party: data.party ?? defaultParty() });
        game.seed = data.seed;
        game.rng = mulberry32(data.seed);
        game.rng.setState(data.rngState);
        game.runStartedAt = data.runStartedAt ?? Date.now();
        game.phase = data.phase ?? 'map';
        game.party = data.party ?? defaultParty();
        game.scoreThisTurn = data.scoreThisTurn ?? {};
        game.totalScore = data.totalScore ?? {};
        game.elementOffers = data.elementOffers ?? [];
        game.lootOffer = data.lootOffer ?? null;
        game.recruitOffer = data.recruitOffer ?? null;
        game.factions = data.factions ?? defaultFactionRelations();
        game.quests = data.quests ?? [];
        game.questFlags = data.questFlags ?? {};
        game.codex = data.codex ?? [];
        game.nextNodeOverride = data.nextNodeOverride ?? null;
        game.lootChanceBonus = data.lootChanceBonus ?? 0;
        game.elementOfferFloor = data.elementOfferFloor ?? 0;
        game.scoutAhead = data.scoutAhead ?? 0;
        game.pendingRecruitRoll = data.pendingRecruitRoll ?? false;
        game.rations = data.rations ?? STARTING_RATIONS;
        game.torches = data.torches ?? STARTING_TORCHES;
        game.darkness = data.darkness ?? false;
        game.map = data.map ?? null;
        game.currentNodeId = data.currentNodeId ?? null;
        game.runPlan = null;
        game.floor = 0;

        // Restore board (grid snapshot)
        if (data.board) {
            game.board = new Board({ rows: data.board.rows, cols: data.board.cols, rng: game.rng });
            game.board.grid = deepClone(data.board.grid);
        } else {
            game.board = null;
        }

        // Restore encounter (party reference shared with game.party)
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

        // Re-instantiate the event from its template id (loses puzzle state — OK)
        if (data.currentEventId) {
            const factory = findEventTemplate(data.currentEventId);
            game.currentEvent = factory ? factory() : null;
            if (!game.currentEvent && game.phase === 'event') game.phase = 'map';
        } else {
            game.currentEvent = null;
        }

        if (data.currentTemplate) {
            game.currentTemplate = data.currentTemplate;
        } else {
            game.currentTemplate = null;
        }

        return game;
    }
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function findEventTemplate(id) {
    for (const factory of EVENT_TEMPLATES) {
        try {
            const sample = factory();
            if (sample?.id === id) return factory;
        } catch (_) { /* ignore broken factories */ }
    }
    return null;
}
