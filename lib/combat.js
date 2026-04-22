// Per ADR 0002: party uses EotB-style front/rear ranks. Color score from the
// match board fuels each role's action for the turn. Spells (sapphire/diamond)
// also require a prepared slot — the slot is the container, score is the fuel.

import { getSpell, defaultMageKnownSpells } from './spells.js';
import {
    canEquip, equipmentBonus, equipmentSpellSlotBonus, weaponDamageDie,
    totalEquipmentWeight, SLOTS,
} from './items.js';
import {
    defaultAbilities, normalizeAbilities,
    strHitMod, strDamageMod, dexMissileMod, dexAcAdj, strWeightLimit,
} from './abilities.js';
import {
    freshSlotState, availableSlots, consumeSlot, refillAllSlots,
    recomputeMaxSlots, isCasterRole,
} from './spell-slots.js';
import { thac0ForHero, rollAttack } from './thac0.js';
import { savesForHero, defaultMonsterSaves } from './saves.js';
import {
    freshDailyUses, refreshDailyUses, backstabMultiplier,
    tryTurnUndead, tryLayOnHands, tryShapechange,
    canTurnUndeadClass, dailyUsesRemaining,
    meleeAttacksThisTurn,
} from './class-features.js';

export const DEFAULT_INVENTORY_CAPACITY = 12;

export function forEachAliveHero(party, fn) {
    for (const hero of party) {
        if (hero.alive) fn(hero);
    }
}

/** Refill every caster's prepared spell slots. Called by Camp. */
export function refillPartySlots(party) {
    for (const hero of party) {
        if (hero.slots) refillAllSlots(hero.slots);
    }
}

/**
 * Refresh every hero's per-day class-feature usage counters. Called by
 * Camp alongside slot refill — these are the Paladin's Lay on Hands
 * and the Druid's Shapechange.
 */
export function refreshPartyDailyUses(party) {
    for (const hero of party) refreshDailyUses(hero);
}

export const ROLE_BY_COLOR = {
    ruby: 'warrior',
    sapphire: 'mage',
    emerald: 'druid',
    topaz: 'rogue',
    diamond: 'cleric',
    amethyst: 'summoner',
};

export const COLOR_BY_ROLE = Object.fromEntries(
    Object.entries(ROLE_BY_COLOR).map(([color, role]) => [role, color])
);

// Score → action ratios. Higher numbers = score is more expensive to convert
// into the action. Tuned so big cascades feel rewarding without making the
// party invincible (shields used to cost only 8 score each, leading to 30+
// shield per turn and stalemate fights).
const SCORE_PER_DAMAGE = {
    ruby: 16,
    sapphire: 12,
    topaz: 16,
};
const SCORE_PER_HEAL = 16;
const SCORE_PER_SHIELD = 22;
const SCORE_PER_ULT_CHARGE = 22;
// AD&D-style backstab: a rogue positioned to exploit surprise lands a
// damage multiplier by level band (spec §2.1). We model "did I get the
// drop on them?" as a 30% chance per swing; the multiplier then scales
// with the thief's level so high-level thieves backstab harder (×3 at
// L5, ×4 at L9, ×5 at L13). See class-features.js `backstabMultiplier`.
const ROGUE_BACKSTAB_CHANCE = 0.3;

// Enemy attack roll difficulty. d20 roll must be >= TO_HIT_BASE - effectiveAc
// to land. Lowered from 20 to 13 so front-rank heroes (AC 4) get hit ~60% of
// the time instead of ~25%.
const TO_HIT_BASE = 13;

// Spec P10: Paladin Protection-from-Evil aura. Evil-aligned opponents suffer
// -2 to hit while any alive paladin is in the party (Character Guide §3.1).
// `isEvil(enemy)` defaults to checking `enemy.alignment === 'evil'`; undead
// are auto-flagged so existing undead encounters gain the aura for free.
const PALADIN_AURA_TOHIT_PENALTY = 2;

export function isEvilEnemy(enemy) {
    if (!enemy) return false;
    if (enemy.alignment === 'evil') return true;
    if (enemy.undead === true) return true;  // undead count as evil-aligned
    return false;
}

function partyHasLivingPaladin(party) {
    for (const p of party) if (p.alive && p.role === 'paladin') return true;
    return false;
}

export const RESIST_MULT = 0.5;
export const WEAK_MULT = 1.5;
export const ULT_FULL = 100;
export const ULT_DAMAGE = 30;


// Shields decay at end of every turn — without this they stack indefinitely
// (cleric diamond score keeps adding) and combat stalls into a wall of
// absorbed-zero hits. Half-decay leaves a meaningful 1-2 turn buffer while
// preventing infinite growth.
export const SHIELD_DECAY_FACTOR = 0.5;

