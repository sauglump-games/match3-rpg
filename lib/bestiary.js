// Bestiary: monster definitions and tiered encounter pools.
//
// Color → role lens (per ADR 0002): ruby = warrior physical, sapphire = mage
// arcane, topaz = rogue precise, emerald = druid heal, diamond = cleric divine,
// amethyst = summoner ult charge.
//
// Resistance/weakness conventions used here:
//   Undead       — resist [ruby, topaz]; weak [diamond] (Turn Undead)
//   Constructs   — resist [ruby, topaz]; weak [sapphire]
//   Demons/devils— resist [sapphire];    weak [diamond]
//   Lycanthropes — resist [ruby];        weak [sapphire]
//   Aberrations  — resist [sapphire];    weak [ruby]
//   Giants       — resist [ruby];        weak [sapphire]
//   Plants       — resist [topaz];       weak [ruby] (cutting hurts)
//   Fey          — resist [diamond];     weak [sapphire] (cold iron / arcane)
//   Slimes/oozes — resist [topaz];       weak nothing
//   Beasts       — no defaults
//
// Each monster also carries a `theme` tag. Encounters can be filtered or grouped
// by theme later (e.g. when ramping difficulty per act).

import { makeEnemy } from './combat.js';

// ----------------------------------------------------------------------------
// Monster factories. Each returns a *fresh* enemy descriptor; the encounter
// builder fixes the per-encounter id (so two skeletons in one fight don't
// collide on id).
// ----------------------------------------------------------------------------

