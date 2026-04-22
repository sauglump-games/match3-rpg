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
// rollSave helper. Phase 6 expands the list to cover the canonical
// EotB/AD&D 2e spells (spec §4.4) through mage L5 / cleric L5 / paladin L2.
// Spells reference AD&D 2e damage dice (Magic Missile 1d4+1/missile,
// Cure Light Wounds 1d8, Fireball 1d6/level max 10d6, etc.) — see §7 for
// the score-cost mapping.

import { rollSave } from './saves.js';
import { rollResurrectionSurvival, intLearnPct } from './abilities.js';

// ---------------------------------------------------------------------------
// Dice helper. Each caller passes the encounter's RNG so damage is seeded
// with the save-file stream. `bonus` is a flat add (e.g., 1d4+1 Magic
// Missile, 3d8+3 Cure Critical Wounds).
// ---------------------------------------------------------------------------
function rollDice(n, sides, rng, bonus = 0) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += 1 + Math.floor(rng() * sides);
    return sum + bonus;
}

// Estimate HD from maxHp at a d8 average — mirrors the default-saves
// heuristic in saves.js. Used by Sleep's HD-cap rule.
function estimateHD(enemy) {
    return Math.max(1, Math.round((enemy.maxHp ?? 1) / 8));
}

// ---------------------------------------------------------------------------
// Mage spells
// ---------------------------------------------------------------------------

