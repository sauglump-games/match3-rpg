// Item registry. Each item has:
//   id, name, slot, rarity, classes (who may equip),
//   bonuses { damageBonus, armorBonus, maxHpBonus, bonusSpellSlots: { 1: n, 2: n, … } }
//
// Prior versions stored maxManaBonus; that system was removed in Phase 2 of
// the rpg-fidelity plan. Items that used to grant mana now grant prepared
// spell slots at specific AD&D spell levels (rpg-fidelity-spec.md §4).
//
// Slots: weapon, armor, shield, accessory (one item per slot per hero).
// Class restrictions follow EotB conventions:
//   - mages: dagger / staff / dart only; no armor heavier than robes; no shield
//   - clerics: blunt weapons only (mace, flail, staff); any armor; any shield
//   - warriors / paladins: any weapon, any armor, any shield
//   - rogues: light weapons (dagger, short sword); leather only; no heavy shield
//   - druids/rangers: any non-metal armor; staves / clubs / scimitars / slings

export const SLOTS = ['weapon', 'armor', 'shield', 'accessory'];
export const RARITIES = ['common', 'uncommon', 'rare'];

const ALL_CLASSES = ['warrior', 'cleric', 'mage', 'rogue', 'druid', 'paladin'];
const MARTIAL = ['warrior', 'paladin', 'rogue'];
const FAITHFUL = ['cleric', 'paladin'];

