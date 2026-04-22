// Class features per rpg-fidelity-spec.md §2.1 (Phase 5):
//
//   - Turn Undead    (Cleric L1+, Paladin L3+ as Cleric-2): 2d6 check against
//                     a (clericLevel, undeadHD) diagonal. D = auto-destroy,
//                     T = auto-turn, otherwise roll. 1× per encounter.
//   - Lay on Hands   (Paladin): heals 2 HP × Paladin level to one ally.
//                     1× per adventuring day (refreshed at Camp).
//   - Shapechange    (Druid L7+): heal 1d6 × 10% of max HP on the druid.
//                     3× per day.
//   - Backstab       (Thief): damage ×2/×3/×4/×5 by level band. Wired into
//                     combat.js' rogue-attack branch (not here directly).
//
// This module is intentionally close to pure: the per-combat Turn-Undead
// gate is a `Set<heroId>` on the Encounter instance; per-day uses live on
// the hero as `hero.dailyUses = { max, used }`. Encounter integration is
// done via `tryTurnUndead / tryLayOnHands / tryShapechange` which call the
// encounter's public helpers (`applyStatus / applyHeal / destroyEnemy`).

// ---------------------------------------------------------------------------
// Turn Undead
// ---------------------------------------------------------------------------

// Delta = clericLevel - undeadHD. Spec: "at delta ≥ 4, auto-destroy; ≥ 2,
// auto-turn." Populated from the diagonal of the AD&D 2e PHB p.103 table.
// Target is the 2d6 roll needed when not auto-resolved.
export const TURN_UNDEAD_AUTO_DESTROY_DELTA = 4;
export const TURN_UNDEAD_AUTO_TURN_DELTA = 2;

const TURN_UNDEAD_ROLL_TARGET = {
    1: 4,
    0: 7,
    '-1': 10,
    '-2': 13,
    '-3': 16,
    '-4': 19,
    '-5': 20,
};

function rollTargetForDelta(delta) {
    return TURN_UNDEAD_ROLL_TARGET[String(delta)] ?? null;
}

/**
 * Resolve a Turn Undead attempt against a single undead target.
 * Returns one of:
 *   { kind: 'destroy', delta }
 *   { kind: 'turn',    delta, roll?, target? }
 *   { kind: 'fail',    delta, roll?, target?, reason? }
 */
export function turnUndeadOutcome({ clericLevel, undeadHD, rng }) {
    const delta = (clericLevel | 0) - (undeadHD | 0);
    if (delta >= TURN_UNDEAD_AUTO_DESTROY_DELTA) return { kind: 'destroy', delta };
    if (delta >= TURN_UNDEAD_AUTO_TURN_DELTA)    return { kind: 'turn', delta };
    const target = rollTargetForDelta(delta);
    if (target === null) return { kind: 'fail', delta, reason: 'too-strong' };
    const roll = (1 + Math.floor(rng() * 6)) + (1 + Math.floor(rng() * 6));
    return roll >= target
        ? { kind: 'turn', delta, roll, target }
        : { kind: 'fail', delta, roll, target };
}

/** The effective cleric-level a hero turns undead at. Paladin lags by 2. */
export function effectiveTurnLevel(hero) {
    if (!hero) return 0;
    if (hero.role === 'cleric') return hero.level | 0;
    if (hero.role === 'paladin') return Math.max(0, (hero.level | 0) - 2);
    return 0;
}

/** True if this class can turn undead at their current level. */
export function canTurnUndeadClass(hero) {
    if (hero.role === 'cleric') return (hero.level | 0) >= 1;
    if (hero.role === 'paladin') return (hero.level | 0) >= 3;
    return false;
}

// ---------------------------------------------------------------------------
// Backstab multiplier by thief level (spec §2.1).
// ---------------------------------------------------------------------------

export function backstabMultiplier(level) {
    const L = Math.max(1, level | 0);
    if (L >= 13) return 5;
    if (L >= 9)  return 4;
    if (L >= 5)  return 3;
    return 2;
}

// ---------------------------------------------------------------------------
// Extra attacks per round (spec §2.1 "Attacks per round"). Warriors
// (Fighter/Paladin/Ranger) get 3/2 attacks at L7-12 and 2/1 at L13+. The
// 3/2 band alternates 2-1-2-1... using the encounter's turn counter so
// numerically it averages to 1.5 attacks/round.
// ---------------------------------------------------------------------------

const WARRIOR_MELEE_ROLES = new Set(['warrior', 'fighter', 'paladin', 'ranger']);