const MONSTERS = {
    'goblin-scout': () => ({
        name: 'Goblin Scout', maxHp: 18, ac: 8, damage: 3, xp: 30,
    }),
    'goblin-cutter': () => ({
        name: 'Goblin Cutter', maxHp: 22, ac: 8, damage: 4, xp: 40,
        intentRotation: [
            { kind: 'attack', amount: 4, label: 'Slash' },
            { kind: 'big-attack', amount: 8, label: 'Reckless Cleave' },
        ],
    }),
    'kobold-trapper': () => ({
        name: 'Kobold Trapper', maxHp: 12, ac: 9, damage: 3, xp: 25,
        intentRotation: [
            { kind: 'defend', amount: 6, label: 'Set Trap' },
            { kind: 'big-attack', amount: 7, label: 'Spring Trap' },
        ],
    }),
    'bandit': () => ({
        name: 'Bandit', maxHp: 16, ac: 8, damage: 4, xp: 35,
    }),
    'cult-acolyte': () => ({
        name: 'Cult Acolyte', maxHp: 22, ac: 8, damage: 4, xp: 40,
        alignment: 'evil',
    }),
    'skeleton': () => ({
        name: 'Skeleton', maxHp: 22, ac: 7, damage: 4, xp: 45,
        resistances: ['ruby', 'topaz'], weaknesses: ['diamond'],
        undead: true,
    }),
    'skeleton-archer': () => ({
        name: 'Skeleton Archer', maxHp: 20, ac: 7, damage: 5, xp: 45,
        resistances: ['ruby'], weaknesses: ['diamond'],
        undead: true,
    }),
    'zombie': () => ({
        name: 'Zombie', maxHp: 32, ac: 9, damage: 3, xp: 50,
        resistances: ['ruby'], weaknesses: ['diamond'],
        undead: true,
    }),
    'giant-spider': () => ({
        name: 'Giant Spider', maxHp: 24, ac: 7, damage: 4, xp: 50,
        intentRotation: [
            {
                kind: 'attack', amount: 4, label: 'Venom Bite',
                applyStatus: { kind: 'poison', duration: 3, severity: 2 },
            },
            { kind: 'defend', amount: 6, label: 'Web' },
            { kind: 'big-attack', amount: 8, label: 'Pounce' },
        ],
    }),
    // ---------- Tier 2 (CR 1–2) ----------
    'dire-wolf': () => ({
        name: 'Dire Wolf', maxHp: 38, ac: 7, damage: 7, xp: 100,
        intentRotation: [
            { kind: 'attack', amount: 6, label: 'Bite' },
            { kind: 'big-attack', amount: 11, label: 'Pack Tactics' },
        ],
    }),
    'hobgoblin-soldier': () => ({
        name: 'Hobgoblin Soldier', maxHp: 28, ac: 6, damage: 5, xp: 90,
        intentRotation: [
            { kind: 'defend', amount: 8, label: 'Shield Wall' },
            { kind: 'attack', amount: 6, label: 'Longsword' },
            { kind: 'big-attack', amount: 10, label: 'Martial Strike' },
        ],
    }),
    'bugbear': () => ({
        name: 'Bugbear', maxHp: 36, ac: 6, damage: 7, xp: 110,
        intentRotation: [
            { kind: 'attack', amount: 7, label: 'Morningstar' },
            { kind: 'big-attack', amount: 13, label: 'Brute Smash' },
        ],
    }),
    'ghoul': () => ({
        name: 'Ghoul', maxHp: 24, ac: 6, damage: 5, xp: 100,
        resistances: ['ruby', 'topaz'], weaknesses: ['diamond'],
        undead: true,
        intentRotation: [
            { kind: 'attack', amount: 5, label: 'Claws' },
            {
                kind: 'big-attack', amount: 9, label: 'Paralyzing Bite',
                applyStatus: { kind: 'stun', duration: 1 },
            },
        ],
    }),
    'specter': () => ({
        name: 'Specter', maxHp: 22, ac: 6, damage: 5, xp: 110,
        resistances: ['ruby', 'topaz'],
        weaknesses: ['sapphire', 'diamond'],
        undead: true,
        intentRotation: [
            { kind: 'attack', amount: 5, label: 'Life Drain' },
        ],
    }),
    'imp': () => ({
        name: 'Imp', maxHp: 14, ac: 9, damage: 3, xp: 80,
        resistances: ['sapphire'],
        weaknesses: ['ruby'],
        alignment: 'evil',
        intentRotation: [
            { kind: 'attack', amount: 3, label: 'Sting' },
            { kind: 'attack', amount: 4, label: 'Sting' },
            { kind: 'defend', amount: 4, label: 'Vanish' },
        ],
    }),
    'ogre': () => ({
        name: 'Ogre', maxHp: 60, ac: 6, damage: 8, xp: 200,
        resistances: ['ruby'], weaknesses: ['sapphire'],
        intentRotation: [
            { kind: 'attack', amount: 7, label: 'Smash' },
            { kind: 'big-attack', amount: 14, label: 'Boulder Throw' },
            { kind: 'defend', amount: 10, label: 'Brace' },
        ],
    }),
    // ---------- Tier 3 / Elite (CR 3–5) ----------
    'cult-warlock': () => ({
        name: 'Cult Warlock', maxHp: 34, ac: 7, damage: 6, xp: 180,
        resistances: ['sapphire'], weaknesses: ['ruby'],
        alignment: 'evil',
        intentRotation: [
            { kind: 'attack', amount: 5, label: 'Hex' },
            { kind: 'summon', label: 'Summon Imp', spawn: { name: 'Imp', maxHp: 8, ac: 9, damage: 2 } },
            { kind: 'big-attack', amount: 11, label: 'Eldritch Blast' },
        ],
    }),
    'manticore': () => ({
        name: 'Manticore', maxHp: 52, ac: 6, damage: 7, xp: 250,
        intentRotation: [
            { kind: 'attack', amount: 7, label: 'Claws' },
            { kind: 'big-attack', amount: 13, label: 'Tail Spike Volley' },
            { kind: 'attack', amount: 7, label: 'Claws' },
        ],
    }),
    'mummy': () => ({
        name: 'Mummy', maxHp: 58, ac: 5, damage: 8, xp: 280,
        resistances: ['ruby', 'topaz', 'sapphire'],
        weaknesses: ['diamond'],
        undead: true,
        intentRotation: [
            { kind: 'attack', amount: 8, label: 'Rotting Fist' },
            {
                kind: 'big-attack', amount: 14, label: 'Mummy Curse',
                applyStatus: { kind: 'curse', duration: 3 },
            },
            { kind: 'defend', amount: 12, label: 'Bandages' },
        ],
    }),
    'werewolf': () => ({
        name: 'Werewolf', maxHp: 58, ac: 5, damage: 8, xp: 280,
        resistances: ['ruby', 'topaz'], weaknesses: ['sapphire'],
        intentRotation: [
            { kind: 'big-attack', amount: 14, label: 'Savage Bite' },
            { kind: 'attack', amount: 8, label: 'Rake' },
        ],
    }),
    'wraith': () => ({
        name: 'Wraith', maxHp: 44, ac: 5, damage: 6, xp: 220,
        resistances: ['ruby', 'topaz'],
        weaknesses: ['sapphire', 'diamond'],
        undead: true,
        intentRotation: [
            { kind: 'attack', amount: 6, label: 'Life Drain' },
            { kind: 'big-attack', amount: 12, label: 'Soul Steal' },
        ],
    }),
    'gargoyle': () => ({
        name: 'Gargoyle', maxHp: 50, ac: 4, damage: 6, xp: 220,
        resistances: ['ruby', 'topaz'], weaknesses: ['sapphire'],
        intentRotation: [
            { kind: 'defend', amount: 14, label: 'Stone Skin' },
            { kind: 'attack', amount: 6, label: 'Claw' },
            { kind: 'attack', amount: 6, label: 'Claw' },
            { kind: 'big-attack', amount: 11, label: 'Diving Slam' },
        ],
    }),
    'hill-giant': () => ({
        name: 'Hill Giant', maxHp: 90, ac: 5, damage: 10, xp: 350,
        resistances: ['ruby'],
        intentRotation: [
            { kind: 'attack', amount: 9, label: 'Club' },
            { kind: 'big-attack', amount: 16, label: 'Boulder Hurl' },
            { kind: 'attack', amount: 9, label: 'Club' },
        ],
    }),
    // ---------- Boss tier ----------
    'lich-king': () => ({
        name: 'Lich King', maxHp: 140, ac: 4, damage: 10, xp: 800,
        resistances: ['ruby', 'topaz', 'sapphire'],
        weaknesses: ['diamond'],
        undead: true,
        intentRotation: [
            { kind: 'attack', amount: 9, label: 'Necrotic Bolt' },
            { kind: 'defend', amount: 14, label: 'Phantom Wards' },
            { kind: 'big-attack', amount: 18, label: 'Soul Reap' },
            { kind: 'attack', amount: 9, label: 'Necrotic Bolt' },
        ],
    }),
    'phylactery': () => ({
        name: 'Phylactery', maxHp: 30, ac: 10, damage: 2, xp: 100,
        resistances: ['ruby', 'topaz'], weaknesses: ['sapphire'],
        undead: true,
        intentRotation: [{ kind: 'attack', amount: 2, label: 'Pulse' }],
    }),
    'adult-red-dragon': () => ({
        name: 'Adult Red Dragon', maxHp: 200, ac: 3, damage: 12, xp: 1000,
        resistances: ['ruby', 'sapphire'],
        weaknesses: ['diamond'],
        intentRotation: [
            { kind: 'attack', amount: 11, label: 'Claw' },
            { kind: 'big-attack', amount: 22, label: 'Fire Breath' },
            { kind: 'defend', amount: 18, label: 'Frightful Presence' },
            { kind: 'attack', amount: 11, label: 'Bite' },
            { kind: 'big-attack', amount: 22, label: 'Fire Breath' },
        ],
    }),
    'beholder': () => ({
        name: 'Beholder', maxHp: 160, ac: 2, damage: 8, xp: 900,
        resistances: ['ruby', 'topaz'],
        weaknesses: ['sapphire'],
        intentRotation: [
            { kind: 'attack', amount: 8, label: 'Eye Ray: Slowing' },
            { kind: 'big-attack', amount: 16, label: 'Eye Ray: Disintegrate' },
            { kind: 'defend', amount: 16, label: 'Antimagic Cone' },
            { kind: 'attack', amount: 9, label: 'Eye Ray: Telekinetic' },
            { kind: 'summon', label: 'Eye Stalk Summon', spawn: { name: 'Eye Stalk', maxHp: 12, ac: 8, damage: 4 } },
        ],
    }),

    // ===========================================================
    // === Expansion: more themes, new tiers ====================
    // ===========================================================

    // ---------- Tier 1 additions ----------
    'wolf': () => ({
        name: 'Wolf', maxHp: 14, ac: 8, damage: 4, xp: 30,
        intentRotation: [{ kind: 'attack', amount: 4, label: 'Bite' }],
    }),
    'giant-rat': () => ({
        name: 'Giant Rat', maxHp: 8, ac: 9, damage: 2, xp: 15,
        intentRotation: [
            { kind: 'attack', amount: 2, label: 'Filthy Bite',
              applyStatus: { kind: 'poison', duration: 2, severity: 1 } },
        ],
    }),
    'cultist': () => ({
        name: 'Cultist', maxHp: 14, ac: 9, damage: 3, xp: 25,
        alignment: 'evil',
    }),
    'stirge': () => ({
        name: 'Stirge', maxHp: 6, ac: 9, damage: 3, xp: 20,
        intentRotation: [{ kind: 'attack', amount: 3, label: 'Blood Drain' }],
    }),
    'twig-blight': () => ({
        name: 'Twig Blight', maxHp: 10, ac: 9, damage: 3, xp: 25,
        resistances: ['topaz'], weaknesses: ['ruby'],
        intentRotation: [{ kind: 'attack', amount: 3, label: 'Claw' }],
    }),
    'drow-scout': () => ({
        name: 'Drow Scout', maxHp: 16, ac: 8, damage: 4, xp: 50,
        intentRotation: [
            { kind: 'attack', amount: 4, label: 'Hand Crossbow' },
            { kind: 'attack', amount: 4, label: 'Short Sword',
              applyStatus: { kind: 'poison', duration: 2, severity: 2 } },
        ],
    }),

    // ---------- Tier 2 additions ----------
    'worg': () => ({
        name: 'Worg', maxHp: 30, ac: 7, damage: 6, xp: 100,
        intentRotation: [
            { kind: 'attack', amount: 6, label: 'Bite' },
            { kind: 'big-attack', amount: 10, label: 'Pack Hunt' },
        ],
    }),
    'animated-armor': () => ({
        name: 'Animated Armor', maxHp: 32, ac: 4, damage: 6, xp: 110,
        resistances: ['ruby', 'topaz'], weaknesses: ['sapphire'],
        intentRotation: [
            { kind: 'attack', amount: 6, label: 'Slam' },
            { kind: 'defend', amount: 10, label: 'Reinforce' },
            { kind: 'big-attack', amount: 11, label: 'Charge' },
        ],
    }),
    'gnoll': () => ({
        name: 'Gnoll', maxHp: 22, ac: 6, damage: 5, xp: 100,
        intentRotation: [
            { kind: 'attack', amount: 5, label: 'Spear' },
            { kind: 'big-attack', amount: 9, label: 'Rampage' },
        ],
    }),
    'lizardfolk': () => ({
        name: 'Lizardfolk', maxHp: 26, ac: 7, damage: 5, xp: 100,
        intentRotation: [
            { kind: 'attack', amount: 5, label: 'Bite' },
            { kind: 'attack', amount: 4, label: 'Spiked Shield' },
        ],
    }),
    'will-o-wisp': () => ({
        name: 'Will-o\'-Wisp', maxHp: 18, ac: 4, damage: 5, xp: 130,
        resistances: ['ruby', 'topaz'],
        weaknesses: ['sapphire'],
        intentRotation: [
            { kind: 'attack', amount: 5, label: 'Shock' },
            { kind: 'defend', amount: 10, label: 'Invisibility' },
            { kind: 'attack', amount: 6, label: 'Shock',
              applyStatus: { kind: 'stun', duration: 1 } },
        ],
    }),
    'bandit-captain': () => ({
        name: 'Bandit Captain', maxHp: 36, ac: 5, damage: 7, xp: 150,
        intentRotation: [
            { kind: 'attack', amount: 7, label: 'Cutlass' },
            { kind: 'big-attack', amount: 11, label: 'Parry & Strike' },
            { kind: 'defend', amount: 9, label: 'Shout: Form Up' },
        ],
    }),

    // ---------- Elite additions ----------
    'wight': () => ({
        name: 'Wight', maxHp: 50, ac: 5, damage: 8, xp: 250,
        resistances: ['ruby', 'topaz'], weaknesses: ['diamond'],
        undead: true,
        intentRotation: [
            { kind: 'attack', amount: 8, label: 'Life Drain' },
            { kind: 'big-attack', amount: 13, label: 'Soul Sap',
              applyStatus: { kind: 'curse', duration: 3 } },
        ],
    }),
    'knight': () => ({
        name: 'Knight', maxHp: 56, ac: 3, damage: 9, xp: 280,
        intentRotation: [
            { kind: 'defend', amount: 14, label: 'Shield Up' },
            { kind: 'attack', amount: 9, label: 'Longsword' },
            { kind: 'big-attack', amount: 15, label: 'Lance Charge' },
        ],
    }),
    'doppelganger': () => ({
        name: 'Doppelganger', maxHp: 42, ac: 6, damage: 7, xp: 240,
        intentRotation: [
            { kind: 'attack', amount: 7, label: 'Mockery' },
            { kind: 'big-attack', amount: 13, label: 'Read & Strike' },
            { kind: 'defend', amount: 10, label: 'Take Another Form' },
        ],
    }),
    'owlbear': () => ({
        name: 'Owlbear', maxHp: 64, ac: 6, damage: 9, xp: 280,
        intentRotation: [
            { kind: 'attack', amount: 8, label: 'Beak' },
            { kind: 'big-attack', amount: 14, label: 'Multiattack' },
        ],
    }),
    'phase-spider': () => ({
        name: 'Phase Spider', maxHp: 36, ac: 4, damage: 6, xp: 250,
        intentRotation: [
            { kind: 'attack', amount: 6, label: 'Phase Bite',
              applyStatus: { kind: 'poison', duration: 3, severity: 3 } },
            { kind: 'defend', amount: 12, label: 'Phase Out' },
            { kind: 'big-attack', amount: 11, label: 'Spectral Pounce' },
        ],
    }),
    'berserker': () => ({
        name: 'Berserker', maxHp: 60, ac: 7, damage: 10, xp: 250,
        intentRotation: [
            { kind: 'big-attack', amount: 14, label: 'Frenzied Strike' },
            { kind: 'attack', amount: 9, label: 'Greataxe' },
        ],
    }),

    // ---------- Boss additions ----------
    'death-knight': () => ({
        name: 'Death Knight', maxHp: 180, ac: 3, damage: 13, xp: 1100,
        resistances: ['ruby', 'topaz', 'sapphire'],
        weaknesses: ['diamond'],
        undead: true,
        intentRotation: [
            { kind: 'attack', amount: 12, label: 'Hellfire Strike' },
            { kind: 'defend', amount: 16, label: 'Ranks Reform' },
            { kind: 'big-attack', amount: 20, label: 'Doom Cleave',
              applyStatus: { kind: 'curse', duration: 3 } },
            { kind: 'attack', amount: 12, label: 'Hellfire Strike' },
        ],
    }),
    'mind-flayer-arcanist': () => ({
        name: 'Mind Flayer Arcanist', maxHp: 130, ac: 6, damage: 9, xp: 950,
        resistances: ['sapphire'], weaknesses: ['ruby'],
        intentRotation: [
            { kind: 'big-attack', amount: 15, label: 'Mind Blast',
              applyStatus: { kind: 'stun', duration: 1 } },
            { kind: 'attack', amount: 9, label: 'Tentacle' },
            { kind: 'summon', label: 'Brain Spawn',
              spawn: { name: 'Intellect Devourer', maxHp: 16, ac: 8, damage: 4 } },
            { kind: 'big-attack', amount: 15, label: 'Brain Drain',
              applyStatus: { kind: 'curse', duration: 3 } },
        ],
    }),
    'intellect-devourer': () => ({
        name: 'Intellect Devourer', maxHp: 18, ac: 8, damage: 4, xp: 100,
        resistances: ['sapphire'], weaknesses: ['ruby'],
        intentRotation: [{ kind: 'attack', amount: 4, label: 'Devour Brain' }],
    }),
    'frost-giant-jarl': () => ({
        name: 'Frost Giant Jarl', maxHp: 190, ac: 5, damage: 14, xp: 1100,
        resistances: ['sapphire'],
        weaknesses: ['ruby'],
        intentRotation: [
            { kind: 'attack', amount: 13, label: 'Greataxe' },
            { kind: 'big-attack', amount: 22, label: 'Avalanche' },
            { kind: 'defend', amount: 18, label: 'Wall of Ice' },
            { kind: 'attack', amount: 13, label: 'Boulder Throw' },
        ],
    }),
    'treant-elder': () => ({
        name: 'Treant Elder', maxHp: 220, ac: 4, damage: 14, xp: 1200,
        resistances: ['topaz'], weaknesses: ['ruby', 'sapphire'],
        intentRotation: [
            { kind: 'attack', amount: 12, label: 'Slam' },
            { kind: 'defend', amount: 22, label: 'Bark Hardens' },
            { kind: 'big-attack', amount: 18, label: 'Crushing Limb' },
            { kind: 'summon', label: 'Awaken the Grove',
              spawn: { name: 'Awakened Shrub', maxHp: 12, ac: 8, damage: 3 } },
        ],
    }),
    'awakened-shrub': () => ({
        name: 'Awakened Shrub', maxHp: 12, ac: 9, damage: 3, xp: 60,
        resistances: ['topaz'], weaknesses: ['ruby'],
        intentRotation: [{ kind: 'attack', amount: 3, label: 'Tangle' }],
    }),
    'hydra': () => ({
        name: 'Hydra', maxHp: 175, ac: 6, damage: 11, xp: 1000,
        intentRotation: [
            { kind: 'big-attack', amount: 18, label: 'Five-Headed Bite' },
            { kind: 'attack', amount: 11, label: 'Tail Lash' },
            { kind: 'big-attack', amount: 18, label: 'Five-Headed Bite' },
            { kind: 'defend', amount: 14, label: 'Heads Regrow' },
        ],
    }),
    'vampire-lord': () => ({
        name: 'Vampire Lord', maxHp: 165, ac: 4, damage: 12, xp: 1100,
        resistances: ['ruby', 'topaz'],
        weaknesses: ['diamond'],
        undead: true,
        intentRotation: [
            { kind: 'attack', amount: 11, label: 'Bite (Life Drain)' },
            { kind: 'big-attack', amount: 18, label: 'Charm of the Damned',
              applyStatus: { kind: 'curse', duration: 3 } },
            { kind: 'defend', amount: 14, label: 'Mist Form' },
            { kind: 'summon', label: 'Call the Spawn',
              spawn: { name: 'Vampire Spawn', maxHp: 28, ac: 6, damage: 6 } },
            { kind: 'big-attack', amount: 19, label: 'Bite (Drain)',
              applyStatus: { kind: 'stun', duration: 1 } },
        ],
    }),
    'vampire-spawn': () => ({
        name: 'Vampire Spawn', maxHp: 28, ac: 6, damage: 6, xp: 220,
        resistances: ['ruby', 'topaz'], weaknesses: ['diamond'],
        undead: true,
        intentRotation: [
            { kind: 'attack', amount: 6, label: 'Claws' },
            { kind: 'attack', amount: 6, label: 'Bite' },
        ],
    }),
};

