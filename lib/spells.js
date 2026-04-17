// Spell registry. Each spell's `cast(encounter, caster)` returns an array of
// combat events for the log/floats, or null if the cast couldn't resolve
// (no valid target).
//
// Spells are role-keyed: mage spells belong to the mage slot, cleric to the
// cleric slot, etc. A hero sees spells whose `caster` matches their role AND
// whose `minLevel` they meet.

export const SPELLS = {
    'magic-missile': {
        id: 'magic-missile',
        name: 'Magic Missile',
        caster: 'mage',
        cost: 5,
        minLevel: 1,
        description: '12 force damage to one enemy. Autohit.',
        cast(encounter, caster) {
            const target = encounter.aliveEnemies()[0];
            if (!target) return null;
            const events = [];
            encounter.dealSpellDamage(target, 12, caster.role, 'sapphire', events, { spell: 'Magic Missile' });
            return events;
        },
    },
    'fireball': {
        id: 'fireball',
        name: 'Fireball',
        caster: 'mage',
        cost: 10,
        minLevel: 3,
        description: '14 fire damage to all enemies.',
        cast(encounter, caster) {
            const targets = encounter.aliveEnemies();
            if (targets.length === 0) return null;
            const events = [];
            for (const t of targets) {
                encounter.dealSpellDamage(t, 14, caster.role, 'sapphire', events, { spell: 'Fireball' });
            }
            return events;
        },
    },
    'cure-wounds': {
        id: 'cure-wounds',
        name: 'Cure Wounds',
        caster: 'cleric',
        cost: 5,
        minLevel: 1,
        description: 'Heal the most-wounded ally for 14 HP.',
        cast(encounter, caster) {
            const allies = encounter.aliveParty();
            if (allies.length === 0) return null;
            // most-wounded = lowest hp/maxHp ratio
            let target = allies[0];
            for (const a of allies) {
                if ((a.maxHp - a.hp) > (target.maxHp - target.hp)) target = a;
            }
            const events = [];
            encounter.applyHeal(target, 14, caster.role, events, { spell: 'Cure Wounds' });
            return events;
        },
    },
    'holy-bless': {
        id: 'holy-bless',
        name: 'Holy Bless',
        caster: 'cleric',
        cost: 6,
        minLevel: 1,
        description: '+5 shield to every ally.',
        cast(encounter, caster) {
            const events = [];
            for (const m of encounter.aliveParty()) {
                encounter.applyShield(m, 5, caster.role, events, { spell: 'Holy Bless' });
            }
            return events;
        },
    },
};

/** Spells the hero knows at their current level (by role + minLevel). */
export function spellsForHero(hero) {
    return Object.values(SPELLS).filter(s => s.caster === hero.role && hero.level >= s.minLevel);
}

export function getSpell(id) {
    return SPELLS[id] ?? null;
}
