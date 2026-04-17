// Relics are the run-modifier rewards picked between encounters.
// Each relic exposes optional hooks the Game runs at known points:
//
//   modifyScore(scoreByColor, ctx)    -> new scoreByColor (or same)
//        Called once on commitTurn, before the score is handed to the encounter.
//   onTurnEnd(encounter, ctx)         -> void
//        Called after enemy attacks resolve, while the encounter is still ongoing.
//   onEncounterStart(encounter, ctx)  -> void
//        Called once when each new encounter begins.
//
// Hooks must mutate state in place if they want to apply effects (e.g. heals);
// modifyScore returns the (possibly new) score map.

const REGISTRY = [
    {
        id: 'cascade-crown',
        name: 'Cascade Crown',
        description: 'Total board score is multiplied by 1.5.',
        rarity: 'common',
        hooks: {
            modifyScore(score) {
                const out = {};
                for (const [k, v] of Object.entries(score)) out[k] = Math.floor(v * 1.5);
                return out;
            },
        },
    },
    {
        id: 'bloodstone',
        name: 'Bloodstone',
        description: 'Ruby score is multiplied by 1.5.',
        rarity: 'common',
        hooks: {
            modifyScore(score) {
                if (!score.ruby) return score;
                return { ...score, ruby: Math.floor(score.ruby * 1.5) };
            },
        },
    },
    {
        id: 'mana-surge',
        name: 'Mana Surge',
        description: 'Sapphire score is multiplied by 1.5.',
        rarity: 'common',
        hooks: {
            modifyScore(score) {
                if (!score.sapphire) return score;
                return { ...score, sapphire: Math.floor(score.sapphire * 1.5) };
            },
        },
    },
    {
        id: 'greedy-eye',
        name: 'Greedy Eye',
        description: 'Topaz score is multiplied by 1.5.',
        rarity: 'common',
        hooks: {
            modifyScore(score) {
                if (!score.topaz) return score;
                return { ...score, topaz: Math.floor(score.topaz * 1.5) };
            },
        },
    },
    {
        id: 'healing-wellspring',
        name: 'Healing Wellspring',
        description: 'At the end of each turn, every alive hero heals 3 HP.',
        rarity: 'uncommon',
        hooks: {
            onTurnEnd(encounter) {
                for (const hero of encounter.party) {
                    if (!hero.alive) continue;
                    hero.hp = Math.min(hero.maxHp, hero.hp + 3);
                }
            },
        },
    },
    {
        id: 'aegis',
        name: 'Aegis',
        description: 'Every hero starts each encounter with 8 shield.',
        rarity: 'uncommon',
        hooks: {
            onEncounterStart(encounter) {
                for (const hero of encounter.party) {
                    if (!hero.alive) continue;
                    hero.shield = Math.max(hero.shield, 8);
                }
            },
        },
    },
];

const BY_ID = new Map(REGISTRY.map(r => [r.id, r]));

export function allRelicIds() {
    return REGISTRY.map(r => r.id);
}

export function getRelic(id) {
    return BY_ID.get(id) ?? null;
}

/** Draw N distinct relics from the pool of not-yet-owned ones. */
export function drawRelicOffers(ownedIds, count, rng = Math.random) {
    const owned = new Set(ownedIds);
    const pool = REGISTRY.filter(r => !owned.has(r.id));
    const offers = [];
    while (offers.length < count && pool.length > 0) {
        const idx = Math.floor(rng() * pool.length);
        offers.push(pool[idx]);
        pool.splice(idx, 1);
    }
    return offers.map(r => r.id);
}