// Status effects: persistent per-actor states that tick at end of turn.
//   poison — DoT, ignores shields
//   stun   — skip the actor's next action
//   curse  — outgoing damage ×0.75
//   bless  — outgoing damage ×1.25
export const STATUS_KINDS = ['poison', 'stun', 'curse', 'bless'];
export const HARMFUL_STATUSES = new Set(['poison', 'stun', 'curse']);
export const BENEFICIAL_STATUSES = new Set(['bless']);

const CURSE_MULT = 0.75;
const BLESS_MULT = 1.25;

export function makeHero({ id, name, role, rank, maxHp, ac = 10, level = 1, abilities, inventoryCapacity = DEFAULT_INVENTORY_CAPACITY }) {
    const normalized = abilities ? normalizeAbilities(abilities) : defaultAbilities();
    const hero = {
        id, name, role, rank, maxHp, hp: maxHp, ac, shield: 0, alive: true,
        level, xp: 0,
        abilities: normalized,
        slots: freshSlotState(role, level, normalized),
        thac0: thac0ForHero(role, level),
        saves: savesForHero(role, level),
        dailyUses: freshDailyUses(role, level),
        statuses: [],
        equipment: {},
        inventory: [],
        inventoryCapacity,
    };
    // Mages carry a spellbook (spec §4.3 P5): scribe-known ids. Non-mages
    // auto-learn at level and don't need the Set.
    if (role === 'mage') hero.knownSpells = defaultMageKnownSpells(level);
    return hero;
}

// ----- equipment helpers -----

/**
 * Effective AC per spec §3.1: `AC = base − armorBonus + dexAcAdj(dex)`.
 * `dexAcAdj` is signed for descending AC — DEX 18 returns -4 (better, so
 * AC drops), DEX 3 returns +4 (worse, so AC rises). Hence a plain add.
 */
export function effectiveAc(hero) {
    const ac = hero.ac - equipmentBonus(hero, 'armorBonus') + dexAcAdj(hero.abilities?.dex ?? 11);
    return Math.max(0, ac);
}

/**
 * Spec §1.1 P9: a hero is encumbered when carried weight exceeds the STR
 * weight allowance. Encumbered heroes swing at `ENCUMBRANCE_DAMAGE_MULT`
 * (mirrors the curse modifier). Exposed so UI / tests can branch on it.
 */
export const ENCUMBRANCE_DAMAGE_MULT = 0.75;

export function isEncumbered(hero) {
    if (!hero?.abilities) return false;
    return totalEquipmentWeight(hero) > strWeightLimit(hero.abilities.str ?? 11);
}

/** Flat damage bonus from equipped weapon + accessories. */
export function effectiveDamageBonus(hero) {
    return equipmentBonus(hero, 'damageBonus');
}

/**
 * Given the current per-color score map, project what this hero will do when
 * the player commits the turn. Returns { color, score, kind, amount } where
 * `kind` is one of 'damage' | 'heal' | 'shield' | 'charge' | null and
 * `amount` is the projected output (without resistances/weaknesses applied,
 * since those depend on the target).
 */
export function projectedAction(hero, scoreByColor = {}) {
    const color = COLOR_BY_ROLE[hero.role];
    if (!color) return null;
    const score = scoreByColor[color] || 0;
    if (score <= 0) return { color, score: 0, kind: null, amount: 0 };

    switch (hero.role) {
        case 'warrior': {
            const dmg = Math.floor(score / SCORE_PER_DAMAGE.ruby) + effectiveDamageBonus(hero);
            return { color, score, kind: 'damage', amount: dmg };
        }
        case 'mage': {
            const dmg = Math.floor(score / SCORE_PER_DAMAGE.sapphire) + effectiveDamageBonus(hero);
            return { color, score, kind: 'damage', amount: dmg };
        }
        case 'rogue': {
            // crits are random, so project the non-crit base
            const dmg = Math.floor(score / SCORE_PER_DAMAGE.topaz) + effectiveDamageBonus(hero);
            return { color, score, kind: 'damage', amount: dmg };
        }
        case 'druid': {
            const heal = Math.floor(score / SCORE_PER_HEAL);
            return { color, score, kind: 'heal', amount: heal };
        }
        case 'cleric': {
            const shield = Math.floor(score / SCORE_PER_SHIELD);
            return { color, score, kind: 'shield', amount: shield };
        }
        case 'summoner': {
            const charge = Math.floor(score / SCORE_PER_ULT_CHARGE);
            return { color, score, kind: 'charge', amount: charge };
        }
        default:
            return { color, score, kind: null, amount: 0 };
    }
}

/**
 * Equip an item the hero already holds. Returns true on success or
 * one of the strings: 'no-such-item', 'class-restricted', 'wrong-slot',
 * 'slot-occupied'.
 */