export function baseMeleeAttacks(role, level, turn = 0) {
    if (!WARRIOR_MELEE_ROLES.has(role)) return 1;
    const L = level | 0;
    if (L >= 13) return 2;
    if (L >= 7)  return ((turn | 0) % 2 === 0) ? 2 : 1;
    return 1;
}

// "Lightly armored" for Ranger two-weapon (spec §2.1: ≤ studded leather,
// armorBonus 2). Rangers wearing anything heavier lose the offhand attack.
export const RANGER_LIGHT_ARMOR_CAP = 2;

export function rangerTwoWeaponBonus(hero, armorBonus) {
    if (hero?.role !== 'ranger') return 0;
    if ((armorBonus | 0) > RANGER_LIGHT_ARMOR_CAP) return 0;
    return 1;
}

/**
 * Total melee swings this turn = level-based base + ranger offhand. Callers
 * pass the encounter turn counter (for the 3/2 alternation) and the hero's
 * armorBonus (for two-weapon's armor gate).
 */
export function meleeAttacksThisTurn(hero, turn, armorBonus) {
    return baseMeleeAttacks(hero.role, hero.level, turn) + rangerTwoWeaponBonus(hero, armorBonus);
}

// ---------------------------------------------------------------------------
// Per-day usage pool (Lay on Hands, Shapechange).
// ---------------------------------------------------------------------------

/**
 * Max uses per adventuring day, by class/level.
 * - Paladin: 1 Lay on Hands at any level.
 * - Druid L7+: 3 Shapechange.
 */
export function maxDailyUses(role, level) {
    const L = level | 0;
    const out = {};
    if (role === 'paladin') out.layOnHands = 1;
    if (role === 'druid' && L >= 7) out.shapechange = 3;
    return out;
}

/** A fresh daily-use state at full capacity. */
export function freshDailyUses(role, level) {
    const max = maxDailyUses(role, level);
    const used = {};
    for (const k of Object.keys(max)) used[k] = 0;
    return { max, used };
}

export function dailyUsesRemaining(hero, key) {
    const max  = hero?.dailyUses?.max?.[key]  ?? 0;
    const used = hero?.dailyUses?.used?.[key] ?? 0;
    return Math.max(0, max - used);
}

export function consumeDailyUse(hero, key) {
    if (dailyUsesRemaining(hero, key) <= 0) return false;
    hero.dailyUses.used[key] = (hero.dailyUses.used[key] ?? 0) + 1;
    return true;
}

/** Reset every hero's daily-use counters (Camp). */
export function refreshDailyUses(hero) {
    if (!hero?.dailyUses?.used) return;
    for (const k of Object.keys(hero.dailyUses.used)) hero.dailyUses.used[k] = 0;
}

/**
 * Recompute the max table after a level-up. Preserves existing `used`
 * counts where still meaningful; prunes abilities the hero no longer has;
 * zero-initializes newly-unlocked abilities.
 */
export function recomputeDailyMax(hero) {
    const max = maxDailyUses(hero.role, hero.level);
    hero.dailyUses ??= { max: {}, used: {} };
    hero.dailyUses.max = max;
    for (const k of Object.keys(max)) {
        if (!(k in hero.dailyUses.used)) hero.dailyUses.used[k] = 0;
    }
    for (const k of Object.keys(hero.dailyUses.used)) {
        if (!(k in max)) delete hero.dailyUses.used[k];
    }
    return hero.dailyUses;
}

/**
 * Normalize a saved dailyUses block. Drops keys the class no longer grants,
 * fills missing ones. Used by save-schema.js on hydrate.
 */
