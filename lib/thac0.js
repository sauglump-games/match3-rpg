// THAC0 progression per AD&D 2e PHB, reproduced in rpg-fidelity-spec.md §2.1.
// Warrior-class (Fighter/Paladin/Ranger): -1/level.
// Priest-class (Cleric/Druid):             -2 every 3 levels.
// Rogue-class (Thief):                     -2 every 3 levels (offset).
// Wizard-class (Mage):                     -3 every 3 levels.
//
// Lower is better; a hero hits when `d20 + hitMods >= thac0 - targetAC`.

const WARRIOR_THAC0 = [20, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const PRIEST_THAC0  = [20, 20, 20, 20, 18, 18, 18, 16, 16, 16, 14, 14, 14, 12, 12, 12, 10, 10, 10, 8];
const ROGUE_THAC0   = [20, 20, 20, 19, 19, 18, 18, 17, 17, 16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11];
const WIZARD_THAC0  = [20, 20, 20, 20, 19, 19, 19, 18, 18, 18, 17, 17, 17, 16, 16, 16, 15, 15, 15, 14];

function tableForRole(role) {
    switch (role) {
        case 'warrior':
        case 'fighter':
        case 'paladin':
        case 'ranger':
            return WARRIOR_THAC0;
        case 'cleric':
        case 'druid':
            return PRIEST_THAC0;
        case 'rogue':
        case 'thief':
            return ROGUE_THAC0;
        case 'mage':
        case 'wizard':
        case 'summoner': // non-AD&D; treat as wizard-grade combat
            return WIZARD_THAC0;
        default:
            return WARRIOR_THAC0;
    }
}

/** THAC0 for a hero at the given class level (AD&D 2e PHB tables). */
export function thac0ForHero(role, level) {
    const table = tableForRole(role);
    const idx = Math.max(1, Math.min(level | 0, table.length - 1));
    return table[idx];
}

/**
 * Resolve a d20 attack roll. Returns:
 *   { hit: boolean, natural: number, need: number, total: number }
 *
 * AD&D conventions (rpg-fidelity-spec.md §3):
 *   - Natural 1 always misses.
 *   - Natural 20 always hits (no critical-damage doubling in EotB).
 *   - Otherwise: hit when `natural + hitMod >= need`, where
 *     `need = thac0 - targetAC` and `hitMod` is STR-hit (melee) or
 *     DEX-missile (ranged) plus any weapon/magic bonus.
 */
export function rollAttack({ thac0, targetAC, hitMod = 0, rng }) {
    const natural = 1 + Math.floor(rng() * 20);
    const need = thac0 - targetAC;
    const total = natural + hitMod;
    let hit;
    if (natural === 1) hit = false;
    else if (natural === 20) hit = true;
    else hit = total >= need;
    return { hit, natural, need, total };
}