export function equipItem(hero, itemId, { autoSwap = true } = {}) {
    const idx = hero.inventory.findIndex(i => i.id === itemId);
    if (idx < 0) return 'no-such-item';
    const item = hero.inventory[idx];
    if (!canEquip(hero, item)) return 'class-restricted';
    if (!SLOTS.includes(item.slot)) return 'wrong-slot';
    const occupied = hero.equipment[item.slot];
    if (occupied && !autoSwap) return 'slot-occupied';

    hero.inventory.splice(idx, 1);
    if (occupied) hero.inventory.push(occupied);
    hero.equipment[item.slot] = item;
    applyEquipmentStatChanges(hero, item, +1);
    return true;
}

/**
 * Unequip the item in the given slot back to inventory.
 * Returns true on success or 'slot-empty' / 'inventory-full'.
 */
export function unequipItem(hero, slot) {
    const item = hero.equipment[slot];
    if (!item) return 'slot-empty';
    if (hero.inventory.length >= hero.inventoryCapacity) return 'inventory-full';
    hero.inventory.push(item);
    hero.equipment[slot] = null;
    applyEquipmentStatChanges(hero, item, -1);
    return true;
}

/**
 * Add an item directly to inventory (e.g., from a loot drop).
 * Returns true if it fit, false if the inventory was full.
 */
export function addItemToInventory(hero, item) {
    if (hero.inventory.length >= hero.inventoryCapacity) return false;
    hero.inventory.push(item);
    return true;
}

/**
 * Apply or remove the maxHp / spell-slot shifts of an equipped item. Damage
 * and armor bonuses are read at use time so they don't need this; only stat
 * pools stored on the actor (maxHp, slots.max) do.
 */
function applyEquipmentStatChanges(hero, item, sign) {
    const hpDelta = (item.bonuses?.maxHpBonus ?? 0) * sign;
    if (hpDelta !== 0) {
        hero.maxHp += hpDelta;
        if (sign > 0) hero.hp += hpDelta;
        else hero.hp = Math.min(hero.hp, hero.maxHp);
    }
    // Slot bonuses are re-derived from the full equipment set rather than
    // incrementally toggled, so swapping gear never double-counts.
    if (isCasterRole(hero.role)) {
        recomputeMaxSlots(hero.slots, hero.role, hero.level, hero.abilities, equipmentSpellSlotBonus(hero));
    }
}

export function makeEnemy({
    id, name, maxHp, ac = 10, damage,
    resistances = [], weaknesses = [],
    intentRotation = null,
    xp = 30,
    saves,
    undead = false,
    monsterId = null,
    alignment = null,
}) {
    const rotation = intentRotation ?? [{ kind: 'attack', amount: damage, label: 'Attack' }];
    // Estimate HD from max-HP at a d8 average (roll-to-the-middle) so save
    // strength scales with monster toughness. Callers can override via `saves`.
    const estHd = Math.max(1, Math.round(maxHp / 8));
    return {
        id, name, maxHp, hp: maxHp, ac, damage,
        resistances, weaknesses,
        intentRotation: rotation,
        intentIndex: 0,
        shield: 0,
        defendBonus: 0,
        alive: true,
        xp,
        statuses: [],
        saves: saves ?? defaultMonsterSaves(estHd),
        undead: !!undead,
        monsterId,
        alignment,
    };
}

export function hasStatus(actor, kind) {
    return (actor.statuses ?? []).some(s => s.kind === kind);
}

function damageMultiplierFor(actor) {
    let mult = 1;
    for (const s of actor.statuses ?? []) {
        if (s.kind === 'curse') mult *= CURSE_MULT;
        else if (s.kind === 'bless') mult *= BLESS_MULT;
    }
    // Heroes only (enemies don't carry abilities + equipment weight).
    if (actor.abilities && isEncumbered(actor)) mult *= ENCUMBRANCE_DAMAGE_MULT;
    return mult;
}

/** What the enemy will do on the next commit. */
export function currentIntent(enemy) {
    return enemy.intentRotation[enemy.intentIndex % enemy.intentRotation.length];
}

/**
 * In-place scale an enemy's stats by `factor` (HP, damage, intent amounts,
 * and XP reward). A factor of 1 is a no-op; 1.5 makes the enemy 50% tougher
 * and 50% more rewarding.
 */
export function scaleEnemy(enemy, factor) {
    if (factor === 1 || !Number.isFinite(factor)) return enemy;
    enemy.maxHp = Math.ceil(enemy.maxHp * factor);
    enemy.hp    = enemy.maxHp;
    enemy.damage = Math.ceil(enemy.damage * factor);
    enemy.xp     = Math.ceil(enemy.xp * factor);
    for (const intent of enemy.intentRotation) {
        if (typeof intent.amount === 'number' && intent.amount > 0) {
            intent.amount = Math.ceil(intent.amount * factor);
        }
    }
    return enemy;
}