const MAGE_SPELLS = {
    'magic-missile': {
        id: 'magic-missile',
        name: 'Magic Missile',
        caster: 'mage',
        spellLevel: 1,
        scoreCost: 5,
        minLevel: 1,
        description: '1d4+1 force damage per missile (+1 missile every 2 caster levels). Autohit, no save.',
        cast(encounter, caster) {
            const target = encounter.aliveEnemies()[0];
            if (!target) return null;
            const missiles = 1 + Math.floor(Math.max(0, caster.level - 1) / 2);
            const events = [];
            let total = 0;
            for (let i = 0; i < missiles; i++) total += rollDice(1, 4, encounter.rng, 1);
            encounter.dealSpellDamage(target, total, caster.role, 'sapphire', events, {
                spell: 'Magic Missile', missiles,
            });
            return events;
        },
    },

    'sleep': {
        id: 'sleep',
        name: 'Sleep',
        caster: 'mage',
        spellLevel: 1,
        scoreCost: 6,
        minLevel: 1,
        saveCategory: 'spell',
        saveEffect: 'negates',
        description: 'Puts foes to sleep. Creatures 4 HD or less succumb automatically; 5+ HD save vs. spell.',
        cast(encounter, caster) {
            const targets = encounter.aliveEnemies();
            if (targets.length === 0) return null;
            const events = [];
            for (const t of targets) {
                const hd = estimateHD(t);
                if (hd <= 4) {
                    encounter.applyStatus(t, { kind: 'stun', duration: 3 }, events, {
                        spell: 'Sleep', sourceId: caster.id,
                    });
                } else {
                    const save = rollSave(t, 'spell', encounter.rng);
                    if (!save.saved) {
                        encounter.applyStatus(t, { kind: 'stun', duration: 2 }, events, {
                            spell: 'Sleep', sourceId: caster.id,
                        });
                    }
                    events.push({
                        type: 'save', targetId: t.id, category: 'spell',
                        saved: save.saved, natural: save.natural, spell: 'Sleep',
                    });
                }
            }
            return events;
        },
    },

    'shocking-grasp': {
        id: 'shocking-grasp',
        name: 'Shocking Grasp',
        caster: 'mage',
        spellLevel: 1,
        scoreCost: 5,
        minLevel: 1,
        description: '1d8 + caster-level lightning damage to one enemy (touch-delivered, autohit).',
        cast(encounter, caster) {
            const target = encounter.aliveEnemies()[0];
            if (!target) return null;
            const dmg = rollDice(1, 8, encounter.rng, caster.level);
            const events = [];
            encounter.dealSpellDamage(target, dmg, caster.role, 'sapphire', events, {
                spell: 'Shocking Grasp',
            });
            return events;
        },
    },

    'web': {
        id: 'web',
        name: 'Web',
        caster: 'mage',
        spellLevel: 2,
        scoreCost: 7,
        minLevel: 2,
        saveCategory: 'spell',
        saveEffect: 'negates',
        description: 'Tangles every enemy in sticky webs — stun 3 turns. Save vs. spell negates.',
        cast(encounter, caster) {
            const targets = encounter.aliveEnemies();
            if (targets.length === 0) return null;
            const events = [];
            for (const t of targets) {
                const save = rollSave(t, 'spell', encounter.rng);
                if (!save.saved) {
                    encounter.applyStatus(t, { kind: 'stun', duration: 3 }, events, {
                        spell: 'Web', sourceId: caster.id,
                    });
                }
                events.push({
                    type: 'save', targetId: t.id, category: 'spell',
                    saved: save.saved, natural: save.natural, spell: 'Web',
                });
            }
            return events;
        },
    },

    'stinking-cloud': {
        id: 'stinking-cloud',
        name: 'Stinking Cloud',
        caster: 'mage',
        spellLevel: 2,
        scoreCost: 7,
        minLevel: 2,
        saveCategory: 'spell',
        saveEffect: 'negates',
        description: 'A reeking fog poisons every enemy (DoT 3 turns). Save vs. spell negates.',
        cast(encounter, caster) {
            const targets = encounter.aliveEnemies();
            if (targets.length === 0) return null;
            const events = [];
            for (const t of targets) {
                const save = rollSave(t, 'spell', encounter.rng);
                if (!save.saved) {
                    encounter.applyStatus(t, { kind: 'poison', duration: 3, severity: 3 }, events, {
                        spell: 'Stinking Cloud', sourceId: caster.id,
                    });
                }
                events.push({
                    type: 'save', targetId: t.id, category: 'spell',
                    saved: save.saved, natural: save.natural, spell: 'Stinking Cloud',
                });
            }
            return events;
        },
    },

    'melf-acid-arrow': {
        id: 'melf-acid-arrow',
        name: "Melf's Acid Arrow",
        caster: 'mage',
        spellLevel: 2,
        scoreCost: 6,
        minLevel: 2,
        description: '2d4 acid damage plus a lingering poison (severity 2, 2 turns). Autohit, no save.',
        cast(encounter, caster) {
            const target = encounter.aliveEnemies()[0];
            if (!target) return null;
            const dmg = rollDice(2, 4, encounter.rng);
            const events = [];
            encounter.dealSpellDamage(target, dmg, caster.role, 'sapphire', events, {
                spell: "Melf's Acid Arrow",
            });
            if (target.alive) {
                encounter.applyStatus(target, { kind: 'poison', duration: 2, severity: 2 }, events, {
                    spell: "Melf's Acid Arrow", sourceId: caster.id,
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
        description: 'Paralyze one enemy for 2 turns. Save vs. spell negates.',
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

    'fireball': {
        id: 'fireball',
        name: 'Fireball',
        caster: 'mage',
        spellLevel: 3,
        scoreCost: 10,
        minLevel: 3,
        saveCategory: 'spell',
        saveEffect: 'half',
        description: '1d6/level fire damage (max 10d6) to every enemy. Save vs. spell halves.',
        cast(encounter, caster) {
            const targets = encounter.aliveEnemies();
            if (targets.length === 0) return null;
            const dice = Math.min(10, Math.max(1, caster.level | 0));
            const events = [];
            // AD&D: each target in the area rolls its own save; damage itself
            // is rolled once and shared. Save first so the rng sequence in
            // tests stays readable: saves, then dice.
            const saves = targets.map(t => rollSave(t, 'spell', encounter.rng));
            const base = rollDice(dice, 6, encounter.rng);
            for (let i = 0; i < targets.length; i++) {
                const t = targets[i];
                const save = saves[i];
                const damage = save.saved ? Math.floor(base / 2) : base;
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

    'lightning-bolt': {
        id: 'lightning-bolt',
        name: 'Lightning Bolt',
        caster: 'mage',
        spellLevel: 3,
        scoreCost: 10,
        minLevel: 3,
        saveCategory: 'spell',
        saveEffect: 'half',
        description: '1d6/level lightning damage (max 10d6) to one enemy. Save vs. spell halves.',
        cast(encounter, caster) {
            const target = encounter.aliveEnemies()[0];
            if (!target) return null;
            const dice = Math.min(10, Math.max(1, caster.level | 0));
            const events = [];
            const save = rollSave(target, 'spell', encounter.rng);
            const base = rollDice(dice, 6, encounter.rng);
            const damage = save.saved ? Math.floor(base / 2) : base;
            encounter.dealSpellDamage(target, damage, caster.role, 'sapphire', events, {
                spell: 'Lightning Bolt', saved: save.saved,
            });
            events.push({
                type: 'save', targetId: target.id, category: 'spell',
                saved: save.saved, natural: save.natural, spell: 'Lightning Bolt',
            });
            return events;
        },
    },

    'haste': {
        id: 'haste',
        name: 'Haste',
        caster: 'mage',
        spellLevel: 3,
        scoreCost: 9,
        minLevel: 3,
        description: 'Quickens every ally — +25% outgoing damage (bless) for 3 turns.',
        cast(encounter, caster) {
            const allies = encounter.aliveParty();
            if (allies.length === 0) return null;
            const events = [];
            for (const m of allies) {
                encounter.applyStatus(m, { kind: 'bless', duration: 3 }, events, {
                    spell: 'Haste', sourceId: caster.id,
                });
            }
            return events;
        },
    },

    'slow': {
        id: 'slow',
        name: 'Slow',
        caster: 'mage',
        spellLevel: 3,
        scoreCost: 8,
        minLevel: 3,
        saveCategory: 'spell',
        saveEffect: 'negates',
        description: 'Bogs down every enemy — curse (−25% damage) for 3 turns. Save vs. spell negates.',
        cast(encounter, caster) {
            const targets = encounter.aliveEnemies();
            if (targets.length === 0) return null;
            const events = [];
            for (const t of targets) {
                const save = rollSave(t, 'spell', encounter.rng);
                if (!save.saved) {
                    encounter.applyStatus(t, { kind: 'curse', duration: 3 }, events, {
                        spell: 'Slow', sourceId: caster.id,
                    });
                }
                events.push({
                    type: 'save', targetId: t.id, category: 'spell',
                    saved: save.saved, natural: save.natural, spell: 'Slow',
                });
            }
            return events;
        },
    },

    'ice-storm': {
        id: 'ice-storm',
        name: 'Ice Storm',
        caster: 'mage',
        spellLevel: 4,
        scoreCost: 12,
        minLevel: 4,
        description: 'Pounds every enemy with hail: 3d10 cold damage. Autohit, no save.',
        cast(encounter, caster) {
            const targets = encounter.aliveEnemies();
            if (targets.length === 0) return null;
            const events = [];
            for (const t of targets) {
                const dmg = rollDice(3, 10, encounter.rng);
                encounter.dealSpellDamage(t, dmg, caster.role, 'sapphire', events, {
                    spell: 'Ice Storm',
                });
            }
            return events;
        },
    },

    'cone-of-cold': {
        id: 'cone-of-cold',
        name: 'Cone of Cold',
        caster: 'mage',
        spellLevel: 5,
        scoreCost: 14,
        minLevel: 5,
        saveCategory: 'spell',
        saveEffect: 'half',
        description: '(1d4+1)/level cold damage to every enemy (max 10). Save vs. spell halves.',
        cast(encounter, caster) {
            const targets = encounter.aliveEnemies();
            if (targets.length === 0) return null;
            const dice = Math.min(10, Math.max(1, caster.level | 0));
            const events = [];
            const saves = targets.map(t => rollSave(t, 'spell', encounter.rng));
            const base = rollDice(dice, 4, encounter.rng, dice);
            for (let i = 0; i < targets.length; i++) {
                const t = targets[i];
                const save = saves[i];
                const damage = save.saved ? Math.floor(base / 2) : base;
                encounter.dealSpellDamage(t, damage, caster.role, 'sapphire', events, {
                    spell: 'Cone of Cold', saved: save.saved,
                });
                events.push({
                    type: 'save', targetId: t.id, category: 'spell',
                    saved: save.saved, natural: save.natural, spell: 'Cone of Cold',
                });
            }
            return events;
        },
    },
};

// ---------------------------------------------------------------------------
// Cleric spells
// ---------------------------------------------------------------------------

// Reusable: pick the most-wounded ally (by absolute HP gap). Returns null if
// the party is dead. Used by cure-* spells.
function mostWoundedAlly(encounter) {
    const allies = encounter.aliveParty();
    if (allies.length === 0) return null;
    let target = allies[0];
    for (const a of allies) {
        if ((a.maxHp - a.hp) > (target.maxHp - target.hp)) target = a;
    }
    return target;
}

const CLERIC_SPELLS = {
    'cure-wounds': {
        id: 'cure-wounds',
        name: 'Cure Light Wounds',
        caster: 'cleric',
        spellLevel: 1,
        scoreCost: 5,
        minLevel: 1,
        description: 'Heal the most-wounded ally for 1d8 HP.',
        cast(encounter, caster) {
            const target = mostWoundedAlly(encounter);
            if (!target) return null;
            const heal = rollDice(1, 8, encounter.rng);
            const events = [];
            encounter.applyHeal(target, heal, caster.role, events, { spell: 'Cure Light Wounds' });
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
        description: '+5 shield to every ally (house variant of AD&D 2e Bless — see spec §7).',
        cast(encounter, caster) {
            const events = [];
            for (const m of encounter.aliveParty()) {
                encounter.applyShield(m, 5, caster.role, events, { spell: 'Holy Bless' });
            }
            return events;
        },
    },

    'protection-from-evil': {
        id: 'protection-from-evil',
        name: 'Protection from Evil',
        caster: 'cleric',
        spellLevel: 1,
        scoreCost: 5,
        minLevel: 1,
        description: 'Grant +4 shield to every ally.',
        cast(encounter, caster) {
            const events = [];
            for (const m of encounter.aliveParty()) {
                encounter.applyShield(m, 4, caster.role, events, { spell: 'Protection from Evil' });
            }
            return events;
        },
    },

    'hold-person-cleric': {
        id: 'hold-person-cleric',
        name: 'Hold Person (Divine)',
        caster: 'cleric',
        spellLevel: 2,
        scoreCost: 6,
        minLevel: 3,
        saveCategory: 'spell',
        saveEffect: 'negates',
        description: 'Paralyze one enemy for 3 turns. Save vs. spell negates.',
        cast(encounter, caster) {
            const target = encounter.aliveEnemies()[0];
            if (!target) return null;
            const events = [];
            const save = rollSave(target, 'spell', encounter.rng);
            if (!save.saved) {
                encounter.applyStatus(target, { kind: 'stun', duration: 3 }, events, {
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

    'slow-poison': {
        id: 'slow-poison',
        name: 'Slow Poison',
        caster: 'cleric',
        spellLevel: 2,
        scoreCost: 4,
        minLevel: 3,
        description: 'Cleanse the poison status from the most-poisoned ally.',
        cast(encounter, caster) {
            const allies = encounter.aliveParty();
            let target = null;
            let bestSev = 0;
            for (const a of allies) {
                const p = (a.statuses ?? []).find(s => s.kind === 'poison');
                if (p && (p.severity ?? 0) > bestSev) { target = a; bestSev = p.severity ?? 0; }
            }
            if (!target) return null;
            const remaining = (target.statuses ?? []).filter(s => s.kind !== 'poison');
            target.statuses = remaining;
            return [{
                type: 'status-cleansed',
                source: caster.role,
                targetId: target.id,
                kinds: ['poison'],
                spell: 'Slow Poison',
            }];
        },
    },

    'aid': {
        id: 'aid',
        name: 'Aid',
        caster: 'cleric',
        spellLevel: 2,
        scoreCost: 7,
        minLevel: 3,
        description: 'Heal one ally 1d8 HP and grant them bless (+25% dmg) for 3 turns.',
        cast(encounter, caster) {
            const target = mostWoundedAlly(encounter);
            if (!target) return null;
            const heal = rollDice(1, 8, encounter.rng);
            const events = [];
            encounter.applyHeal(target, heal, caster.role, events, { spell: 'Aid' });
            encounter.applyStatus(target, { kind: 'bless', duration: 3 }, events, {
                spell: 'Aid', sourceId: caster.id,
            });
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

    'prayer': {
        id: 'prayer',
        name: 'Prayer',
        caster: 'cleric',
        spellLevel: 3,
        scoreCost: 9,
        minLevel: 5,
        description: 'Bless every ally and curse every enemy for 3 turns.',
        cast(encounter, caster) {
            const events = [];
            for (const m of encounter.aliveParty()) {
                encounter.applyStatus(m, { kind: 'bless', duration: 3 }, events, {
                    spell: 'Prayer', sourceId: caster.id,
                });
            }
            for (const e of encounter.aliveEnemies()) {
                encounter.applyStatus(e, { kind: 'curse', duration: 3 }, events, {
                    spell: 'Prayer', sourceId: caster.id,
                });
            }
            return events;
        },
    },

    'remove-curse': {
        id: 'remove-curse',
        name: 'Remove Curse',
        caster: 'cleric',
        spellLevel: 3,
        scoreCost: 7,
        minLevel: 5,
        description: 'Strip the curse status from every ally.',
        cast(encounter, caster) {
            const events = [];
            let anyCleansed = false;
            for (const a of encounter.aliveParty()) {
                const before = (a.statuses ?? []).length;
                a.statuses = (a.statuses ?? []).filter(s => s.kind !== 'curse');
                if ((a.statuses.length) < before) {
                    events.push({
                        type: 'status-cleansed',
                        source: caster.role,
                        targetId: a.id,
                        kinds: ['curse'],
                        spell: 'Remove Curse',
                    });
                    anyCleansed = true;
                }
            }
            return anyCleansed ? events : null;
        },
    },

    'cure-serious-wounds': {
        id: 'cure-serious-wounds',
        name: 'Cure Serious Wounds',
        caster: 'cleric',
        spellLevel: 4,
        scoreCost: 12,
        minLevel: 7,
        description: 'Heal the most-wounded ally for 2d8+1 HP.',
        cast(encounter, caster) {
            const target = mostWoundedAlly(encounter);
            if (!target) return null;
            const heal = rollDice(2, 8, encounter.rng, 1);
            const events = [];
            encounter.applyHeal(target, heal, caster.role, events, { spell: 'Cure Serious Wounds' });
            return events;
        },
    },

    'neutralize-poison': {
        id: 'neutralize-poison',
        name: 'Neutralize Poison',
        caster: 'cleric',
        spellLevel: 4,
        scoreCost: 9,
        minLevel: 7,
        description: 'Cleanse poison from every ally.',
        cast(encounter, caster) {
            const events = [];
            let anyCleansed = false;
            for (const a of encounter.aliveParty()) {
                const before = (a.statuses ?? []).length;
                a.statuses = (a.statuses ?? []).filter(s => s.kind !== 'poison');
                if ((a.statuses.length) < before) {
                    events.push({
                        type: 'status-cleansed',
                        source: caster.role,
                        targetId: a.id,
                        kinds: ['poison'],
                        spell: 'Neutralize Poison',
                    });
                    anyCleansed = true;
                }
            }
            return anyCleansed ? events : null;
        },
    },

    'cure-critical-wounds': {
        id: 'cure-critical-wounds',
        name: 'Cure Critical Wounds',
        caster: 'cleric',
        spellLevel: 5,
        scoreCost: 14,
        minLevel: 9,
        description: 'Heal the most-wounded ally for 3d8+3 HP.',
        cast(encounter, caster) {
            const target = mostWoundedAlly(encounter);
            if (!target) return null;
            const heal = rollDice(3, 8, encounter.rng, 3);
            const events = [];
            encounter.applyHeal(target, heal, caster.role, events, { spell: 'Cure Critical Wounds' });
            return events;
        },
    },

    'raise-dead': {
        id: 'raise-dead',
        name: 'Raise Dead',
        caster: 'cleric',
        spellLevel: 5,
        scoreCost: 14,
        minLevel: 9,
        description: 'Revive a fallen ally at 1 HP. CON-loss −1, system-shock gate; elves cannot be raised.',
        cast(encounter, caster) {
            // First slain non-elf party member.
            const target = encounter.party.find(p => !p.alive && p.race !== 'elf');
            if (!target) {
                const blockedByElf = encounter.party.find(p => !p.alive && p.race === 'elf');
                if (blockedByElf) {
                    return [{
                        type: 'raise-dead-refused',
                        sourceId: caster.id,
                        targetId: blockedByElf.id,
                        reason: 'elves-cannot',
                    }];
                }
                return null;
            }
            const con = target.abilities?.con ?? 11;
            const shock = rollResurrectionSurvival(con, encounter.rng);
            const events = [{
                type: 'raise-dead-attempt',
                sourceId: caster.id,
                targetId: target.id,
                roll: shock.roll,
                target: shock.target,
                survived: shock.survived,
            }];
            if (!shock.survived) return events;
            // Revive. CON loss is permanent and also shrinks any further
            // resurrection-survival rolls for this hero.
            target.alive = true;
            target.hp = 1;
            target.abilities.con = Math.max(3, con - 1);
            events.push({
                type: 'raise-dead-revived',
                sourceId: caster.id,
                targetId: target.id,
                conAfter: target.abilities.con,
            });
            return events;
        },
    },

    'flame-strike': {
        id: 'flame-strike',
        name: 'Flame Strike',
        caster: 'cleric',
        spellLevel: 5,
        scoreCost: 14,
        minLevel: 9,
        saveCategory: 'spell',
        saveEffect: 'half',
        description: '6d8 radiant fire to one enemy. Save vs. spell halves.',
        cast(encounter, caster) {
            const target = encounter.aliveEnemies()[0];
            if (!target) return null;
            const save = rollSave(target, 'spell', encounter.rng);
            const base = rollDice(6, 8, encounter.rng);
            const damage = save.saved ? Math.floor(base / 2) : base;
            const events = [];
            encounter.dealSpellDamage(target, damage, caster.role, 'diamond', events, {
                spell: 'Flame Strike', saved: save.saved,
            });
            events.push({
                type: 'save', targetId: target.id, category: 'spell',
                saved: save.saved, natural: save.natural, spell: 'Flame Strike',
            });
            return events;
        },
    },
};

// ---------------------------------------------------------------------------
// Paladin divine spells (spec §4.1: L1 slot at char-L9, L2 at char-L11).
// Paladins draw from a narrow cleric-style list, fueled by topaz (per ADR).
// ---------------------------------------------------------------------------

const PALADIN_SPELLS = {
    'paladin-cure-light-wounds': {
        id: 'paladin-cure-light-wounds',
        name: 'Cure Light Wounds',
        caster: 'paladin',
        spellLevel: 1,
        scoreCost: 5,
        minLevel: 9,
        description: 'Heal the most-wounded ally for 1d8 HP.',
        cast(encounter, caster) {
            const target = mostWoundedAlly(encounter);
            if (!target) return null;
            const heal = rollDice(1, 8, encounter.rng);
            const events = [];
            encounter.applyHeal(target, heal, caster.role, events, { spell: 'Cure Light Wounds' });
            return events;
        },
    },

    'paladin-bless': {
        id: 'paladin-bless',
        name: 'Bless',
        caster: 'paladin',
        spellLevel: 1,
        scoreCost: 6,
        minLevel: 9,
        description: 'Bless every ally (+25% damage) for 3 turns.',
        cast(encounter, caster) {
            const events = [];
            for (const m of encounter.aliveParty()) {
                encounter.applyStatus(m, { kind: 'bless', duration: 3 }, events, {
                    spell: 'Bless', sourceId: caster.id,
                });
            }
            return events;
        },
    },

    'paladin-protection-from-evil': {
        id: 'paladin-protection-from-evil',
        name: 'Protection from Evil',
        caster: 'paladin',
        spellLevel: 1,
        scoreCost: 5,
        minLevel: 9,
        description: 'Grant +4 shield to every ally.',
        cast(encounter, caster) {
            const events = [];
            for (const m of encounter.aliveParty()) {
                encounter.applyShield(m, 4, caster.role, events, { spell: 'Protection from Evil' });
            }
            return events;
        },
    },

    'paladin-aid': {
        id: 'paladin-aid',
        name: 'Aid',
        caster: 'paladin',
        spellLevel: 2,
        scoreCost: 7,
        minLevel: 11,
        description: 'Heal one ally 1d8 HP and bless them for 3 turns.',
        cast(encounter, caster) {
            const target = mostWoundedAlly(encounter);
            if (!target) return null;
            const heal = rollDice(1, 8, encounter.rng);
            const events = [];
            encounter.applyHeal(target, heal, caster.role, events, { spell: 'Aid' });
            encounter.applyStatus(target, { kind: 'bless', duration: 3 }, events, {
                spell: 'Aid', sourceId: caster.id,
            });
            return events;
        },
    },

    'paladin-slow-poison': {
        id: 'paladin-slow-poison',
        name: 'Slow Poison',
        caster: 'paladin',
        spellLevel: 2,
        scoreCost: 4,
        minLevel: 11,
        description: 'Cleanse the poison status from the most-poisoned ally.',
        cast(encounter, caster) {
            const allies = encounter.aliveParty();
            let target = null;
            let bestSev = 0;
            for (const a of allies) {
                const p = (a.statuses ?? []).find(s => s.kind === 'poison');
                if (p && (p.severity ?? 0) > bestSev) { target = a; bestSev = p.severity ?? 0; }
            }
            if (!target) return null;
            target.statuses = (target.statuses ?? []).filter(s => s.kind !== 'poison');
            return [{
                type: 'status-cleansed',
                source: caster.role,
                targetId: target.id,
                kinds: ['poison'],
                spell: 'Slow Poison',
            }];
        },
    },
};

// ---------------------------------------------------------------------------
// Ranger spells (spec §4.1: partial caster, starts at char-L8 with 1 L1 slot).
// Rangers draw from a tiny druid-flavored list. Emerald is chosen as the
// color here to match druidic roots; rangers share the color table's
// 'ranger' → topaz mapping for martial actions but cast on emerald score.
// ---------------------------------------------------------------------------

const RANGER_SPELLS = {
    'ranger-entangle': {
        id: 'ranger-entangle',
        name: 'Entangle',
        caster: 'ranger',
        spellLevel: 1,
        scoreCost: 6,
        minLevel: 8,
        saveCategory: 'spell',
        saveEffect: 'negates',
        description: 'Roots the whole enemy line in place for 2 turns. Save vs. spell negates.',
        cast(encounter, caster) {
            const targets = encounter.aliveEnemies();
            if (targets.length === 0) return null;
            const events = [];
            for (const t of targets) {
                const save = rollSave(t, 'spell', encounter.rng);
                if (!save.saved) {
                    encounter.applyStatus(t, { kind: 'stun', duration: 2 }, events, {
                        spell: 'Entangle', sourceId: caster.id,
                    });
                }
                events.push({
                    type: 'save', targetId: t.id, category: 'spell',
                    saved: save.saved, natural: save.natural, spell: 'Entangle',
                });
            }
            return events;
        },
    },

    'ranger-cure-light-wounds': {
        id: 'ranger-cure-light-wounds',
        name: 'Cure Light Wounds',
        caster: 'ranger',
        spellLevel: 1,
        scoreCost: 5,
        minLevel: 8,
        description: 'Heal the most-wounded ally for 1d8 HP.',
        cast(encounter, caster) {
            const target = mostWoundedAlly(encounter);
            if (!target) return null;
            const heal = rollDice(1, 8, encounter.rng);
            const events = [];
            encounter.applyHeal(target, heal, caster.role, events, { spell: 'Cure Light Wounds' });
            return events;
        },
    },

    'ranger-barkskin': {
        id: 'ranger-barkskin',
        name: 'Barkskin',
        caster: 'ranger',
        spellLevel: 2,
        scoreCost: 6,
        minLevel: 10,
        description: 'Grant +4 shield to every ally.',
        cast(encounter, caster) {
            const events = [];
            for (const m of encounter.aliveParty()) {
                encounter.applyShield(m, 4, caster.role, events, { spell: 'Barkskin' });
            }
            return events;
        },
    },
};

export const SPELLS = {
    ...MAGE_SPELLS,
    ...CLERIC_SPELLS,
    ...PALADIN_SPELLS,
    ...RANGER_SPELLS,
};

/**
 * Spells the hero knows and can cast at their current level.
 *
 * Non-mages learn every spell of a level automatically once they hit the
 * level threshold (spec §4.3): role + minLevel gate alone.
 *
 * Mages must scribe each spell into their spellbook (spec §4.3 P5). A mage
 * hero carries a `knownSpells: Set<spellId>` that filters the registry; the
 * Set is initialized by `defaultMageKnownSpells(level)` at creation and
 * expanded via `scribeSpell` at post-combat. Legacy mages without the Set
 * fall back to the "learn everything at level" rule for backward compat.
 */
export function spellsForHero(hero) {
    if (hero.role === 'mage' && hero.knownSpells instanceof Set) {
        return Object.values(SPELLS).filter(s =>
            s.caster === 'mage' &&
            hero.level >= s.minLevel &&
            hero.knownSpells.has(s.id));
    }
    return Object.values(SPELLS).filter(s => s.caster === hero.role && hero.level >= s.minLevel);
}

/**
 * The spell ids a freshly-created mage starts with. Covers every mage
 * spell at or below the given character level — a rolled mage doesn't
 * need to scribe basics, only advanced / unusual spells.
 */
export function defaultMageKnownSpells(level) {
    const out = new Set();
    const L = Math.max(1, level | 0);
    for (const s of Object.values(SPELLS)) {
        if (s.caster === 'mage' && L >= s.minLevel) out.add(s.id);
    }
    return out;
}

/**
 * Attempt to scribe a spell into a mage's spellbook. Rolls d100 ≤
 * `intLearnPct(INT)` (spec §1.1). On success the spell id joins
 * `knownSpells`. Returns `{ success, roll, target, spellId }` or
 * `{ error }` when the attempt is invalid (wrong class, unknown spell,
 * already known, etc). The caller supplies the rng (scroll rarity +
 * consumption decisions live above this layer).
 */
export function scribeSpell(hero, spellId, rng) {
    if (hero?.role !== 'mage') return { error: 'not-a-mage' };
    const spell = SPELLS[spellId];
    if (!spell || spell.caster !== 'mage') return { error: 'no-such-spell' };
    hero.knownSpells ??= defaultMageKnownSpells(hero.level);
    if (hero.knownSpells.has(spellId)) return { error: 'already-known' };
    const target = intLearnPct(hero.abilities?.int ?? 11);
    const roll = 1 + Math.floor(rng() * 100);
    const success = roll <= target;
    if (success) hero.knownSpells.add(spellId);
    return { success, roll, target, spellId };
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
