// Potions — combinations of elements at specific grades that brew into a
// single use consumable. Every potion effect is strictly PROCGEN-ONLY:
// it mutates run-scope resources, map choices, or future-offer parameters,
// never hero stats, spells, or combat math.
//
// Stash shape (in MetaStash):
//   { elements: {...}, potions: { [potionId]: count } }

import {
    stashCount, addToStash, takeFromStash, GRADES,
} from './elements.js';

/**
 * Recipe format: { [elementId]: [gradeIcost, gradeIIcost, gradeIIIcost, gradeIVcost] }
 * Zero-cost slots can be omitted. Only non-zero slots matter.
 */
const POTIONS = [
    {
        id: 'travelers-tonic',
        name: "Traveler's Tonic",
        desc: 'A smoky draught of packed earth. Grants 2 extra rations.',
        recipe: { earth: [4, 0, 0, 0] },
        effect(game) { game.rations += 2; return '+2 🍖'; },
    },
    {
        id: 'torchlight-elixir',
        name: 'Torchlight Elixir',
        desc: 'Bottled fire that never dims. Grants 3 extra torches.',
        recipe: { fire: [4, 0, 0, 0] },
        effect(game) { game.torches += 3; return '+3 🔥'; },
    },
    {
        id: 'salt-of-fortune',
        name: 'Salt of Fortune',
        desc: 'Pinch it on a blade. Loot rolls favour the lucky for the rest of the run.',
        recipe: { salt: [0, 2, 0, 0], moonstone: [2, 0, 0, 0] },
        effect(game) { game.lootChanceBonus = (game.lootChanceBonus ?? 0) + 0.2; return '+20% loot chance'; },
    },
    {
        id: 'shadow-draught',
        name: 'Shadow Draught',
        desc: 'Drink it, and the next hostile path becomes a Rest Site.',
        recipe: { shadow: [4, 0, 0, 0] },
        effect(game) { game.nextNodeOverride = 'camp'; return 'Next fight → Rest Site'; },
    },
    {
        id: 'sulfurous-lure',
        name: 'Sulfurous Lure',
        desc: 'Pour this on the dirt and something dangerous will come running.',
        recipe: { sulfur: [4, 0, 0, 0] },
        effect(game) { game.nextNodeOverride = 'elite'; return 'Next fight → Elite encounter'; },
    },
    {
        id: 'aether-prism',
        name: 'Aether Prism',
        desc: 'Catch starlight in a bottle. Your next post-fight offers all roll at grade III or higher.',
        recipe: { aether: [0, 1, 0, 0], starlight: [4, 0, 0, 0] },
        effect(game) { game.elementOfferFloor = 3; return 'Next offers ≥ grade III'; },
    },
    {
        id: 'moonstone-compass',
        name: 'Moonstone Compass',
        desc: 'A soft pale glow points further ahead. Marks the next two map branches on your sight.',
        recipe: { moonstone: [0, 2, 0, 0] },
        effect(game) { game.scoutAhead = (game.scoutAhead ?? 0) + 2; return '+2 branches scouted'; },
    },
    {
        id: 'bonework-charm',
        name: 'Bonework Charm',
        desc: 'Carved from a saint. Converts to a free recruit roll on the next map transition.',
        recipe: { bone: [0, 1, 0, 0], blood: [2, 0, 0, 0] },
        effect(game) { game.pendingRecruitRoll = true; return 'Next rest → free recruit'; },
    },
];

const BY_ID = new Map(POTIONS.map(p => [p.id, p]));

export function listPotionIds() { return POTIONS.map(p => p.id); }
export function allPotions() { return POTIONS.slice(); }
export function getPotion(id) { return BY_ID.get(id) ?? null; }

/** Does the stash's elements store contain every ingredient in the recipe? */
export function canCraftPotion(elementsStash, potionId) {
    const p = getPotion(potionId);
    if (!p) return false;
    for (const [elId, costs] of Object.entries(p.recipe)) {
        for (let g = 1; g <= GRADES.length; g++) {
            const need = costs[g - 1] ?? 0;
            if (need === 0) continue;
            if (stashCount(elementsStash, elId, g) < need) return false;
        }
    }
    return true;
}

/**
 * Consume ingredients from `elementsStash` and add one `potionId` to the
 * potion store. Returns true on success, false if any ingredient missing.
 */
export function craftPotion(elementsStash, potions, potionId) {
    if (!canCraftPotion(elementsStash, potionId)) return false;
    const p = getPotion(potionId);
    for (const [elId, costs] of Object.entries(p.recipe)) {
        for (let g = 1; g <= GRADES.length; g++) {
            const need = costs[g - 1] ?? 0;
            if (need > 0) takeFromStash(elementsStash, elId, g, need);
        }
    }
    potions[potionId] = (potions[potionId] ?? 0) + 1;
    return true;
}

/**
 * Consume one `potionId` from the potion store and apply its effect to `game`.
 * Returns an effect-descriptor string on success, null if none available.
 */
export function usePotion(potions, potionId, game) {
    const owned = potions[potionId] ?? 0;
    if (owned <= 0) return null;
    const p = getPotion(potionId);
    if (!p) return null;
    potions[potionId] = owned - 1;
    return p.effect(game);
}

/** Potions currently craftable from the given elements stash. */
export function craftablePotionIds(elementsStash) {
    return POTIONS.filter(p => canCraftPotion(elementsStash, p.id)).map(p => p.id);
}

// ----- meta-stash helpers (elements + potions bundle) -----

/** Empty meta-stash shape. */
export function emptyPotionStore() { return {}; }