export class Encounter {
    constructor({ party, enemies, rng = Math.random }) {
        this.party = party;
        this.enemies = enemies;
        this.rng = rng;
        this.turn = 0;
        this.ultMeter = 0;
        this.collectedXp = 0;        // accumulates as enemies die, paid out on victory
        this._creditedDeaths = new Set();
        this._inResolveTurn = false; // gates "applied this turn = no tick this turn"
        this._turnUndeadUsed = new Set(); // heroIds that spent their 1/combat turn-undead
    }

    aliveParty() {
        return this.party.filter(p => p.alive && p.hp > 0);
    }

    aliveEnemies() {
        return this.enemies.filter(e => e.alive && e.hp > 0);
    }

    status() {
        if (this.aliveEnemies().length === 0) return 'victory';
        if (this.aliveParty().length === 0) return 'defeat';
        return 'ongoing';
    }

    canCastUltimate() {
        return this.ultMeter >= ULT_FULL && this.aliveEnemies().length > 0;
    }

    /**
     * Whether the named spell can be cast right now. Checks caster identity,
     * class-level gate, and slot availability. Score cost is a separate gate
     * enforced by Game.canCastSpell (it needs access to scoreThisTurn).
     */
    canCastSpell(spellId, casterId) {
        const spell = getSpell(spellId);
        if (!spell) return false;
        const caster = this.party.find(p => p.id === casterId);
        if (!caster || !caster.alive) return false;
        if (caster.role !== spell.caster) return false;
        if (caster.level < spell.minLevel) return false;
        if (availableSlots(caster.slots, spell.spellLevel) <= 0) return false;
        return true;
    }

    /**
     * Cast a spell. Consumes one slot of the spell's level, runs the effect,
     * returns { events, status } or null if illegal.
     */
    castSpell(spellId, casterId) {
        if (!this.canCastSpell(spellId, casterId)) return null;
        const spell = getSpell(spellId);
        const caster = this.party.find(p => p.id === casterId);
        const events = spell.cast(this, caster);
        if (!events) return null;
        consumeSlot(caster.slots, spell.spellLevel);
        events.unshift({
            type: 'spell-cast',
            sourceId: caster.id,
            spellId,
            name: spell.name,
            spellLevel: spell.spellLevel,
            scoreCost: spell.scoreCost,
        });
        return { events, status: this.status() };
    }

    // ----- class features (Phase 5) -----

    /** True if this hero can use Turn Undead right now (class + 1/combat). */
    canTurnUndead(heroId) {
        const hero = this.party.find(p => p.id === heroId);
        if (!hero?.alive) return false;
        if (!canTurnUndeadClass(hero)) return false;
        this._turnUndeadUsed ??= new Set();
        return !this._turnUndeadUsed.has(hero.id);
    }

    /**
     * Invoke Turn Undead. Affects every undead in the encounter at once —
     * each resolves independently. Returns { events, status } or null.
     */
    turnUndead(heroId) {
        const hero = this.party.find(p => p.id === heroId);
        if (!hero) return null;
        const events = tryTurnUndead(this, hero);
        if (!events) return null;
        return { events, status: this.status() };
    }

    /** True if a Paladin has a Lay on Hands charge left today. */
    canLayOnHands(heroId, targetId) {
        const hero = this.party.find(p => p.id === heroId);
        if (!hero?.alive || hero.role !== 'paladin') return false;
        if (dailyUsesRemaining(hero, 'layOnHands') <= 0) return false;
        if (!targetId) return true;
        const target = this.party.find(p => p.id === targetId);
        return !!target?.alive;
    }

    layOnHands(heroId, targetId) {
        const hero = this.party.find(p => p.id === heroId);
        if (!hero) return null;
        const events = tryLayOnHands(this, hero, targetId);
        if (!events) return null;
        return { events, status: this.status() };
    }

    /** True if a Druid is L7+ and has a shapechange charge left. */
    canShapechange(heroId) {
        const hero = this.party.find(p => p.id === heroId);
        if (!hero?.alive || hero.role !== 'druid') return false;
        if ((hero.level | 0) < 7) return false;
        return dailyUsesRemaining(hero, 'shapechange') > 0;
    }

    shapechange(heroId) {
        const hero = this.party.find(p => p.id === heroId);
        if (!hero) return null;
        const events = tryShapechange(this, hero);
        if (!events) return null;
        return { events, status: this.status() };
    }

