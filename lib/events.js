import { makeHero, addItemToInventory, equipItem, forEachAliveHero } from './combat.js';
import { getItem, itemsByRarity } from './items.js';
import { MAX_PARTY_SIZE } from './game.js';

export const EVENT_HEAL_AMOUNT = 8;

export function partyHasClass(game, classRole) {
    return game.party.some(h => h.alive && h.role === classRole);
}

/** Whether a given choice is currently selectable for this game's party. */
export function isChoiceAvailable(game, choice) {
    if (!choice) return false;
    if (choice.requires?.class && !partyHasClass(game, choice.requires.class)) return false;
    return true;
}

// Named adventurers whose remains may be found mid-run. Ability sets lean
// into each class's prime requisite (rpg-fidelity-spec.md §1).
const FALLEN_ADVENTURERS = [
    {
        loreId: 'epitaph-tod',
        name: 'Tod Uphill', role: 'rogue', rank: 'rear',
        maxHp: 24, ac: 5, level: 2,
        abilities: { str: 11, dex: 17, con: 12, int: 12, wis: 10, cha: 11 },
        gear: ['dagger'],
    },
    {
        loreId: 'epitaph-beorham',
        name: 'Beorham the Bright', role: 'paladin', rank: 'front',
        maxHp: 32, ac: 4, level: 2,
        abilities: { str: 15, dex: 11, con: 14, int: 10, wis: 12, cha: 17 },
        gear: ['plate-mail', 'longsword-plus-1'],
    },
    {
        loreId: 'epitaph-ileria',
        name: 'Ileria of the Spire', role: 'mage', rank: 'rear',
        maxHp: 18, ac: 8, level: 2,
        abilities: { str: 9, dex: 13, con: 11, int: 17, wis: 11, cha: 10 },
        gear: ['mage-robe'],
    },
];

function buildFallenAdventurer(template, partyAvg) {
    const id = `remains-${template.role}-${Math.floor(Math.random() * 100000)}`;
    const hero = makeHero({
        id, name: template.name, role: template.role, rank: template.rank,
        maxHp: template.maxHp, ac: template.ac,
        level: Math.max(template.level, Math.floor(partyAvg)),
        abilities: template.abilities,
    });
    for (const itemId of template.gear) {
        const item = getItem(itemId);
        if (!item) continue;
        addItemToInventory(hero, item);
        equipItem(hero, itemId);
    }
    return hero;
}

export function pickRandomItem(game, rarities) {
    const pool = [];
    for (const r of rarities) pool.push(...itemsByRarity(r));
    if (pool.length === 0) return null;
    return pool[Math.floor(game.rng() * pool.length)];
}

export function giveItemToParty(game, item, prefix) {
    if (!item) return `${prefix}.`;
    for (const hero of game.party) {
        if (!hero.alive) continue;
        if (addItemToInventory(hero, item)) {
            return `${prefix}. You find a ${item.name} (now in ${hero.name}'s pack).`;
        }
    }
    return `${prefix}. You find a ${item.name}, but no one has room for it.`;
}

export function pickFromPool(pool, rng) {
    return pool[Math.floor(rng() * pool.length)]();
}

export const EVENT_TEMPLATES = [
    () => ({
        id: 'healing-shrine',
        title: 'Healing Shrine',
        body: 'A small altar pulses with green light. The party feels welcomed.',
        choices: [
            {
                id: 'touch',
                label: 'Touch the shrine',
                effect: (game) => {
                    forEachAliveHero(game.party, hero => {
                        hero.hp = Math.min(hero.maxHp, hero.hp + EVENT_HEAL_AMOUNT);
                    });
                    return `Each hero recovers ${EVENT_HEAL_AMOUNT} HP.`;
                },
            },
            {
                id: 'pray',
                label: 'Pray sincerely',
                requires: { class: 'cleric' },
                effect: (game) => {
                    forEachAliveHero(game.party, hero => {
                        hero.hp = Math.min(hero.maxHp, hero.hp + 14);
                    });
                    return 'A divine warmth fills the party. Every hero recovers 14 HP.';
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
                    forEachAliveHero(game.party, hero => {
                        hero.hp = Math.max(1, hero.hp - 6);
                    });
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
                    forEachAliveHero(game.party, hero => {
                        hero.hp = Math.min(hero.maxHp, hero.hp + 10);
                    });
                    return 'The druid prepares the mushroom safely. Each hero recovers 10 HP.';
                },
            },
            {
                id: 'eat-risky',
                label: 'Eat it raw',
                effect: (game) => {
                    if (game.rng() < 0.5) {
                        forEachAliveHero(game.party, hero => {
                            hero.hp = Math.min(hero.maxHp, hero.hp + 10);
                        });
                        return 'It was harmless! Each hero recovers 10 HP.';
                    }
                    forEachAliveHero(game.party, hero => {
                        hero.hp = Math.max(1, hero.hp - 5);
                    });
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
        const colors = ['red', 'blue', 'green'];
        const correct = colors[Math.floor(Math.random() * 3)];
        const wrongPenalty = (game) => {
            forEachAliveHero(game.party, hero => {
                hero.hp = Math.max(1, hero.hp - 5);
            });
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
                    forEachAliveHero(game.party, hero => {
                        hero.hp = Math.min(hero.maxHp, hero.hp + 12);
                    });
                    return 'You hand over a ration. A dwarven healer tends every hero (+12 HP each).';
                },
            },
            { id: 'leave', label: 'Move on', effect: () => 'You nod and continue past.' },
        ],
    }),

    // Quest-driving events

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
                    forEachAliveHero(game.party, h => {
                        h.hp = Math.max(1, h.hp - 8);
                    });
                    game.acceptQuest('free-the-prisoner');
                    game.questFlags.prisonerLiberatedByForce = true;
                    game.adjustFaction('drow', -1);
                    if (game.party.length < MAX_PARTY_SIZE) {
                        const id = `freed-prisoner-${Math.floor(Math.random() * 100000)}`;
                        const avg = game.party.reduce((s, p) => s + p.level, 0) / game.party.length;
                        const hero = makeHero({
                            id, name: 'Freed Prisoner', role: 'rogue', rank: 'rear',
                            maxHp: 24, ac: 6, level: Math.max(1, Math.floor(avg)),
                            abilities: { str: 11, dex: 16, con: 12, int: 12, wis: 10, cha: 11 },
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
                    forEachAliveHero(game.party, h => {
                        h.hp = Math.max(1, h.hp - 6);
                    });
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

export function findEventTemplate(id) {
    for (const factory of EVENT_TEMPLATES) {
        try {
            const sample = factory();
            if (sample?.id === id) return factory;
        } catch (_) { /* ignore broken factories */ }
    }
    return null;
}
