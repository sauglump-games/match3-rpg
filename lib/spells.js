// Spell registry. Per ADR 0002 and rpg-fidelity-spec.md §4.1, casting a
// spell requires BOTH an unspent slot of the spell's level AND sufficient
// accumulated color score. The slot check lives in combat.js; the score
// check lives in game.js (it reads scoreThisTurn). Spells below expose:
//
//   - spellLevel: AD&D spell-level gate into the caster's slot table
//   - scoreCost:  color-score cost to cast, deducted from scoreThisTurn[callerColor]
//   - cast(encounter, caster): applies the effect; returns events or null
//
// Save-vs-spell is handled per-spell in the `cast` function using the
// rollSave helper. Spec §4.5 save-vs-spell matrix:
//   - Fireball:    save-for-half (damage)
//   - Hold Person: save-negates  (no effect if saved)
//   - Magic Missile / Cure Wounds / Holy Bless / Lesser Restoration: no save

import { rollSave } from './saves.js';

export const SPELLS = {
    'magic-missile': {
        id: 'magic-missile',
        name: 'Magic Missile',
        caster: 'mage',
        spellLevel: 1,
        scoreCost: 5,
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
        spellLevel: 3,
        scoreCost: 10,
        minLevel: 3,
        saveCategory: 'spell',
        saveEffect: 'half',
        description: '14 fire damage to all enemies. Save vs. spell for half.',
        cast(encounter, caster) {
            const targets = encounter.aliveEnemies();
            if (targets.length === 0) return null;
            const events = [];
            const baseDmg = 14;
            for (const t of targets) {
                const save = rollSave(t, 'spell', encounter.rng);
                const damage = save.saved ? Math.floor(baseDmg / 2) : baseDmg;
                encounter.dealSpellDamage(t, damage, caster.role, 'sapphire', events, {
                    spell: 'Fireball', saved: save.saved,
                });
                events.push({
                    type: 'save', targetId: t.id, category: 'spell',
                    saved: save.saved, natural: save.natural, spell: 'Fireball',
                });
            }
            return events;
        },
    },
    'hold-person': {
        id: 'hold-person',
        name: 'Hold Person',
        caster: 'mage',
        spellLevel: 2,
        scoreCost: 6,
        minLevel: 2,
        saveCategory: 'spell',
        saveEffect: 'negates',
        description: 'Stun one enemy for 2 turns. Save vs. spell negates.',
        cast(encounter, caster) {
            const target = encounter.aliveEnemies()[0];
            if (!target) return null;
            const events = [];
            const save = rollSave(target, 'spell', encounter.rng);
            if (!save.saved) {
                encounter.applyStatus(target, { kind: 'stun', duration: 2 }, events, {
                    spell: 'Hold Person', sourceId: caster.id,
                });
            }
            events.push({
                type: 'save', targetId: target.id, category: 'spell',
                saved: save.saved, natural: save.natural, spell: 'Hold Person',
            });
            return events;
        },
    },
    'cure-wounds': {
        id: 'cure-wounds',
        name: 'Cure Wounds',
        caster: 'cleric',
        spellLevel: 1,
        scoreCost: 5,
        minLevel: 1,
        description: 'Heal the most-wounded ally for 14 HP.',
        cast(encounter, caster) {
            const allies = encounter.aliveParty();
            if (allies.length === 0) return null;
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
        spellLevel: 1,
        scoreCost: 6,
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
    'lesser-restoration': {
        id: 'lesser-restoration',
        name: 'Lesser Restoration',
        caster: 'cleric',
        spellLevel: 2,
        scoreCost: 4,
        minLevel: 1,
        description: 'Cleanse one harmful status from the most-statused ally.',
        cast(encounter, caster) {
            const allies = encounter.aliveParty();
            let target = null;
            let mostHarmful = 0;
            for (const a of allies) {
                const harmful = (a.statuses ?? []).filter(s => s.kind === 'poison' || s.kind === 'stun' || s.kind === 'curse').length;
                if (harmful > mostHarmful) { target = a; mostHarmful = harmful; }
            }
            if (!target) return null;
            const removed = encounter.cleanseStatuses(target, { count: 1 });
            if (removed.length === 0) return null;
            return [{
                type: 'status-cleansed',
                source: caster.role,
                targetId: target.id,
                kinds: removed,
                spell: 'Lesser Restoration',
            }];
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

/** Color that fuels a caster's spells (via scoreThisTurn[color]). */
const CASTER_COLOR = {
    mage: 'sapphire',
    cleric: 'diamond',
    druid: 'emerald',
    paladin: 'topaz',
    ranger: 'topaz',
};

export function casterColor(role) {
    return CASTER_COLOR[role] ?? null;
}