    /** AoE pulse from the summoner. Drains the meter, ignores resistances. */
    castUltimate() {
        if (!this.canCastUltimate()) return null;
        const events = [];
        for (const enemy of this.aliveEnemies()) {
            this.#applyDamageRaw(enemy, ULT_DAMAGE, 'summoner-ult', null, events);
        }
        this.ultMeter = 0;
        events.push({ type: 'ult-cast', amount: ULT_DAMAGE });
        return { events, status: this.status() };
    }

    /**
     * Apply a turn's worth of color score to the encounter.
     * Returns { events, status } where events is an ordered log for animation.
     */
    resolveTurn(scoreByColor) {
        this._inResolveTurn = true;
        const events = [];
        const score = {
            ruby: scoreByColor.ruby || 0,
            sapphire: scoreByColor.sapphire || 0,
            emerald: scoreByColor.emerald || 0,
            topaz: scoreByColor.topaz || 0,
            diamond: scoreByColor.diamond || 0,
            amethyst: scoreByColor.amethyst || 0,
        };

        const heroByRole = role => this.party.find(p => p.role === role && p.alive && p.hp > 0);

        // Offensive actions: warrior (ruby, melee/STR), rogue (topaz, missile/DEX),
        // mage (sapphire, auto-hit magical). Stunned heroes skip entirely.
        // Per rpg-fidelity-spec.md §3, warrior & rogue roll d20 to hit: melee
        // uses STR-hit, missile uses DEX-missile. Mage damage is magical and
        // always lands. On miss → 0 damage + `attack-miss` event.
        const target = this.aliveEnemies()[0];
        if (target) {
            // Ruby (melee): warrior or (fallback) ranger. Warrior is primary
            // per the ADR color map; a warrior-less party with a ranger lets
            // the ranger consume ruby so the role is never wasted.
            const meleeHero = heroByRole('warrior') ?? heroByRole('ranger');
            if (meleeHero && score.ruby > 0) {
                if (hasStatus(meleeHero, 'stun')) {
                    events.push({ type: 'status-skip', sourceId: meleeHero.id, kind: 'stun' });
                } else {
                    this.#multiHeroWeaponAttack(meleeHero, score.ruby, 'ruby', 'str', events);
                }
            }

            if (target.alive && target.hp > 0) {
                const mage = heroByRole('mage');
                if (mage && score.sapphire > 0 && !hasStatus(mage, 'stun')) {
                    let dmg = Math.floor(score.sapphire / SCORE_PER_DAMAGE.sapphire) + effectiveDamageBonus(mage);
                    dmg = Math.floor(dmg * damageMultiplierFor(mage));
                    if (dmg > 0) this.#dealDamage(target, dmg, 'mage', 'sapphire', events);
                } else if (mage && hasStatus(mage, 'stun') && score.sapphire > 0) {
                    events.push({ type: 'status-skip', sourceId: mage.id, kind: 'stun' });
                }
            }

            if (target.alive && target.hp > 0) {
                const rogue = heroByRole('rogue');
                if (rogue && score.topaz > 0) {
                    if (hasStatus(rogue, 'stun')) {
                        events.push({ type: 'status-skip', sourceId: rogue.id, kind: 'stun' });
                    } else {
                        // Rogues don't get P1 extra attacks (warrior-only) or
                        // ranger two-weapon, so single-swing is correct here.
                        this.#heroWeaponAttack(rogue, target, score.topaz, 'topaz', 'dex', events);
                    }
                }
            }
        }

        // Support actions: druid heal, cleric shield.
        const druid = heroByRole('druid');
        if (druid && score.emerald > 0) {
            const heal = Math.floor(score.emerald / SCORE_PER_HEAL);
            if (heal > 0) {
                for (const m of this.aliveParty()) {
                    const before = m.hp;
                    m.hp = Math.min(m.maxHp, m.hp + heal);
                    events.push({ type: 'heal', source: 'druid', targetId: m.id, amount: m.hp - before });
                }
            }
        }

        const cleric = heroByRole('cleric');
        if (cleric && score.diamond > 0) {
            const shield = Math.floor(score.diamond / SCORE_PER_SHIELD);
            if (shield > 0) {
                for (const m of this.aliveParty()) {
                    m.shield += shield;
                    events.push({ type: 'shield', source: 'cleric', targetId: m.id, amount: shield });
                }
            }
        }

        // Summoner: amethyst builds the ultimate meter (capped at 100).
        if (score.amethyst > 0) {
            const charge = Math.floor(score.amethyst / SCORE_PER_ULT_CHARGE);
            if (charge > 0) {
                this.ultMeter = Math.min(ULT_FULL, this.ultMeter + charge);
                events.push({ type: 'meter', source: 'summoner', amount: charge, total: this.ultMeter });
            }
        }

        // Enemy actions, driven by each enemy's intent rotation.
        // Stunned enemies skip their intent but their rotation index still advances
        // (so the player still gets the telegraph for the next intent).
        for (const enemy of this.aliveEnemies()) {
            const intent = currentIntent(enemy);
            if (hasStatus(enemy, 'stun')) {
                events.push({ type: 'status-skip', sourceId: enemy.id, kind: 'stun' });
            } else {
                this.#executeIntent(enemy, intent, events);
            }
            enemy.intentIndex = (enemy.intentIndex + 1) % enemy.intentRotation.length;
        }

        // End-of-turn ticks: status effects on heroes and enemies.
        for (const actor of [...this.party, ...this.enemies]) {
            this.#tickStatuses(actor, events);
        }

        // Shields decay so they don't stack to invincibility across turns.
        for (const actor of [...this.party, ...this.enemies]) {
            if (actor.shield > 0) actor.shield = Math.floor(actor.shield * SHIELD_DECAY_FACTOR);
        }

        // Slots do not refill per-turn; they only refresh at Camp. Per
        // rpg-fidelity-spec.md §4.2, mid-adventure re-memorization is out of
        // scope. This is the ADR's "slots are the container" rule.

        this.turn++;
        this._inResolveTurn = false;
        return { events, status: this.status() };
    }