export function makeMonster(id, idSuffix) {
    const fn = MONSTERS[id];
    if (!fn) throw new Error(`unknown monster id: ${id}`);
    return makeEnemy({ id: idSuffix, monsterId: id, ...fn() });
}

export function listMonsterIds() {
    return Object.keys(MONSTERS);
}

// ----------------------------------------------------------------------------
// Encounter builders. Each returns a { name, enemies, boss? } template.
// ----------------------------------------------------------------------------

function buildEncounter({ name, monsters, boss = false }) {
    return {
        name,
        boss,
        enemies: monsters.map((id, i) => makeMonster(id, `e${i + 1}`)),
    };
}

const TIER1 = [
    () => buildEncounter({ name: 'Goblin Patrol',     monsters: ['goblin-scout', 'goblin-cutter'] }),
    () => buildEncounter({ name: 'Kobold Trap',       monsters: ['kobold-trapper', 'kobold-trapper', 'kobold-trapper'] }),
    () => buildEncounter({ name: 'Highway Bandits',   monsters: ['bandit', 'bandit', 'cult-acolyte'] }),
    () => buildEncounter({ name: 'Restless Dead',     monsters: ['skeleton', 'skeleton-archer', 'zombie'] }),
    () => buildEncounter({ name: 'Spider Nest',       monsters: ['giant-spider', 'giant-spider'] }),
    () => buildEncounter({ name: 'Wolves at the Gate', monsters: ['wolf', 'wolf', 'wolf'] }),
    () => buildEncounter({ name: 'Cult Initiates',    monsters: ['cultist', 'cultist', 'cult-acolyte'] }),
    () => buildEncounter({ name: 'Stirge Swarm',      monsters: ['stirge', 'stirge', 'stirge', 'stirge'] }),
    () => buildEncounter({ name: 'Twig Blight Patch', monsters: ['twig-blight', 'twig-blight', 'twig-blight'] }),
    () => buildEncounter({ name: 'Drow Skirmishers',  monsters: ['drow-scout', 'drow-scout', 'giant-rat'] }),
];