export const ITEMS = {
    // ----- weapons -----
    'dagger': {
        id: 'dagger', name: 'Dagger', slot: 'weapon', rarity: 'common',
        classes: ALL_CLASSES,
        bonuses: { damageBonus: 1 },
        description: '+1 damage. Anyone may wield it.',
    },
    'longsword': {
        id: 'longsword', name: 'Longsword', slot: 'weapon', rarity: 'common',
        classes: [...MARTIAL],
        bonuses: { damageBonus: 2 },
        description: '+2 damage. For warriors, paladins, rogues.',
    },
    'longsword-plus-1': {
        id: 'longsword-plus-1', name: 'Longsword +1', slot: 'weapon', rarity: 'uncommon',
        classes: [...MARTIAL],
        bonuses: { damageBonus: 3 },
        description: '+3 damage. Magical weapon.',
    },
    'mace': {
        id: 'mace', name: 'Mace', slot: 'weapon', rarity: 'common',
        classes: [...new Set([...MARTIAL, ...FAITHFUL])],
        bonuses: { damageBonus: 2 },
        description: '+2 damage. Blunt — clerics may wield it.',
    },
    'quarterstaff': {
        id: 'quarterstaff', name: 'Quarterstaff', slot: 'weapon', rarity: 'common',
        classes: ['mage', 'cleric', 'druid'],
        bonuses: { damageBonus: 1 },
        description: '+1 damage. For mages, clerics, druids.',
    },
    // ----- armor -----
    'leather-armor': {
        id: 'leather-armor', name: 'Leather Armor', slot: 'armor', rarity: 'common',
        classes: ALL_CLASSES.filter(c => c !== 'mage'),
        bonuses: { armorBonus: 1 },
        description: '+1 armor. Anyone but mages.',
    },
    'plate-mail': {
        id: 'plate-mail', name: 'Plate Mail', slot: 'armor', rarity: 'uncommon',
        classes: ['warrior', 'paladin', 'cleric'],
        bonuses: { armorBonus: 5 },
        description: '+5 armor. Warriors, paladins, clerics only.',
    },
    'mage-robe': {
        id: 'mage-robe', name: 'Mage Robe', slot: 'armor', rarity: 'common',
        classes: ['mage'],
        bonuses: { armorBonus: 1, bonusSpellSlots: { 1: 1 } },
        description: '+1 armor, +1 L1 spell slot. Mages only.',
    },
    // ----- shields -----
    'buckler': {
        id: 'buckler', name: 'Buckler', slot: 'shield', rarity: 'common',
        classes: [...MARTIAL, 'cleric', 'druid'],
        bonuses: { armorBonus: 1 },
        description: '+1 armor. Light shield.',
    },
    'tower-shield': {
        id: 'tower-shield', name: 'Tower Shield', slot: 'shield', rarity: 'uncommon',
        classes: ['warrior', 'paladin', 'cleric'],
        bonuses: { armorBonus: 3 },
        description: '+3 armor. Warriors, paladins, clerics only.',
    },
    // ----- accessories -----
    'ring-of-vitality': {
        id: 'ring-of-vitality', name: 'Ring of Vitality', slot: 'accessory', rarity: 'uncommon',
        classes: ALL_CLASSES,
        bonuses: { maxHpBonus: 6 },
        description: '+6 max HP. Anyone may wear it.',
    },
    'amulet-of-the-adept': {
        id: 'amulet-of-the-adept', name: 'Amulet of the Adept', slot: 'accessory', rarity: 'rare',
        classes: ['mage', 'cleric', 'druid'],
        bonuses: { bonusSpellSlots: { 1: 1, 2: 1 } },
        description: '+1 L1 and +1 L2 spell slot. Casters only.',
    },
    'boots-of-valor': {
        id: 'boots-of-valor', name: 'Boots of Valor', slot: 'accessory', rarity: 'uncommon',
        classes: ALL_CLASSES,
        bonuses: { damageBonus: 1, armorBonus: 1 },
        description: '+1 damage, +1 armor.',
    },

    // ===========================================================
    // === Expansion: D&D-flavored magic items ==================
    // ===========================================================

    // ---------- weapons ----------
    'shortbow-plus-1': {
        id: 'shortbow-plus-1', name: 'Shortbow +1', slot: 'weapon', rarity: 'uncommon',
        classes: ['rogue', 'ranger'],
        bonuses: { damageBonus: 3 },
        description: '+3 damage. Quick and accurate.',
    },
    'warhammer': {
        id: 'warhammer', name: 'Warhammer', slot: 'weapon', rarity: 'common',
        classes: ['warrior', 'paladin', 'cleric'],
        bonuses: { damageBonus: 2 },
        description: '+2 damage. Blunt — clerics may wield it.',
    },
    'sword-of-vengeance': {
        id: 'sword-of-vengeance', name: 'Sword of Vengeance', slot: 'weapon', rarity: 'rare',
        classes: ['warrior', 'paladin'],
        bonuses: { damageBonus: 4 },
        description: '+4 damage. Demands a price the wielder rarely sees coming.',
    },
    'wand-of-magic-missiles': {
        id: 'wand-of-magic-missiles', name: 'Wand of Magic Missiles', slot: 'weapon', rarity: 'uncommon',
        classes: ['mage'],
        bonuses: { damageBonus: 3, bonusSpellSlots: { 1: 1 } },
        description: '+3 damage, +1 L1 spell slot. Mage focus.',
    },
    'sun-blade': {
        id: 'sun-blade', name: 'Sun Blade', slot: 'weapon', rarity: 'rare',
        classes: ['warrior', 'paladin'],
        bonuses: { damageBonus: 5 },
        description: '+5 damage. A radiant blade that scorches the dark.',
    },

    // ---------- armor ----------
    'studded-leather': {
        id: 'studded-leather', name: 'Studded Leather', slot: 'armor', rarity: 'common',
        classes: [...MARTIAL, 'cleric', 'druid'],
        bonuses: { armorBonus: 2 },
        description: '+2 armor. Light enough for rogues.',
    },
    'half-plate': {
        id: 'half-plate', name: 'Half Plate', slot: 'armor', rarity: 'uncommon',
        classes: ['warrior', 'paladin', 'cleric'],
        bonuses: { armorBonus: 4 },
        description: '+4 armor. Heavy but flexible.',
    },
    'mage-armor': {
        id: 'mage-armor', name: 'Mage Armor', slot: 'armor', rarity: 'uncommon',
        classes: ['mage'],
        bonuses: { armorBonus: 2, bonusSpellSlots: { 1: 1, 2: 1 } },
        description: '+2 armor, +1 L1 and +1 L2 spell slot. Spell-woven shielding.',
    },
    'adamantine-mail': {
        id: 'adamantine-mail', name: 'Adamantine Mail', slot: 'armor', rarity: 'rare',
        classes: ['warrior', 'paladin', 'cleric'],
        bonuses: { armorBonus: 6 },
        description: '+6 armor. The metal that even dragons respect.',
    },
    'robe-of-stars': {
        id: 'robe-of-stars', name: 'Robe of Stars', slot: 'armor', rarity: 'rare',
        classes: ['mage'],
        bonuses: { armorBonus: 2, bonusSpellSlots: { 2: 1, 3: 1 } },
        description: '+2 armor, +1 L2 and +1 L3 spell slot. Stars wheel across the cloth.',
    },

    // ---------- shields ----------
    'shield-plus-1': {
        id: 'shield-plus-1', name: 'Shield +1', slot: 'shield', rarity: 'uncommon',
        classes: [...MARTIAL, 'cleric', 'druid'],
        bonuses: { armorBonus: 2 },
        description: '+2 armor. Magical reinforcement.',
    },
    'spellguard-shield': {
        id: 'spellguard-shield', name: 'Spellguard Shield', slot: 'shield', rarity: 'rare',
        classes: ['warrior', 'paladin', 'cleric'],
        bonuses: { armorBonus: 3, bonusSpellSlots: { 1: 1 } },
        description: '+3 armor, +1 L1 spell slot. Wards off both spell and steel.',
    },

    // ---------- accessories ----------
    'cloak-of-elvenkind': {
        id: 'cloak-of-elvenkind', name: 'Cloak of Elvenkind', slot: 'accessory', rarity: 'uncommon',
        classes: ['rogue', 'ranger'],
        bonuses: { damageBonus: 1, armorBonus: 2 },
        description: '+1 damage, +2 armor. Shadows fall around the wearer.',
    },
    'cloak-of-protection': {
        id: 'cloak-of-protection', name: 'Cloak of Protection', slot: 'accessory', rarity: 'uncommon',
        classes: ALL_CLASSES,
        bonuses: { armorBonus: 1, maxHpBonus: 4 },
        description: '+1 armor, +4 max HP. A bishop\'s blessing in a cloak.',
    },
    'ring-of-protection': {
        id: 'ring-of-protection', name: 'Ring of Protection', slot: 'accessory', rarity: 'uncommon',
        classes: ALL_CLASSES,
        bonuses: { armorBonus: 2 },
        description: '+2 armor. A simple band that turns blades aside.',
    },
    'belt-of-hill-giant-strength': {
        id: 'belt-of-hill-giant-strength', name: 'Belt of Hill Giant Strength', slot: 'accessory', rarity: 'rare',
        classes: ['warrior', 'paladin'],
        bonuses: { damageBonus: 3, maxHpBonus: 4 },
        description: '+3 damage, +4 max HP. The strength of mountains.',
    },
    'headband-of-intellect': {
        id: 'headband-of-intellect', name: 'Headband of Intellect', slot: 'accessory', rarity: 'rare',
        classes: ['mage', 'cleric', 'druid'],
        bonuses: { bonusSpellSlots: { 2: 1, 3: 1 } },
        description: '+1 L2 and +1 L3 spell slot. The wearer\'s thoughts run clearer.',
    },
    'bracers-of-defense': {
        id: 'bracers-of-defense', name: 'Bracers of Defense', slot: 'accessory', rarity: 'uncommon',
        classes: [...MARTIAL, 'druid'],
        bonuses: { armorBonus: 2 },
        description: '+2 armor. Light forearm guards woven with magic.',
    },
    'periapt-of-wound-closure': {
        id: 'periapt-of-wound-closure', name: 'Periapt of Wound Closure', slot: 'accessory', rarity: 'uncommon',
        classes: ALL_CLASSES,
        bonuses: { maxHpBonus: 8 },
        description: '+8 max HP. Wounds knit themselves overnight.',
    },
};