    #tickStatuses(actor, events) {
        if (!actor.statuses || actor.statuses.length === 0) return;
        const remaining = [];
        for (const s of actor.statuses) {
            // Statuses applied this turn don't tick or decay until next turn.
            if (s.appliedOnTurn === this.turn) {
                remaining.push(s);
                continue;
            }
            if (actor.alive && s.kind === 'poison') {
                const dmg = s.severity ?? 2;
                actor.hp = Math.max(0, actor.hp - dmg);
                events.push({ type: 'status-tick', kind: 'poison', targetId: actor.id, amount: dmg });
                if (actor.hp === 0) {
                    if (this.party.includes(actor)) actor.alive = false;
                    else this.#killEnemy(actor);
                }
            }
            s.duration -= 1;
            if (s.duration > 0) remaining.push(s);
            else events.push({ type: 'status-end', kind: s.kind, targetId: actor.id });
        }
        actor.statuses = remaining;
    }

    #executeIntent(enemy, intent, events) {
        switch (intent.kind) {
            case 'attack':
            case 'big-attack': {
                const tgt = this.#pickPartyTarget();
                if (!tgt) return;
                const roll = 1 + Math.floor(this.rng() * 20);
                // Paladin aura: evil opponents suffer -2 to hit while any
                // paladin is still alive. We raise the required roll instead
                // of subtracting from the natural so a natural 20 still lands.
                const aura = (isEvilEnemy(enemy) && partyHasLivingPaladin(this.party))
                    ? PALADIN_AURA_TOHIT_PENALTY : 0;
                const toHit = TO_HIT_BASE - effectiveAc(tgt) + aura;
                if (roll < toHit) {
                    events.push({ type: 'enemy-miss', sourceId: enemy.id, targetId: tgt.id, roll, intent: intent.kind });
                    return;
                }
                let dmg = intent.amount ?? enemy.damage;
                dmg = Math.floor(dmg * damageMultiplierFor(enemy));
                const absorbed = Math.min(tgt.shield, dmg);
                tgt.shield -= absorbed;
                const dealt = dmg - absorbed;
                tgt.hp = Math.max(0, tgt.hp - dealt);
                if (tgt.hp === 0) tgt.alive = false;
                events.push({
                    type: 'enemy-attack',
                    sourceId: enemy.id,
                    targetId: tgt.id,
                    amount: dealt,
                    absorbed,
                    roll,
                    intent: intent.kind,
                });
                if (intent.applyStatus && tgt.alive) {
                    this.applyStatus(tgt, intent.applyStatus, events, { sourceId: enemy.id });
                }
                return;
            }
            case 'defend': {
                enemy.shield += intent.amount ?? 8;
                events.push({ type: 'enemy-defend', sourceId: enemy.id, amount: intent.amount ?? 8 });
                return;
            }
            case 'summon': {
                const tmpl = intent.spawn ?? { name: 'Imp', maxHp: 8, ac: 9, damage: 2 };
                const id = `${enemy.id}-spawn-${this.turn}-${this.enemies.length}`;
                const minion = makeEnemy({ id, ...tmpl });
                this.enemies.push(minion);
                events.push({ type: 'enemy-summon', sourceId: enemy.id, summonName: minion.name });
                return;
            }
            default:
                return;
        }
    }

    /**
     * Run every melee swing this turn (spec §2.1 attacks-per-round + Ranger
     * two-weapon). The total ruby score is divided equally across swings so
     * that doubling attacks doesn't also double the damage pool. Each swing
     * rolls its own d20 to-hit and, once C2 lands, its own weapon die.
     * Retargets after each swing in case a swing drops the current enemy.
     */
    #multiHeroWeaponAttack(hero, score, color, ability, events) {
        const armor = equipmentBonus(hero, 'armorBonus');
        const swings = meleeAttacksThisTurn(hero, this.turn, armor);
        if (swings <= 0) return;
        const perSwing = Math.floor(score / swings);
        if (perSwing <= 0) {
            // Tiny score — degrade to one swing with the full score rather
            // than zeroing out the attack entirely.
            const t = this.aliveEnemies()[0];
            if (!t) return;
            this.#heroWeaponAttack(hero, t, score, color, ability, events);
            return;
        }
        for (let i = 0; i < swings; i++) {
            const t = this.aliveEnemies()[0];
            if (!t) return;
            this.#heroWeaponAttack(hero, t, perSwing, color, ability, events, { swing: i + 1, swings });
        }
    }

    /**
     * Resolve one weapon attack from a hero against a target.
     *   - Rolls d20 vs thac0 - targetAC, modified by STR-hit (melee) or
     *     DEX-missile (ranged) plus weapon `damageBonus` (acts as magic-weapon
     *     to-hit bonus in AD&D).
     *   - On hit: damage = floor(score/divisor) + equipmentDamageBonus
     *     + (STR-damage for melee only; ranged attacks get no STR-dmg bonus
     *     per rpg-fidelity-spec.md §3). Crit / damage-multiplier statuses
     *     still apply. Rogue's legacy crit chance fires *only* on a hit.
     *   - On miss: zero damage, `attack-miss` event for the UI.
     *
     * `ability` is 'str' for melee, 'dex' for ranged. No natural-20 double
     * damage per spec (EotB does not adopt AD&D 2e crits).
     */
    #heroWeaponAttack(hero, target, score, color, ability, events, swingInfo = null) {
        // Enemies carry a flat `ac` (no equipment), so read it directly.
        const targetAC = target.ac ?? 10;
        const hitBonus = ability === 'dex'
            ? dexMissileMod(hero.abilities?.dex ?? 11)
            : strHitMod(hero.abilities?.str ?? 11);
        const { hit, natural, need, total } = rollAttack({
            thac0: hero.thac0 ?? 20,
            targetAC,
            hitMod: hitBonus,
            rng: this.rng,
        });
        if (!hit) {
            events.push({
                type: 'attack-miss',
                source: hero.role,
                sourceId: hero.id,
                targetId: target.id,
                color,
                natural,
                need,
                total,
                ...(swingInfo ?? {}),
            });
            return;
        }

        const divisor = SCORE_PER_DAMAGE[color] ?? 16;
        const strDmg = ability === 'str' ? strDamageMod(hero.abilities?.str ?? 11) : 0;
        // Weapon die (spec §3): roll the equipped weapon's die for each swing,
        // on top of the score-based portion. Unarmed heroes skip this add
        // entirely — the score IS their damage. This mirrors the ADR's "score
        // is fuel" contract: dice are a weapon-quality kicker, not the base.
        const die = weaponDamageDie(hero);
        let weaponRoll = 0;
        if (die) {
            for (let i = 0; i < die.n; i++) weaponRoll += 1 + Math.floor(this.rng() * die.sides);
        }
        let dmg = Math.floor(score / divisor) + weaponRoll + effectiveDamageBonus(hero) + strDmg;
        let crit = false;
        let backstabMult = null;
        if (hero.role === 'rogue') {
            crit = this.rng() < ROGUE_BACKSTAB_CHANCE;
            if (crit) {
                backstabMult = backstabMultiplier(hero.level ?? 1);
                dmg *= backstabMult;
            }
        }
        dmg = Math.floor(dmg * damageMultiplierFor(hero));
        if (dmg <= 0) return;
        const extra = crit
            ? { crit, natural, backstabMult, ...(swingInfo ?? {}) }
            : { natural, ...(swingInfo ?? {}) };
        this.#dealDamage(target, dmg, hero.role, color, events, extra);
    }

    #dealDamage(target, baseDmg, source, color, events, extra = {}) {
        let dmg = baseDmg;
        let modifier = 'normal';
        if (color && target.weaknesses?.includes(color)) {
            dmg = Math.floor(dmg * WEAK_MULT);
            modifier = 'weak';
        } else if (color && target.resistances?.includes(color)) {
            dmg = Math.floor(dmg * RESIST_MULT);
            modifier = 'resist';
        }
        const absorbed = Math.min(target.shield ?? 0, dmg);
        if (absorbed > 0) target.shield -= absorbed;
        const dealt = dmg - absorbed;
        target.hp = Math.max(0, target.hp - dealt);
        if (target.hp === 0) this.#killEnemy(target);
        events.push({
            type: 'damage', source, color, targetId: target.id,
            amount: dealt, base: baseDmg, absorbed, modifier, ...extra,
        });
    }

    #applyDamageRaw(target, dmg, source, color, events, extra = {}) {
        const absorbed = Math.min(target.shield ?? 0, dmg);
        if (absorbed > 0) target.shield -= absorbed;
        const dealt = dmg - absorbed;
        target.hp = Math.max(0, target.hp - dealt);
        if (target.hp === 0) this.#killEnemy(target);
        events.push({
            type: 'damage', source, color, targetId: target.id,
            amount: dealt, base: dmg, absorbed, modifier: 'true', ...extra,
        });
    }

    #killEnemy(enemy) {
        if (!enemy.alive) return;
        enemy.alive = false;
        if (!this._creditedDeaths.has(enemy.id) && typeof enemy.xp === 'number') {
            this._creditedDeaths.add(enemy.id);
            this.collectedXp += enemy.xp;
        }
    }

    // ----- public helpers used by the spell + class-feature systems -----

    dealSpellDamage(target, baseDmg, sourceRole, color, events, extra = {}) {
        this.#dealDamage(target, baseDmg, sourceRole, color, events, extra);
    }

    /**
     * Drop a living enemy straight to 0 HP, bypassing shields and
     * resist/weakness math. Used by Turn Undead auto-destroys. Credits XP
     * the same way a normal kill would.
     */
    destroyEnemy(target, source, events, extra = {}) {
        if (!target || !target.alive) return 0;
        const dealt = target.hp;
        target.shield = 0;
        target.hp = 0;
        this.#killEnemy(target);
        events.push({
            type: 'damage', source, color: null, targetId: target.id,
            amount: dealt, base: dealt, absorbed: 0, modifier: 'true', ...extra,
        });
        return dealt;
    }

    applyHeal(target, amount, sourceRole, events, extra = {}) {
        if (!target.alive) return 0;
        const before = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + amount);
        const healed = target.hp - before;
        events.push({ type: 'heal', source: sourceRole, targetId: target.id, amount: healed, ...extra });
        return healed;
    }

    applyShield(target, amount, sourceRole, events, extra = {}) {
        if (!target.alive) return 0;
        target.shield += amount;
        events.push({ type: 'shield', source: sourceRole, targetId: target.id, amount, ...extra });
        return amount;
    }

    /**
     * Apply a status to an actor. If the same kind already exists, refresh its
     * duration (max of old and new) and severity (max of old and new) — this is
     * the standard "doesn't stack but refreshes" behavior.
     */
    applyStatus(target, status, events = [], extra = {}) {
        if (!target.alive) return;
        target.statuses ??= [];
        // Only mark as fresh if applied during a turn resolution. Statuses
        // applied between turns (test setup, post-camp boons, etc.) tick on
        // the very next turn.
        const freshTurn = this._inResolveTurn ? this.turn : -1;
        const existing = target.statuses.find(s => s.kind === status.kind);
        if (existing) {
            existing.duration = Math.max(existing.duration, status.duration ?? 1);
            existing.severity = Math.max(existing.severity ?? 0, status.severity ?? 0);
            existing.appliedOnTurn = freshTurn;
        } else {
            target.statuses.push({
                kind: status.kind,
                duration: status.duration ?? 1,
                severity: status.severity ?? 0,
                appliedOnTurn: freshTurn,
            });
        }
        events.push({
            type: 'status-applied',
            kind: status.kind,
            targetId: target.id,
            duration: status.duration ?? 1,
            severity: status.severity ?? 0,
            ...extra,
        });
    }

    /**
     * Remove up to `count` harmful statuses from target. Returns the kinds
     * removed. Used by Lesser Restoration and similar cleanses.
     */
    cleanseStatuses(target, { count = 1 } = {}) {
        if (!target.statuses || target.statuses.length === 0) return [];
        const removed = [];
        const remaining = [];
        let cleansed = 0;
        for (const s of target.statuses) {
            if (cleansed < count && HARMFUL_STATUSES.has(s.kind)) {
                removed.push(s.kind);
                cleansed += 1;
            } else {
                remaining.push(s);
            }
        }
        target.statuses = remaining;
        return removed;
    }

    #pickPartyTarget() {
        const front = this.aliveParty().filter(p => p.rank === 'front');
        if (front.length > 0) return front[Math.floor(this.rng() * front.length)];
        const rear = this.aliveParty();
        return rear.length > 0 ? rear[Math.floor(this.rng() * rear.length)] : null;
    }
}