const TIER2 = [
    () => buildEncounter({ name: 'Wolf Pack',         monsters: ['dire-wolf', 'dire-wolf'] }),
    () => buildEncounter({ name: 'Goblinoid Warband', monsters: ['hobgoblin-soldier', 'bugbear', 'goblin-scout'] }),
    () => buildEncounter({ name: 'Crypt Hunters',     monsters: ['ghoul', 'ghoul', 'specter'] }),
    () => buildEncounter({ name: 'Phantasmal Haunt',  monsters: ['specter', 'imp', 'imp'] }),
    () => buildEncounter({ name: 'Dark Cabal',        monsters: ['cult-acolyte', 'cult-warlock', 'cult-acolyte'] }),
    () => buildEncounter({ name: 'Worg Pack',         monsters: ['worg', 'worg', 'goblin-scout'] }),
    () => buildEncounter({ name: 'Animated Armory',   monsters: ['animated-armor', 'animated-armor'] }),
    () => buildEncounter({ name: 'Gnoll Hunting Party', monsters: ['gnoll', 'gnoll', 'lizardfolk'] }),
    () => buildEncounter({ name: "Hag's Garden",      monsters: ['will-o-wisp', 'twig-blight', 'twig-blight'] }),
    () => buildEncounter({ name: 'Bandit Ambush',     monsters: ['bandit-captain', 'bandit', 'bandit'] }),
];

