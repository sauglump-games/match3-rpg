// Per ADR 0002: party uses EotB-style front/rear ranks. Color score from the
// match board fuels each role's action for the turn. Spells (sapphire/diamond)
// also require a prepared slot — the slot is the container, score is the fuel.

import { getSpell } from './spells.js';

export const ROLE_BY_COLOR = {
    ruby: 'warrior',
    sapphire: 'mage',
    emerald: 'druid',
    topaz: 'rogue',
    diamond: 'cleric',
    amethyst: 'summoner',
};

const SCORE_PER_DAMAGE = {
    ruby: 10,
    sapphire: 8,
    topaz: 10,
};
const SCORE_PER_HEAL = 12;
const SCORE_PER_SHIELD = 8;
const SCORE_PER_ULT_CHARGE = 15;
const ROGUE_CRIT_CHANCE = 0.3;
const ROGUE_CRIT_MULT = 2;

export const RESIST_MULT = 0.5;
export const WEAK_MULT = 1.5;
export const ULT_FULL = 100;
export const ULT_DAMAGE = 30;

export const MANA_REGEN_PER_TURN = 3;

export function makeHero({ id, name, role, rank, maxHp, ac = 10, maxMana = 0, level = 1 }) {
    return {
        id, name, role, rank, maxHp, hp: maxHp, ac, shield: 0, alive: true,
        maxMana, mana: maxMana,
        level, xp: 0,
    };
}

export function makeEnemy({
    id, name, maxHp, ac = 10, damage,
    resistances = [], weaknesses = [],
    intentRotation = null,
    xp = 30,
}) {
    const rotation = intentRotation ?? [{ kind: 'attack', amount: damage, label: 'Attack' }];
    return {
        id, name, maxHp, hp: maxHp, ac, damage,
        resistances, weaknesses,
        intentRotation: rotation,
        intentIndex: 0,
        shield: 0,
        defendBonus: 0,
        alive: true,
        xp,
    };
}

/** What the enemy will do on the next commit. */
export function currentIntent(enemy) {
    return enemy.intentRotation[enemy.intentIndex % enemy.intentRotation.length];
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

    /** Whether the named spell can be cast right now by the named hero. */
    canCastSpell(spellId, casterId) {
        const spell = getSpell(spellId);
        if (!spell) return false;
        const caster = this.party.find(p => p.id === casterId);
        if (!caster || !caster.alive) return false;
        if (caster.role !== spell.caster) return false;
        if (caster.level < spell.minLevel) return false;
        if (caster.mana < spell.cost) return false;
        return true;
    }

    /**
     * Cast a spell. Deducts mana, runs the spell's effect, returns
     * { events, status } or null if the cast was illegal/impossible.
     */
    castSpell(spellId, casterId) {
        if (!this.canCastSpell(spellId, casterId)) return null;
        const spell = getSpell(spellId);
        const caster = this.party.find(p => p.id === casterId);
        const events = spell.cast(this, caster);
        if (!events) return null;
        caster.mana -= spell.cost;
        events.unshift({ type: 'spell-cast', sourceId: caster.id, spellId, name: spell.name, cost: spell.cost });
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

        // Offensive actions: warrior (ruby), mage (sapphire), rogue (topaz).
        const target = this.aliveEnemies()[0];
        if (target) {
            const warrior = heroByRole('warrior');
            if (warrior && score.ruby > 0) {
                const dmg = Math.floor(score.ruby / SCORE_PER_DAMAGE.ruby);
                if (dmg > 0) this.#dealDamage(target, dmg, 'warrior', 'ruby', events);
            }

            if (target.alive && target.hp > 0) {
                const mage = heroByRole('mage');
                if (mage && score.sapphire > 0) {
                    const dmg = Math.floor(score.sapphire / SCORE_PER_DAMAGE.sapphire);
                    if (dmg > 0) this.#dealDamage(target, dmg, 'mage', 'sapphire', events);
                }
            }

            if (target.alive && target.hp > 0) {
                const rogue = heroByRole('rogue');
                if (rogue && score.topaz > 0) {
                    let dmg = Math.floor(score.topaz / SCORE_PER_DAMAGE.topaz);
                    const crit = this.rng() < ROGUE_CRIT_CHANCE;
                    if (crit) dmg *= ROGUE_CRIT_MULT;
                    if (dmg > 0) this.#dealDamage(target, dmg, 'rogue', 'topaz', events, { crit });
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
        for (const enemy of this.aliveEnemies()) {
            const intent = currentIntent(enemy);
            this.#executeIntent(enemy, intent, events);
            enemy.intentIndex = (enemy.intentIndex + 1) % enemy.intentRotation.length;
        }

        // Mana regen for casters at end of turn.
        for (const hero of this.aliveParty()) {
            if (hero.maxMana > 0 && hero.mana < hero.maxMana) {
                const before = hero.mana;
                hero.mana = Math.min(hero.maxMana, hero.mana + MANA_REGEN_PER_TURN);
                if (hero.mana > before) {
                    events.push({ type: 'mana-regen', targetId: hero.id, amount: hero.mana - before });
                }
            }
        }

        this.turn++;
        return { events, status: this.status() };
    }

    #executeIntent(enemy, intent, events) {
        switch (intent.kind) {
            case 'attack':
            case 'big-attack': {
                const tgt = this.#pickPartyTarget();
                if (!tgt) return;
                const roll = 1 + Math.floor(this.rng() * 20);
                const toHit = 20 - tgt.ac;
                if (roll < toHit) {
                    events.push({ type: 'enemy-miss', sourceId: enemy.id, targetId: tgt.id, roll, intent: intent.kind });
                    return;
                }
                const dmg = intent.amount ?? enemy.damage;
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

    // ----- public helpers used by the spell system -----

    dealSpellDamage(target, baseDmg, sourceRole, color, events, extra = {}) {
        this.#dealDamage(target, baseDmg, sourceRole, color, events, extra);
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

    #pickPartyTarget() {
        const front = this.aliveParty().filter(p => p.rank === 'front');
        if (front.length > 0) return front[Math.floor(this.rng() * front.length)];
        const rear = this.aliveParty();
        return rear.length > 0 ? rear[Math.floor(this.rng() * rear.length)] : null;
    }
}