export function normalizeDailyUses(raw, role, level) {
    const fresh = freshDailyUses(role, level);
    if (!raw || typeof raw !== 'object') return fresh;
    const out = { max: { ...fresh.max }, used: { ...fresh.used } };
    if (raw.used && typeof raw.used === 'object') {
        for (const [k, v] of Object.entries(raw.used)) {
            if (k in out.max && Number.isFinite(v)) {
                out.used[k] = Math.max(0, Math.min(out.max[k], Math.floor(v)));
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Undead tagging (so Turn Undead knows who to target).
// ---------------------------------------------------------------------------

/**
 * Monsters flagged undead in the bestiary. Turn Undead, Cleric's bonus-damage
 * auras, and Paladin evil-radiant immunities all key off `enemy.undead` set
 * at factory time — but legacy saves may not carry the flag, so we keep an
 * id-based fallback here.
 */
export const UNDEAD_MONSTER_IDS = new Set([
    'skeleton', 'skeleton-archer', 'zombie',
    'ghoul', 'specter', 'wraith', 'mummy', 'wight',
    'lich-king', 'phylactery',
    'death-knight', 'vampire-lord', 'vampire-spawn',
]);

export function isUndead(enemy) {
    if (!enemy) return false;
    if (enemy.undead === true) return true;
    if (enemy.monsterId && UNDEAD_MONSTER_IDS.has(enemy.monsterId)) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Encounter integrations. Each returns an events array or null on refuse.
// ---------------------------------------------------------------------------

/** Approx. Hit Dice used by Turn Undead math (one HD ≈ 8 HP). */
function estimateHD(enemy) {
    return Math.max(1, Math.round((enemy.maxHp ?? 1) / 8));
}

/**
 * Attempt to turn all undead in the encounter. One use per cleric/paladin
 * per combat — the Encounter instance tracks who's already used it.
 * Returns events (possibly empty) or null if the feature is unavailable.
 */
export function tryTurnUndead(encounter, hero) {
    if (!hero?.alive) return null;
    if (!canTurnUndeadClass(hero)) return null;
    encounter._turnUndeadUsed ??= new Set();
    if (encounter._turnUndeadUsed.has(hero.id)) return null;

    const events = [{ type: 'turn-undead-start', sourceId: hero.id, level: effectiveTurnLevel(hero) }];
    const undead = encounter.aliveEnemies().filter(isUndead);
    encounter._turnUndeadUsed.add(hero.id);
    if (undead.length === 0) {
        events.push({ type: 'turn-undead-no-targets', sourceId: hero.id });
        return events;
    }
    const lvl = effectiveTurnLevel(hero);
    for (const target of undead) {
        const hd = estimateHD(target);
        const outcome = turnUndeadOutcome({ clericLevel: lvl, undeadHD: hd, rng: encounter.rng });
        if (outcome.kind === 'destroy') {
            encounter.destroyEnemy(target, 'turn-undead', events, {
                sourceId: hero.id, delta: outcome.delta,
            });
            events.push({
                type: 'turn-undead-result', sourceId: hero.id, targetId: target.id,
                outcome: 'destroy', delta: outcome.delta,
            });
        } else if (outcome.kind === 'turn') {
            encounter.applyStatus(target, { kind: 'stun', duration: 3 }, events, {
                sourceId: hero.id, source: 'turn-undead',
            });
            events.push({
                type: 'turn-undead-result', sourceId: hero.id, targetId: target.id,
                outcome: 'turn', delta: outcome.delta,
                roll: outcome.roll ?? null, target: outcome.target ?? null,
            });
        } else {
            events.push({
                type: 'turn-undead-result', sourceId: hero.id, targetId: target.id,
                outcome: 'fail', delta: outcome.delta, reason: outcome.reason ?? null,
                roll: outcome.roll ?? null, target: outcome.target ?? null,
            });
        }
    }
    return events;
}

/**
 * Paladin Lay on Hands: heal 2 × level to one ally. Consumes 1 daily use.
 * Returns events or null when unavailable.
 */
export function tryLayOnHands(encounter, hero, targetId) {
    if (!hero?.alive || hero.role !== 'paladin') return null;
    if (dailyUsesRemaining(hero, 'layOnHands') <= 0) return null;
    const target = encounter.party.find(p => p.id === targetId);
    if (!target?.alive) return null;
    consumeDailyUse(hero, 'layOnHands');
    const heal = 2 * (hero.level | 0);
    const events = [{ type: 'lay-on-hands', sourceId: hero.id, targetId: target.id, heal }];
    encounter.applyHeal(target, heal, 'paladin', events, { ability: 'lay-on-hands' });
    return events;
}

/**
 * Druid Shapechange: heal 1d6 × 10% of max HP to the druid. Consumes a
 * daily use. Gated at L7 per spec.
 */
export function tryShapechange(encounter, hero) {
    if (!hero?.alive || hero.role !== 'druid') return null;
    if ((hero.level | 0) < 7) return null;
    if (dailyUsesRemaining(hero, 'shapechange') <= 0) return null;
    consumeDailyUse(hero, 'shapechange');
    const d6 = 1 + Math.floor(encounter.rng() * 6);
    const heal = Math.max(1, Math.floor((hero.maxHp ?? 1) * 0.1 * d6));
    const events = [{ type: 'shapechange', sourceId: hero.id, d6, heal }];
    encounter.applyHeal(hero, heal, 'druid', events, { ability: 'shapechange' });
    return events;
}