const ELITE = [
    () => buildEncounter({ name: 'Cavern Brute',     monsters: ['ogre'] }),
    () => buildEncounter({ name: 'Cursed Pharaoh',   monsters: ['mummy', 'skeleton', 'skeleton'] }),
    () => buildEncounter({ name: 'Lycanthrope Hunt', monsters: ['werewolf', 'dire-wolf'] }),
    () => buildEncounter({ name: 'Stone Sentinels',  monsters: ['gargoyle', 'gargoyle'] }),
    () => buildEncounter({ name: 'Apex Predator',    monsters: ['manticore'] }),
    () => buildEncounter({ name: 'Hill Tyrant',      monsters: ['hill-giant'] }),
    () => buildEncounter({ name: 'Wraith Conclave',  monsters: ['wraith', 'cult-warlock'] }),
    () => buildEncounter({ name: "Wight's Court",    monsters: ['wight', 'wight', 'skeleton'] }),
    () => buildEncounter({ name: 'Lost Knight',      monsters: ['knight', 'berserker'] }),
    () => buildEncounter({ name: 'Doppelganger Hunt', monsters: ['doppelganger', 'phase-spider'] }),
    () => buildEncounter({ name: 'Owlbear Lair',     monsters: ['owlbear', 'wolf'] }),
    () => buildEncounter({ name: 'Berserker Warband', monsters: ['berserker', 'berserker', 'gnoll'] }),
];