export function getItem(id) {
    return ITEMS[id] ?? null;
}

export function listItemIds() {
    return Object.keys(ITEMS);
}

/** Items keyed by rarity tier. Used for loot rolls. */
export function itemsByRarity(rarity) {
    return Object.values(ITEMS).filter(i => i.rarity === rarity);
}

export function canEquip(hero, item) {
    if (!hero || !item) return false;
    if (!SLOTS.includes(item.slot)) return false;
    if (!item.classes.includes(hero.role)) return false;
    return true;
}

/** Sum a numeric bonus across a hero's equipped items. */
export function equipmentBonus(hero, key) {
    let total = 0;
    for (const slot of SLOTS) {
        const item = hero.equipment?.[slot];
        if (!item) continue;
        total += item.bonuses?.[key] ?? 0;
    }
    return total;
}

/**
 * Aggregate bonusSpellSlots across the hero's equipped items. Returns a plain
 * object keyed by spell level (1..9) with the total extra slots the equipment
 * contributes. Empty object when nothing relevant is equipped.
 */
export function equipmentSpellSlotBonus(hero) {
    const out = {};
    for (const slot of SLOTS) {
        const item = hero.equipment?.[slot];
        if (!item) continue;
        const bonus = item.bonuses?.bonusSpellSlots;
        if (!bonus) continue;
        for (const [lvl, n] of Object.entries(bonus)) {
            if (n > 0) out[lvl] = (out[lvl] ?? 0) + n;
        }
    }
    return out;
}