const BOSSES = [
    () => buildEncounter({ name: 'The Lich King',       monsters: ['lich-king', 'phylactery'], boss: true }),
    () => buildEncounter({ name: 'The Crimson Wyrm',    monsters: ['adult-red-dragon'], boss: true }),
    () => buildEncounter({ name: 'Eye of the Deep',     monsters: ['beholder', 'imp', 'imp'], boss: true }),
    () => buildEncounter({ name: 'The Death Knight',    monsters: ['death-knight', 'wight'], boss: true }),
    () => buildEncounter({ name: 'Mind Flayer Conclave', monsters: ['mind-flayer-arcanist', 'intellect-devourer', 'intellect-devourer'], boss: true }),
    () => buildEncounter({ name: 'Jarl of the Frost',   monsters: ['frost-giant-jarl'], boss: true }),
    () => buildEncounter({ name: 'The Eldest Treant',   monsters: ['treant-elder', 'awakened-shrub', 'awakened-shrub'], boss: true }),
    () => buildEncounter({ name: 'The Hydra',           monsters: ['hydra'], boss: true }),
    () => buildEncounter({ name: 'Bloodlord of the Crypt', monsters: ['vampire-lord', 'vampire-spawn', 'vampire-spawn'], boss: true }),
];

export const ENCOUNTER_POOLS = { tier1: TIER1, tier2: TIER2, elite: ELITE, boss: BOSSES };

/**
 * Pick which combat pool a node draws from based on its layer in the map.
 * Layer 0..midpoint-1 → tier1; layer >= midpoint → tier2.
 */
export function combatTierForLayer(layer, mapDepth) {
    const midpoint = Math.max(1, Math.floor((mapDepth - 2) / 2));
    return layer < midpoint ? 'tier1' : 'tier2';
}
