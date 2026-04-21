import { NODE_GLYPH, NODE_LABEL } from './map.js';
import { projectedAction, COLOR_BY_ROLE } from './combat.js';
import {
    ABILITIES, ABILITY_LABEL,
    strHitMod, strDamageMod,
    dexAcAdj, dexMissileMod,
    conHpMod,
    wisMagicDefenseMod,
    primeRequisiteXpMultiplier, PRIME_REQUISITES,
} from './abilities.js';
import { isCasterRole } from './spell-slots.js';
import { casterColor } from './spells.js';
import { SAVE_CATEGORIES, SAVE_LABEL } from './saves.js';
import {
    ELEMENTS, GRADES, getElement, stashCount,
    canCraftUpgrade, CRAFT_RATIO, totalStashSize,
} from './elements.js';
import {
    allPotions, getPotion, canCraftPotion,
} from './potions.js';

const ELEMENT_GLYPH = {
    fire: '🔥', water: '💧', earth: '🪨', air: '🌬️', aether: '✨',
    salt: '🧂', sulfur: '🜍', mercury: '☿', ice: '❄️', lightning: '⚡',
    shadow: '🌑', light: '🌞', blood: '🩸', bone: '🦴',
    moonstone: '🌙', starlight: '⭐',
};

export const COLOR_GLYPH = {
    ruby: '🔴',
    sapphire: '🔵',
    emerald: '🟢',
    topaz: '🟡',
    diamond: '⚪',
    amethyst: '🟣',
};

const ROLE_GLYPH = {
    warrior: '⚔️',
    cleric: '✨',
    mage: '🔮',
    rogue: '🗡️',
    druid: '🌿',
    summoner: '👁️',
};

export function renderBoard(boardEl, snapshot, selected, opts = {}) {
    const matching = opts.matching instanceof Set ? opts.matching : new Set();
    const falling = opts.falling instanceof Set ? opts.falling : new Set();
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = `repeat(${snapshot[0].length}, 1fr)`;
    boardEl.style.gridTemplateRows    = `repeat(${snapshot.length}, 1fr)`;
    snapshot.forEach((row, r) => {
        row.forEach((gem, c) => {
            const key = `${r},${c}`;
            const cell = document.createElement('button');
            cell.className = 'gem';
            cell.dataset.r = r;
            cell.dataset.c = c;
            cell.dataset.color = gem.color;
            cell.textContent = COLOR_GLYPH[gem.color] ?? '?';
            if (gem.special === 'flame') cell.classList.add('special-flame');
            if (gem.special === 'hypercube') cell.classList.add('special-hypercube');
            if (selected && selected.r === r && selected.c === c) {
                cell.classList.add('selected');
            }
            if (matching.has(key)) cell.classList.add('matching');
            if (falling.has(key)) cell.classList.add('falling');
            boardEl.appendChild(cell);
        });
    });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CASCADE_PULSE_MS = 240;
const CASCADE_DROP_MS = 260;
const CASCADE_BETWEEN_MS = 60;

const FLOAT_LIFETIME_MS = 1100;
const FLOAT_STAGGER_MS  = 90;

// ----- screen shake -----

const SHAKE_CLASSES = ['shake-sm', 'shake-md', 'shake-lg'];

export function shakeScreen(intensity = 1, target) {
    const el = target ?? document.querySelector('.center-stage') ?? document.body;
    if (!el) return;
    el.classList.remove(...SHAKE_CLASSES);
    // Force reflow so the animation actually restarts on repeat triggers.
    void el.offsetWidth;
    const cls = intensity >= 3 ? 'shake-lg' : intensity >= 2 ? 'shake-md' : 'shake-sm';
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 520);
}

// ----- floating numbers -----

function ensureFloatLayer() {
    let layer = document.getElementById('float-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'float-layer';
        layer.className = 'float-layer';
        document.body.appendChild(layer);
    }
    return layer;
}

export function popFloat({ x, y, text, classes = '' }) {
    const layer = ensureFloatLayer();
    const el = document.createElement('div');
    el.className = `float ${classes}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), FLOAT_LIFETIME_MS);
}

function actorAnchor(id) {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // A bit jitter so stacked floats don't perfectly overlap.
    const jitter = (Math.random() - 0.5) * 24;
    return { x: r.left + r.width / 2 + jitter, y: r.top + r.height * 0.25 };
}

function centerOfStage() {
    const el = document.querySelector('.center-stage') ?? document.body;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.3 };
}

function popEventFloat(ev) {
    switch (ev.type) {
        case 'damage': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor) return;
            const classes = ['float-damage'];
            if (ev.crit) classes.push('crit');
            if (ev.modifier === 'weak') classes.push('weak');
            else if (ev.modifier === 'resist') classes.push('resist');
            else if (ev.modifier === 'true') classes.push('true');
            const tag = ev.crit ? ' CRIT' : ev.modifier === 'weak' ? ' WEAK' : ev.modifier === 'resist' ? ' resist' : '';
            popFloat({ x: anchor.x, y: anchor.y, text: `−${ev.amount}${tag}`, classes: classes.join(' ') });
            return;
        }
        case 'heal': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor || ev.amount <= 0) return;
            popFloat({ x: anchor.x, y: anchor.y, text: `+${ev.amount}`, classes: 'float-heal' });
            return;
        }
        case 'shield': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor || ev.amount <= 0) return;
            popFloat({ x: anchor.x, y: anchor.y, text: `+${ev.amount} 🛡`, classes: 'float-shield' });
            return;
        }
        case 'enemy-attack': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor) return;
            const big = ev.intent === 'big-attack';
            const cls = big ? 'float-damage big' : 'float-damage';
            const text = ev.amount > 0 ? `−${ev.amount}` : 'BLOCKED';
            popFloat({ x: anchor.x, y: anchor.y, text, classes: cls });
            if (ev.absorbed > 0 && ev.amount > 0) {
                popFloat({ x: anchor.x, y: anchor.y + 18, text: `(${ev.absorbed} 🛡)`, classes: 'float-shield small' });
            } else if (ev.absorbed > 0) {
                popFloat({ x: anchor.x, y: anchor.y, text: `BLOCKED ${ev.absorbed}🛡`, classes: 'float-shield' });
            }
            return;
        }
        case 'enemy-miss': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor) return;
            popFloat({ x: anchor.x, y: anchor.y, text: 'MISS', classes: 'float-miss' });
            return;
        }
        case 'enemy-defend': {
            const anchor = actorAnchor(ev.sourceId);
            if (!anchor) return;
            popFloat({ x: anchor.x, y: anchor.y, text: `+${ev.amount} 🛡`, classes: 'float-shield' });
            return;
        }
        case 'enemy-summon': {
            const anchor = actorAnchor(ev.sourceId);
            if (!anchor) return;
            popFloat({ x: anchor.x, y: anchor.y, text: '✨ SUMMON', classes: 'float-summon' });
            return;
        }
        case 'meter': {
            // Subtle: small purple "+N" at the ult meter.
            const meter = document.getElementById('ult-meter');
            if (!meter) return;
            const r = meter.getBoundingClientRect();
            popFloat({ x: r.left + r.width / 2, y: r.top, text: `+${ev.amount}`, classes: 'float-meter small' });
            return;
        }
        case 'ult-cast': {
            const c = centerOfStage();
            popFloat({ x: c.x, y: c.y, text: 'ULTIMATE!', classes: 'float-ult' });
            return;
        }
        case 'spell-cast': {
            const anchor = actorAnchor(ev.sourceId);
            if (!anchor) return;
            popFloat({ x: anchor.x, y: anchor.y, text: `🪄 ${ev.name}`, classes: 'float-spell' });
            return;
        }
        case 'attack-miss': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor) return;
            popFloat({ x: anchor.x, y: anchor.y, text: 'MISS', classes: 'float-miss' });
            return;
        }
        case 'save': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor) return;
            const text = ev.saved ? 'SAVED' : 'FAIL';
            const cls = ev.saved ? 'float-save' : 'float-save-fail';
            popFloat({ x: anchor.x, y: anchor.y, text, classes: cls });
            return;
        }
        case 'xp-gain': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor) return;
            popFloat({ x: anchor.x, y: anchor.y, text: `+${ev.amount} XP`, classes: 'float-xp' });
            return;
        }
        case 'level-up': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor) return;
            popFloat({ x: anchor.x, y: anchor.y, text: `LEVEL ${ev.level}!`, classes: 'float-levelup' });
            return;
        }
        case 'status-applied': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor) return;
            const label = (ev.kind ?? '').toUpperCase();
            popFloat({ x: anchor.x, y: anchor.y, text: label, classes: `float-status status-${ev.kind}` });
            return;
        }
        case 'status-tick': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor) return;
            popFloat({ x: anchor.x, y: anchor.y, text: `−${ev.amount} (${ev.kind})`, classes: `float-status-tick status-${ev.kind}` });
            return;
        }
        case 'status-cleansed': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor) return;
            popFloat({ x: anchor.x, y: anchor.y, text: 'CLEANSED', classes: 'float-cleanse' });
            return;
        }
        case 'status-skip': {
            const anchor = actorAnchor(ev.sourceId);
            if (!anchor) return;
            popFloat({ x: anchor.x, y: anchor.y, text: 'STUNNED', classes: 'float-status status-stun' });
            return;
        }
        default:
            return;
    }
}

/**
 * Pop floating numbers for a list of combat events, staggered in time.
 * Also triggers screen shake on big hits and ultimate.
 */
export function playEventFloats(events) {
    let delay = 0;
    let didShake = false;
    for (const ev of events) {
        const evCapture = ev;
        setTimeout(() => popEventFloat(evCapture), delay);
        if (!didShake) {
            if (ev.type === 'ult-cast') {
                setTimeout(() => shakeScreen(3), delay);
                didShake = true;
            } else if (ev.type === 'enemy-attack' && ev.intent === 'big-attack') {
                setTimeout(() => shakeScreen(2), delay);
                didShake = true;
            }
        }
        delay += FLOAT_STAGGER_MS;
    }
}

/**
 * Compute the set of cells that need a "drop-in" animation after collapse.
 *
 * For each column, every row from 0 down to (and including) the lowest cleared
 * row in that column ends up with new content — either a gem that fell from
 * above or a refill spawned at the top. Rows below the lowest cleared row in
 * that column are unchanged and should not animate.
 */
function expandFallingSet(clearedCells, cols) {
    const lowestPerCol = new Array(cols).fill(-1);
    for (const key of clearedCells) {
        const [r, c] = key.split(',').map(Number);
        if (r > lowestPerCol[c]) lowestPerCol[c] = r;
    }
    const falling = new Set();
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r <= lowestPerCol[c]; r++) {
            falling.add(`${r},${c}`);
        }
    }
    return falling;
}

/**
 * Play a cascade visually: for each step, pulse out the cleared cells, then
 * render the post-collapse state with falling-in animation on every cell whose
 * content moved or was newly spawned.
 */
export async function playCascadeAnimation(boardEl, cascades, finalSnapshot) {
    for (const step of cascades) {
        const cols = step.preSnapshot[0].length;
        const cleared = new Set(step.clearedCells);
        const falling = expandFallingSet(step.clearedCells, cols);
        renderBoard(boardEl, step.preSnapshot, null, { matching: cleared });
        // Shake on chains 3+ (escalating intensity)
        if (step.chain >= 3) {
            shakeScreen(step.chain >= 5 ? 3 : step.chain >= 4 ? 2 : 1, boardEl.parentElement);
        }
        await sleep(CASCADE_PULSE_MS);
        renderBoard(boardEl, step.postSnapshot, null, { falling });
        await sleep(CASCADE_DROP_MS);
        if (cascades.length > 1) await sleep(CASCADE_BETWEEN_MS);
    }
    renderBoard(boardEl, finalSnapshot, null);
}

const STATUS_GLYPH = {
    poison: '☠',
    stun:   '⚡',
    curse:  '✗',
    bless:  '✦',
};

function renderStatuses(statuses) {
    if (!statuses || statuses.length === 0) return '';
    const items = statuses.map(s => `
        <span class="status-chip status-${s.kind}" title="${s.kind}${s.duration ? ` (${s.duration}t)` : ''}${s.severity ? `, sev ${s.severity}` : ''}">
            ${STATUS_GLYPH[s.kind] ?? '?'}<span class="status-duration">${s.duration ?? ''}</span>
        </span>
    `).join('');
    return `<div class="status-row">${items}</div>`;
}

function renderLoadedRow(hero, scoreByColor) {
    const p = projectedAction(hero, scoreByColor);
    if (!p) return '';
    const glyph = COLOR_GLYPH[p.color] ?? '?';
    if (p.score <= 0) {
        return `<div class="hero-loaded color-${p.color} empty">${glyph} <span class="dim">no fuel</span></div>`;
    }
    let outcome;
    switch (p.kind) {
        case 'damage': outcome = `→ <strong>${p.amount}</strong> dmg`; break;
        case 'heal':   outcome = `→ <strong>+${p.amount}</strong> heal`; break;
        case 'shield': outcome = `→ <strong>+${p.amount}</strong> 🛡`; break;
        case 'charge': outcome = `→ <strong>+${p.amount}</strong> ult`; break;
        default:       outcome = '';
    }
    return `<div class="hero-loaded color-${p.color}">${glyph} <span class="loaded-score">${p.score}</span> ${outcome}</div>`;
}

function renderHpBar(current, max) {
    const pct = Math.max(0, Math.min(100, (current / max) * 100));
    return `
        <div class="hp-bar">
            <div class="hp-bar-fill" style="width: ${pct}%"></div>
            <span class="hp-bar-text">${current}/${max}</span>
        </div>
    `;
}

/**
 * Render the hero's prepared-spell-slot budget as a row of small chips,
 * one chip per spell level the caster has access to. Greyed portion = used.
 * Non-casters render nothing. (Phase 2: replaces the MP bar.)
 */
function renderSlotChips(hero) {
    if (!isCasterRole(hero.role) || !hero.slots?.max) return '';
    const levels = Object.keys(hero.slots.max)
        .map(Number)
        .filter(l => (hero.slots.max[l] ?? 0) > 0)
        .sort((a, b) => a - b);
    if (levels.length === 0) return '';
    const chips = levels.map(lvl => {
        const max = hero.slots.max[lvl] ?? 0;
        const used = hero.slots.used[lvl] ?? 0;
        const remaining = Math.max(0, max - used);
        const cls = remaining === 0 ? 'slot-chip empty' : 'slot-chip';
        return `<span class="${cls}" title="Level ${lvl} spell slots: ${remaining}/${max}">
            <span class="slot-chip-lvl">L${lvl}</span>
            <span class="slot-chip-count">${remaining}/${max}</span>
        </span>`;
    }).join('');
    return `<div class="slot-chips">${chips}</div>`;
}

export function renderParty(partyEl, party, { onHeroClick, scoreByColor = {}, justReceived = null } = {}) {
    partyEl.innerHTML = '';
    for (const hero of party) {
        const card = document.createElement('div');
        const heroColor = COLOR_BY_ROLE[hero.role];
        const pulsing = hero.alive && justReceived && heroColor && justReceived.has(heroColor);
        card.className = `hero-card rank-${hero.rank}`
            + (hero.alive ? '' : ' dead')
            + (pulsing ? ' just-received' : '');
        card.dataset.id = hero.id;
        card.innerHTML = `
            <div class="hero-header">
                <span class="hero-glyph">${ROLE_GLYPH[hero.role] ?? '?'}</span>
                <span class="hero-name">${hero.name}</span>
                <span class="hero-level">L${hero.level ?? 1}</span>
                <span class="hero-rank">${hero.rank === 'front' ? 'F' : 'R'}</span>
            </div>
            <div class="hero-stats">
                ${renderHpBar(hero.hp, hero.maxHp)}
                ${renderSlotChips(hero)}
                ${hero.shield > 0 ? `<div class="shield">🛡 ${hero.shield}</div>` : ''}
                ${renderStatuses(hero.statuses)}
                ${hero.alive ? renderLoadedRow(hero, scoreByColor) : ''}
            </div>
        `;
        if (onHeroClick) {
            card.classList.add('clickable');
            card.addEventListener('click', () => onHeroClick(hero.id));
        }
        partyEl.appendChild(card);
    }
}

function intentLabel(intent) {
    if (!intent) return 'Waiting…';
    switch (intent.kind) {
        case 'attack':      return `${intent.label ?? 'Attack'} (${intent.amount} dmg)`;
        case 'big-attack':  return `⚠ ${intent.label ?? 'Big Strike'} (${intent.amount} dmg)`;
        case 'defend':      return `🛡 ${intent.label ?? 'Defend'} (+${intent.amount ?? 8} shield)`;
        case 'summon':      return `✨ ${intent.label ?? 'Summon'}`;
        default:            return intent.label ?? intent.kind;
    }
}

function resistChips(enemy) {
    const chips = [];
    for (const c of enemy.weaknesses ?? []) chips.push(`<span class="chip weak" title="Weak to ${c}">${COLOR_GLYPH[c] ?? c}↑</span>`);
    for (const c of enemy.resistances ?? []) chips.push(`<span class="chip resist" title="Resists ${c}">${COLOR_GLYPH[c] ?? c}↓</span>`);
    return chips.length ? `<div class="enemy-chips">${chips.join('')}</div>` : '';
}

export function renderEnemies(enemyEl, enemies, { boss = false } = {}) {
    enemyEl.innerHTML = '';
    for (const enemy of enemies) {
        const card = document.createElement('div');
        card.className = 'enemy-card' + (enemy.alive ? '' : ' dead') + (boss ? ' boss' : '');
        card.dataset.id = enemy.id;
        const intent = enemy.intentRotation?.[enemy.intentIndex % enemy.intentRotation.length];
        const intentClass = intent?.kind === 'big-attack' ? 'intent big' :
                            intent?.kind === 'defend' ? 'intent defend' :
                            intent?.kind === 'summon' ? 'intent summon' : 'intent';
        card.innerHTML = `
            <div class="enemy-name">${enemy.name}</div>
            ${renderHpBar(enemy.hp, enemy.maxHp)}
            ${enemy.shield > 0 ? `<div class="shield">🛡 ${enemy.shield}</div>` : ''}
            ${renderStatuses(enemy.statuses)}
            ${resistChips(enemy)}
            <div class="${intentClass}">${enemy.alive ? intentLabel(intent) : '—'}</div>
        `;
        enemyEl.appendChild(card);
    }
}

/**
 * Render the spell tray (below the combat board). Each caster gets one
 * group; each spell in that group shows its slot cost and color-score cost,
 * both of which must be payable for the button to enable.
 */
export function renderSpellTray(trayEl, party, { canCast, onCast }) {
    trayEl.innerHTML = '';
    const casters = party.filter(p => isCasterRole(p.role) && p.alive);
    if (casters.length === 0) {
        trayEl.classList.add('empty');
        trayEl.textContent = '';
        return;
    }
    trayEl.classList.remove('empty');
    for (const hero of casters) {
        const group = document.createElement('div');
        group.className = 'spell-group';
        const color = casterColor(hero.role);
        const colorGlyph = color ? (COLOR_GLYPH[color] ?? color) : '';
        const slotSummary = Object.keys(hero.slots?.max ?? {})
            .map(Number).sort((a, b) => a - b)
            .map(lvl => `L${lvl}:${Math.max(0, (hero.slots.max[lvl] ?? 0) - (hero.slots.used[lvl] ?? 0))}`)
            .join(' · ');
        group.innerHTML = `<div class="spell-group-header">${hero.name} (L${hero.level}${slotSummary ? ' · ' + slotSummary : ''})</div>`;
        const list = document.createElement('div');
        list.className = 'spell-list';
        for (const spell of hero._spells ?? []) {
            const btn = document.createElement('button');
            btn.className = 'spell-btn';
            btn.title = spell.description;
            btn.dataset.spellId = spell.id;
            btn.dataset.casterId = hero.id;
            btn.innerHTML = `
                <span class="spell-name">${spell.name}</span>
                <span class="spell-cost">1× L${spell.spellLevel} · ${spell.scoreCost}${colorGlyph}</span>
            `;
            btn.disabled = !canCast(spell.id, hero.id);
            btn.addEventListener('click', () => onCast(spell.id, hero.id));
            list.appendChild(btn);
        }
        group.appendChild(list);
        trayEl.appendChild(group);
    }
}

function renderItemBonuses(item) {
    const b = item.bonuses ?? {};
    const parts = [];
    if (b.damageBonus) parts.push(`+${b.damageBonus} dmg`);
    if (b.armorBonus)  parts.push(`+${b.armorBonus} armor`);
    if (b.maxHpBonus)  parts.push(`+${b.maxHpBonus} HP`);
    if (b.bonusSpellSlots) {
        for (const [lvl, n] of Object.entries(b.bonusSpellSlots)) {
            if (n > 0) parts.push(`+${n} L${lvl} slot${n > 1 ? 's' : ''}`);
        }
    }
    return parts.join(', ');
}

function formatMod(n) {
    if (n === 0) return '±0';
    return n > 0 ? `+${n}` : `${n}`;
}

/**
 * Render the five AD&D saving-throw targets. Lower is better — the hero
 * must roll ≥ target on a d20 to save. Full category labels ship in the
 * `title` attribute for tooltip disambiguation.
 */
function renderSaveBlock(hero) {
    const saves = hero.saves ?? {};
    const cells = SAVE_CATEGORIES.map(cat => `
        <div class="save-cell" title="${SAVE_LABEL[cat]}">
            <div class="save-label">${cat.toUpperCase()}</div>
            <div class="save-target">${saves[cat] ?? '—'}</div>
        </div>
    `).join('');
    return `<div class="save-grid">${cells}</div>`;
}

/**
 * Render the six ability scores with per-ability modifier hints so the
 * player can see what STR/DEX/CON/INT/WIS/CHA are actually doing.
 * Prime-requisite abilities are marked with a small star; if every prime
 * is >=16 the XP bonus is surfaced explicitly.
 */
function renderAbilityBlock(hero) {
    const abilities = hero.abilities ?? {};
    const primes = new Set(PRIME_REQUISITES[hero.role] ?? []);
    const hints = {
        str: (s) => `hit ${formatMod(strHitMod(s))} / dmg ${formatMod(strDamageMod(s))}`,
        dex: (s) => `AC ${formatMod(-dexAcAdj(s))} / missile ${formatMod(dexMissileMod(s))}`,
        con: (s) => `HP ${formatMod(conHpMod(s, hero.role))} / die`,
        int: () => 'spell learning',
        wis: (s) => `save vs. spell ${formatMod(wisMagicDefenseMod(s))}`,
        cha: () => 'henchmen / reaction',
    };
    const cells = ABILITIES.map(a => {
        const score = abilities[a] ?? 11;
        const starred = primes.has(a) ? ' ★' : '';
        return `<div class="ability-cell${primes.has(a) ? ' prime' : ''}">
            <div class="ability-label">${ABILITY_LABEL[a]}${starred}</div>
            <div class="ability-score">${score}</div>
            <div class="ability-hint">${hints[a](score)}</div>
        </div>`;
    }).join('');
    const xpMult = primeRequisiteXpMultiplier(hero.role, abilities);
    const bonusLine = xpMult > 1
        ? `<div class="ability-bonus">★ Prime requisite met — +${Math.round((xpMult - 1) * 100)}% XP</div>`
        : '';
    return `<div class="ability-grid">${cells}</div>${bonusLine}`;
}

export function renderCharacterSheet(overlayEl, hero, { onClose, onEquip, onUnequip, canEquipItem }) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const sheet = document.createElement('div');
    sheet.className = 'rest-panel character-sheet';
    const next = hero._xpForNext ?? null;
    const xpLine = next == null
        ? `<div>XP: ${hero.xp} (max level)</div>`
        : `<div>XP: ${hero.xp} / ${next}</div>`;
    const spells = hero._spells ?? [];
    const color = casterColor(hero.role);
    const colorGlyph = color ? (COLOR_GLYPH[color] ?? color) : '';
    const spellsHtml = spells.length === 0
        ? '<div class="char-sheet-none">No spells.</div>'
        : `<ul class="char-sheet-spells">${spells.map(s => `
            <li><strong>${s.name}</strong> <span class="dim">(L${s.spellLevel}, ${s.scoreCost}${colorGlyph})</span> — ${s.description}</li>
        `).join('')}</ul>`;
    const slotsHtml = isCasterRole(hero.role) ? renderSlotChips(hero) : '';

    const eq = hero.equipment ?? {};
    const slotRow = (slot) => {
        const item = eq[slot];
        if (!item) return `
            <div class="equip-slot empty">
                <span class="equip-slot-name">${slot}</span>
                <span class="equip-slot-item">— empty —</span>
            </div>`;
        return `
            <div class="equip-slot">
                <span class="equip-slot-name">${slot}</span>
                <span class="equip-slot-item">${item.name} <span class="dim">(${renderItemBonuses(item)})</span></span>
                <button class="equip-action" data-action="unequip" data-slot="${slot}">Unequip</button>
            </div>`;
    };

    const inv = hero.inventory ?? [];
    const cap = hero.inventoryCapacity ?? 0;
    const invHtml = inv.length === 0
        ? '<div class="char-sheet-none">Inventory empty.</div>'
        : `<ul class="char-sheet-inventory">${inv.map(item => {
            const allowed = canEquipItem ? canEquipItem(hero, item) : true;
            return `<li>
                <strong>${item.name}</strong>
                <span class="dim">(${item.slot}, ${renderItemBonuses(item)})</span>
                <button class="equip-action" data-action="equip" data-item="${item.id}" ${allowed ? '' : 'disabled'}>${allowed ? 'Equip' : 'Class restricted'}</button>
            </li>`;
        }).join('')}</ul>`;

    const abilitiesHtml = renderAbilityBlock(hero);
    // Compact header tagline: class / rank / level with a single thin strip of
    // core stats underneath. The old 2-col stats grid had too much vertical
    // padding for the now 8-section sheet.
    const xpText = next == null ? `${hero.xp} (max)` : `${hero.xp}/${next}`;
    const statStrip = [
        `HP <strong>${hero.hp}/${hero.maxHp}</strong>`,
        `AC <strong>${hero.ac}</strong>`,
        typeof hero.thac0 === 'number' ? `THAC0 <strong>${hero.thac0}</strong>` : null,
        hero.shield > 0 ? `Shield <strong>${hero.shield}</strong>` : null,
        `XP <strong>${xpText}</strong>`,
    ].filter(Boolean).join(' · ');

    const isCaster = isCasterRole(hero.role);
    const tabsHtml = `
        <nav class="char-sheet-tabs" role="tablist">
            <button class="char-sheet-tab-btn active" data-target="stats" role="tab">Stats</button>
            ${isCaster ? '<button class="char-sheet-tab-btn" data-target="spells" role="tab">Spells</button>' : ''}
            <button class="char-sheet-tab-btn" data-target="gear" role="tab">Gear</button>
        </nav>
    `;

    const statsTab = `
        <div class="char-sheet-tab active" data-tab="stats">
            <h3 class="char-sheet-section">Abilities</h3>
            ${abilitiesHtml}
            ${hero.saves ? `<h3 class="char-sheet-section">Saving Throws</h3>${renderSaveBlock(hero)}` : ''}
        </div>
    `;

    const spellsTab = isCaster ? `
        <div class="char-sheet-tab" data-tab="spells">
            ${slotsHtml ? `<h3 class="char-sheet-section">Spell Slots</h3>${slotsHtml}` : ''}
            <h3 class="char-sheet-section">Spells</h3>
            ${spellsHtml}
        </div>
    ` : '';

    const gearTab = `
        <div class="char-sheet-tab" data-tab="gear">
            <h3 class="char-sheet-section">Equipment</h3>
            <div class="equip-slots">
                ${['weapon', 'armor', 'shield', 'accessory'].map(slotRow).join('')}
            </div>
            <h3 class="char-sheet-section">Inventory (${inv.length} / ${cap})</h3>
            ${invHtml}
        </div>
    `;

    sheet.innerHTML = `
        <header class="char-sheet-header">
            <h2>${ROLE_GLYPH[hero.role] ?? '?'} ${hero.name}</h2>
            <div class="char-sheet-tagline">${hero.role} · ${hero.rank} rank · L${hero.level}</div>
            <div class="char-sheet-stat-strip">${statStrip}</div>
            ${tabsHtml}
        </header>
        <div class="char-sheet-body">
            ${statsTab}
            ${spellsTab}
            ${gearTab}
        </div>
        <footer class="char-sheet-footer">
            <button class="char-sheet-close primary">Close</button>
        </footer>
    `;

    const tabs = sheet.querySelectorAll('.char-sheet-tab');
    const tabBtns = sheet.querySelectorAll('.char-sheet-tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            tabBtns.forEach(b => b.classList.toggle('active', b === btn));
            tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === target));
        });
    });
    overlayEl.appendChild(sheet);

    sheet.querySelectorAll('.equip-action').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            if (action === 'equip' && onEquip) onEquip(btn.dataset.item);
            else if (action === 'unequip' && onUnequip) onUnequip(btn.dataset.slot);
        });
    });
    sheet.querySelector('.char-sheet-close').addEventListener('click', onClose);
}

export function renderUltMeter(meterEl, meter, full, canCast) {
    const pct = Math.max(0, Math.min(100, (meter / full) * 100));
    meterEl.innerHTML = `
        <div class="ult-label">Ultimate</div>
        <div class="ult-bar"><div class="ult-bar-fill" style="width:${pct}%"></div><span class="ult-text">${meter}/${full}</span></div>
        <button class="ult-btn ${canCast ? 'ready' : ''}" ${canCast ? '' : 'disabled'}>${canCast ? 'UNLEASH' : 'Charging…'}</button>
    `;
    return meterEl.querySelector('.ult-btn');
}

export function renderEncounterHeader(headerEl, { name, floorLabel, boss, act }) {
    const actChip = act ? `<span class="act-chip act-${act.id}">Act ${act.num} · ${act.name}</span>` : '';
    headerEl.innerHTML = `
        ${actChip}
        <span class="floor-label">Depth ${floorLabel}</span>
        <span class="encounter-name${boss ? ' boss' : ''}">${name}${boss ? ' — BOSS' : ''}</span>
    `;
}

export function renderCodex(overlayEl, codex, { onClose }) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const panel = document.createElement('div');
    panel.className = 'rest-panel codex';
    const items = codex.length === 0
        ? '<div class="char-sheet-none">No lore discovered yet. Try reading inscriptions and inspecting remains.</div>'
        : `<ul class="codex-list">${codex.map(c => `
            <li class="codex-entry">
                <div class="codex-title">${c.title}</div>
                <div class="codex-body">${c.body}</div>
            </li>
        `).join('')}</ul>`;
    panel.innerHTML = `
        <h2>Codex (${codex.length})</h2>
        ${items}
        <div class="rest-actions">
            <button class="codex-close primary">Close</button>
        </div>
    `;
    overlayEl.appendChild(panel);
    panel.querySelector('.codex-close').addEventListener('click', onClose);
}

export function renderRestScreen(overlayEl, {
    elementOffers, lootOffer, party,
    onPickElement,
    onPickLoot, onSkipLoot,
    onCamp, onAdvance,
}) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const panel = document.createElement('div');
    panel.className = 'rest-panel';

    const rewardSection = (elementOffers?.length ?? 0) > 0
        ? `
            <h3 class="reward-heading">Choose an Element Drop</h3>
            <p class="dim element-offer-hint">One must be taken. Every drop joins your crafting stash.</p>
            <div class="element-offers">
                ${elementOffers.map((o, i) => {
                    const el = getElement(o.elementId);
                    const glyph = ELEMENT_GLYPH[o.elementId] ?? '◇';
                    return `
                    <button class="element-offer-card grade-${o.grade}" data-idx="${i}">
                        <div class="element-offer-glyph">${glyph}</div>
                        <div class="element-offer-name">${el?.name ?? o.elementId}</div>
                        <div class="element-offer-grade">Grade ${GRADES[o.grade - 1]}</div>
                        <div class="element-offer-desc">${el?.desc ?? ''}</div>
                    </button>
                `;
                }).join('')}
            </div>
        `
        : '';

    const lootSection = lootOffer
        ? `
            <h3 class="reward-heading">Loot Drop</h3>
            <div class="loot-offer">
                <div class="loot-name">${lootOffer.name} <span class="dim">(${lootOffer.slot}, ${lootOffer.rarity})</span></div>
                <div class="loot-desc">${lootOffer.description}</div>
                <div class="loot-takers">
                    ${(party ?? []).filter(p => p.alive).map(p => `
                        <button class="loot-taker" data-hero-id="${p.id}"
                                title="${p.name} — ${(p.inventory ?? []).length}/${p.inventoryCapacity ?? 0}">
                            ${p.name}
                        </button>
                    `).join('')}
                </div>
                <div class="reward-skip-row">
                    <button class="loot-skip link-button">Leave the loot</button>
                </div>
            </div>
        `
        : '';

    const mustPick = (elementOffers?.length ?? 0) > 0;
    const restSection = `
        <h3 class="rest-heading">Catch Your Breath</h3>
        <div class="rest-actions">
            <button class="rest-camp" ${mustPick ? 'disabled title="Pick an element drop first"' : ''}>Camp (heal 40% HP)</button>
            <button class="rest-advance primary" ${mustPick ? 'disabled title="Pick an element drop first"' : ''}>Descend</button>
        </div>
    `;

    panel.innerHTML = `
        <h2>Encounter Cleared</h2>
        ${rewardSection}
        ${lootSection}
        ${restSection}
    `;
    overlayEl.appendChild(panel);

    panel.querySelectorAll('.element-offer-card').forEach(btn => {
        btn.addEventListener('click', () => onPickElement(Number(btn.dataset.idx)));
    });

    panel.querySelectorAll('.loot-taker').forEach(btn => {
        btn.addEventListener('click', () => onPickLoot(btn.dataset.heroId));
    });
    const lootSkipBtn = panel.querySelector('.loot-skip');
    if (lootSkipBtn) lootSkipBtn.addEventListener('click', onSkipLoot);

    const campBtn = panel.querySelector('.rest-camp');
    const advBtn = panel.querySelector('.rest-advance');
    let camped = false;
    campBtn.addEventListener('click', () => {
        if (camped) return;
        onCamp();
        camped = true;
        campBtn.disabled = true;
        campBtn.textContent = 'Camped';
    });
    advBtn.addEventListener('click', onAdvance);
}

export function renderFactionChips(el, factions, factionDefs) {
    el.innerHTML = '';
    for (const id of Object.keys(factions)) {
        const def = factionDefs[id];
        if (!def) continue;
        const rel = factions[id];
        const chip = document.createElement('span');
        chip.className = `faction-chip rel-${rel}`;
        chip.title = `${def.name}: ${rel}`;
        chip.innerHTML = `<span class="faction-glyph">${def.glyph}</span><span class="faction-name">${def.name}</span>`;
        el.appendChild(chip);
    }
}

export function renderQuestLog(overlayEl, quests, { onClose, generated = [] } = {}) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const panel = document.createElement('div');
    panel.className = 'rest-panel quest-log';
    const active = quests.filter(q => q.state === 'active');
    const done = quests.filter(q => q.state === 'completed');
    const renderQuest = (q) => `
        <li class="quest-item state-${q.state}">
            <div class="quest-title">${q.title}</div>
            <div class="quest-desc">${q.description}</div>
            <ul class="quest-steps">
                ${q.steps.map(s => `
                    <li class="${s.completed ? 'done' : ''}">${s.completed ? '✔' : '○'} ${s.label}</li>
                `).join('')}
            </ul>
        </li>
    `;
    const renderGenerated = (g) => `
        <li class="quest-item state-${g.status} generated-quest">
            <div class="quest-title">${g.title}
                <span class="quest-status-badge">${generatedStatusLabel(g.status)}</span>
            </div>
            <div class="quest-desc">${g.description}</div>
            <div class="quest-plantings">
                ${Object.entries(g.plantings).map(([, p]) =>
                    `<span class="quest-planting">${p.label}: layer ${p.layer ?? '?'}</span>`
                ).join(' · ')}
            </div>
            <div class="quest-next">Next: ${humanizeHint(g.nextHint, g.bossLayer)}</div>
            ${g.firedInterferences.length > 0 ? `
                <div class="quest-interferences">Fate: ${g.firedInterferences.join(', ')}</div>
            ` : ''}
            ${g.rewardMessage ? `
                <div class="quest-reward">Reward: ${g.rewardMessage}</div>
            ` : ''}
        </li>
    `;
    const genActive = generated.filter(g => g.status === 'active');
    const genDone   = generated.filter(g => g.status === 'completed');
    const genFailed = generated.filter(g => g.status === 'failed');
    const empty = active.length === 0 && done.length === 0 && generated.length === 0;
    panel.innerHTML = `
        <h2>Quest Log</h2>
        ${empty ? '<div class="char-sheet-none">No quests yet.</div>' : `
            ${generated.length > 0 ? `
                <section class="quest-generated-section">
                    <h3 class="char-sheet-section">Omens of this Run</h3>
                    <ul class="quest-list">
                        ${[...genActive, ...genDone, ...genFailed].map(renderGenerated).join('')}
                    </ul>
                </section>
            ` : ''}
            <div class="quest-log-layout">
                <section class="quest-col">
                    <h3 class="char-sheet-section">Active (${active.length})</h3>
                    ${active.length > 0
                        ? `<ul class="quest-list">${active.map(renderQuest).join('')}</ul>`
                        : '<div class="char-sheet-none">None active.</div>'}
                </section>
                <section class="quest-col">
                    <h3 class="char-sheet-section">Completed (${done.length})</h3>
                    ${done.length > 0
                        ? `<ul class="quest-list">${done.map(renderQuest).join('')}</ul>`
                        : '<div class="char-sheet-none">None yet.</div>'}
                </section>
            </div>
        `}
        <div class="rest-actions">
            <button class="quest-log-close primary">Close</button>
        </div>
    `;
    overlayEl.appendChild(panel);
    panel.querySelector('.quest-log-close').addEventListener('click', onClose);
}

function generatedStatusLabel(status) {
    if (status === 'completed') return '✔ Completed';
    if (status === 'failed')    return '✘ Failed';
    return 'In progress';
}

/**
 * Translate a raw planner action name ("Pickup Relic at n5", "Travel(n3->n7)")
 * into a short prose line for the UI. Travel steps are collapsed to a generic
 * "Press on" since the specific node id has little meaning to the player.
 */
function humanizeHint(hint, bossLayer) {
    if (!hint) return '—';
    if (hint.startsWith('Travel(')) return 'Press on to the next node';
    if (hint.startsWith('Pickup '))  return hint.replace(/ at n\d+$/, '');
    if (hint.startsWith('Unlock '))  return hint.replace(/ at n\d+$/, '');
    if (hint === 'Take Relic from Vault') return 'Take the relic from the vault';
    return hint;
}

/**
 * Overlay that shows the persistent crafting stash:
 *   - 16 elements × 4 grade columns with counts
 *   - 'Upgrade' button per (element, grade) when count ≥ CRAFT_RATIO
 *   - potion recipes with a 'Brew' button when ingredients are present
 *   - 'Use' buttons on brewed potions when a run is active
 *
 * Callbacks:
 *   onCraftUpgrade(elementId, fromGrade)
 *   onCraftPotion(potionId)
 *   onUsePotion(potionId)        — may be omitted outside a run
 *   onClose()
 */
export function renderElementsOverlay(overlayEl, metaStash, {
    onCraftUpgrade, onCraftPotion, onUsePotion, onClose,
    canUsePotions = false,
} = {}) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const panel = document.createElement('div');
    panel.className = 'rest-panel elements-panel';

    const elementsStash = metaStash.elements ?? {};
    const potions = metaStash.potions ?? {};
    const total = totalStashSize(elementsStash);

    const stashRows = ELEMENTS.map(el => {
        const glyph = ELEMENT_GLYPH[el.id] ?? '◇';
        const cells = GRADES.map((g, idx) => {
            const grade = idx + 1;
            const count = stashCount(elementsStash, el.id, grade);
            const canUp = grade < GRADES.length && canCraftUpgrade(elementsStash, el.id, grade);
            const upBtn = canUp
                ? `<button class="craft-upgrade-btn" data-el="${el.id}" data-from="${grade}"
                          title="Consume ${CRAFT_RATIO} ${g} to make 1 ${GRADES[grade]}">↑</button>`
                : '';
            return `
                <td class="stash-cell grade-col-${grade} ${count > 0 ? 'has' : 'empty'}">
                    <span class="stash-count">${count}</span>
                    ${upBtn}
                </td>
            `;
        }).join('');
        return `
            <tr class="stash-row" title="${el.desc}">
                <th class="stash-label">
                    <span class="element-glyph">${glyph}</span>
                    <span class="element-name">${el.name}</span>
                    <span class="element-family dim">(${el.family})</span>
                </th>
                ${cells}
            </tr>
        `;
    }).join('');

    const potionRows = allPotions().map(p => {
        const owned = potions[p.id] ?? 0;
        const canCraft = canCraftPotion(elementsStash, p.id);
        const recipeText = Object.entries(p.recipe).flatMap(([elId, costs]) => {
            return costs.flatMap((n, i) => {
                if (!n) return [];
                const el = getElement(elId);
                return [`${n}× ${el?.name ?? elId} ${GRADES[i]}`];
            });
        }).join(', ');
        const useBtn = (canUsePotions && owned > 0)
            ? `<button class="potion-use-btn" data-id="${p.id}">Use</button>`
            : '';
        const brewBtn = canCraft
            ? `<button class="potion-brew-btn" data-id="${p.id}">Brew</button>`
            : `<button class="potion-brew-btn" disabled>Brew</button>`;
        return `
            <li class="potion-row ${canCraft ? 'can-brew' : ''}">
                <div class="potion-head">
                    <span class="potion-name">${p.name}</span>
                    <span class="potion-owned dim">${owned > 0 ? `×${owned}` : ''}</span>
                </div>
                <div class="potion-desc dim">${p.desc}</div>
                <div class="potion-recipe dim">Recipe: ${recipeText}</div>
                <div class="potion-actions">${brewBtn}${useBtn}</div>
            </li>
        `;
    }).join('');

    panel.innerHTML = `
        <h2>Stash &amp; Crafting</h2>
        <p class="dim">Persistent across runs. ${total} raw elements stashed.
           Upgrade by consuming ${CRAFT_RATIO} of one grade for 1 of the next.</p>
        <div class="elements-layout">
            <section class="elements-col stash-col">
                <h3>Elements</h3>
                <table class="stash-table">
                    <thead>
                        <tr>
                            <th></th>
                            ${GRADES.map(g => `<th class="grade-col">${g}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>${stashRows}</tbody>
                </table>
            </section>
            <section class="elements-col potions-col">
                <h3>Potions</h3>
                <p class="dim">Combine elements to brew potions. Every potion effect only shapes procedural generation — never hero stats or combat math.</p>
                <ul class="potion-list">${potionRows}</ul>
            </section>
        </div>
        <div class="rest-actions">
            <button class="elements-close primary">Close</button>
        </div>
    `;
    overlayEl.appendChild(panel);

    panel.querySelectorAll('.craft-upgrade-btn').forEach(btn => {
        btn.addEventListener('click', () => onCraftUpgrade?.(btn.dataset.el, Number(btn.dataset.from)));
    });
    panel.querySelectorAll('.potion-brew-btn').forEach(btn => {
        if (btn.disabled) return;
        btn.addEventListener('click', () => onCraftPotion?.(btn.dataset.id));
    });
    panel.querySelectorAll('.potion-use-btn').forEach(btn => {
        btn.addEventListener('click', () => onUsePotion?.(btn.dataset.id));
    });
    panel.querySelector('.elements-close').addEventListener('click', onClose);
}

export function renderResumePrompt(overlayEl, saved, { onResume, onDiscard }) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const panel = document.createElement('div');
    panel.className = 'rest-panel resume-panel';
    const partyLine = (saved.party ?? [])
        .map(p => `${p.name} (${p.role}, L${p.level})`)
        .join(' · ');
    const phaseLabel = saved.phase === 'combat' ? 'in combat' :
                       saved.phase === 'event'  ? 'in an event' :
                       saved.phase === 'recruit' ? 'meeting a recruit' :
                       saved.phase === 'post-combat' ? 'between fights' : 'on the map';
    panel.innerHTML = `
        <h2>Resume Saved Run?</h2>
        <p>You have a run in progress (seed <code>${saved.seed}</code>), currently ${phaseLabel}.</p>
        ${partyLine ? `<p class="dim">${partyLine}</p>` : ''}
        <div class="rest-actions">
            <button class="resume-yes primary">Resume</button>
            <button class="resume-no">Discard and start fresh</button>
        </div>
    `;
    overlayEl.appendChild(panel);
    panel.querySelector('.resume-yes').addEventListener('click', onResume);
    panel.querySelector('.resume-no').addEventListener('click', onDiscard);
}

function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString();
}

export function renderHistoryOverlay(overlayEl, records, { onReplay, onReset, onClose }) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const panel = document.createElement('div');
    panel.className = 'rest-panel history-panel';
    const items = records.length === 0
        ? '<div class="char-sheet-none">No past runs yet. Win or lose one and it will appear here.</div>'
        : `<ul class="history-list">${records.map(r => `
            <li class="history-row outcome-${r.outcome}">
                <div class="history-line">
                    <span class="history-outcome">${r.outcome}</span>
                    <span class="history-depth">depth ${r.finalDepth}/${r.mapDepth}</span>
                    <span class="history-date">${fmtDate(r.endedAt)}</span>
                </div>
                <div class="history-line dim">
                    seed <code>${r.seed}</code> ·
                    ${r.party.map(p => `${p.name}${p.alive ? '' : '✝'} L${p.level}`).join(', ')}
                </div>
                <div class="history-line dim">
                    ${r.codexCount} lore · ${r.questsCompleted} quests done
                    ${r.bossName ? ` · faced ${r.bossName}` : ''}
                </div>
                <div class="history-actions">
                    <button class="history-replay" data-seed="${r.seed}">Replay this seed</button>
                </div>
            </li>
        `).join('')}</ul>`;
    panel.innerHTML = `
        <h2>Run History (${records.length})</h2>
        ${items}
        <div class="rest-actions history-footer">
            <button class="history-reset danger">Reset History</button>
            <button class="history-close primary">Close</button>
        </div>
    `;
    overlayEl.appendChild(panel);
    panel.querySelectorAll('.history-replay').forEach(btn => {
        btn.addEventListener('click', () => onReplay(Number(btn.dataset.seed)));
    });
    const resetBtn = panel.querySelector('.history-reset');
    if (onReset) {
        resetBtn.addEventListener('click', () => {
            const ok = (typeof confirm === 'function')
                ? confirm('This will wipe ALL saved runs and your current in-progress run from this browser. Are you sure?')
                : true;
            if (ok) onReset();
        });
    } else {
        resetBtn.disabled = true;
    }
    panel.querySelector('.history-close').addEventListener('click', onClose);
}

export function renderResources(resEl, { rations, torches, darkness }) {
    resEl.innerHTML = `
        <span class="resource ${rations === 0 ? 'low' : ''}" title="Rations: needed to camp without losing HP">🍖 <span class="resource-num">${rations}</span></span>
        <span class="resource ${torches === 0 ? 'low' : ''}" title="Torches: needed to keep the next floor lit">🔥 <span class="resource-num">${torches}</span></span>
        ${darkness ? `<span class="resource warn" title="Darkness — enemies hit harder this fight">🌑 DARK</span>` : ''}
    `;
}

/** Small HUD strip showing the player's persistent element-stash totals. */
export function renderStashShelf(shelfEl, metaStash) {
    shelfEl.innerHTML = '';
    const elementsStash = metaStash?.elements ?? {};
    const potions = metaStash?.potions ?? {};
    const totalElements = totalStashSize(elementsStash);
    const totalPotions = Object.values(potions).reduce((a, b) => a + (b || 0), 0);
    if (totalElements === 0 && totalPotions === 0) {
        shelfEl.classList.add('empty');
        shelfEl.textContent = 'Stash empty';
        return;
    }
    shelfEl.classList.remove('empty');
    const summary = document.createElement('span');
    summary.className = 'stash-chip';
    summary.textContent = `📦 ${totalElements} elements${totalPotions > 0 ? ` · ${totalPotions} potions` : ''}`;
    summary.title = 'Persistent crafting stash — open Elements to craft and brew.';
    shelfEl.appendChild(summary);
}

export function hideOverlay(overlayEl) {
    overlayEl.classList.remove('visible');
    overlayEl.innerHTML = '';
}

export function renderEndScreen(overlayEl, { status, onRestart }) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const panel = document.createElement('div');
    panel.className = 'rest-panel ' + status;
    const heading = status === 'victory' ? 'The Lich King Falls' : 'The Party Has Fallen';
    const sub = status === 'victory'
        ? 'You carved a path through the dungeon. The realm breathes again.'
        : 'The dungeon swallows another band of would-be heroes. The gems lie still.';
    panel.innerHTML = `
        <h2>${heading}</h2>
        <p>${sub}</p>
        <div class="rest-actions">
            <button class="rest-restart primary">New Run</button>
        </div>
    `;
    overlayEl.appendChild(panel);
    panel.querySelector('.rest-restart').addEventListener('click', onRestart);
}

export function renderScoreTally(scoreEl, scoreByColor) {
    scoreEl.innerHTML = '';
    for (const color of Object.keys(COLOR_GLYPH)) {
        const value = scoreByColor[color] || 0;
        const cell = document.createElement('div');
        cell.className = 'score-cell';
        cell.dataset.color = color;
        cell.innerHTML = `<span class="score-glyph">${COLOR_GLYPH[color]}</span><span class="score-value">${value}</span>`;
        scoreEl.appendChild(cell);
    }
}

export function renderLog(logEl, events, { nameById } = {}) {
    const nameOf = (id) => (id == null ? '' : (nameById?.[id] ?? id));
    for (const ev of events) {
        const text = describeEvent(ev, nameOf);
        if (text == null) continue;
        const li = document.createElement('li');
        li.className = `log-${ev.type}`;
        li.textContent = text;
        logEl.prepend(li);
    }
    while (logEl.children.length > 30) logEl.removeChild(logEl.lastChild);
}

function describeEvent(ev, nameOf = (id) => id) {
    switch (ev.type) {
        case 'damage': {
            const crit = ev.crit ? ' CRIT!' : '';
            const mod = ev.modifier === 'weak' ? ' (weak!)' :
                        ev.modifier === 'resist' ? ' (resisted)' :
                        ev.modifier === 'true' ? ' (true)' : '';
            return `${ev.source} hits ${nameOf(ev.targetId)} for ${ev.amount}${crit}${mod}`;
        }
        case 'heal':
            return `${ev.source} heals ${nameOf(ev.targetId)} for ${ev.amount}`;
        case 'shield':
            return `${ev.source} grants ${ev.amount} shield to ${nameOf(ev.targetId)}`;
        case 'meter':
            return `${ev.source} charges ultimate (+${ev.amount}, total ${ev.total})`;
        case 'ult-cast':
            return `🔮 SUMMONER ULTIMATE — ${ev.amount} damage to all enemies!`;
        case 'enemy-attack': {
            const tag = ev.intent === 'big-attack' ? 'BIG STRIKE' : 'attacks';
            return `${nameOf(ev.sourceId)} ${tag} ${nameOf(ev.targetId)} (roll ${ev.roll}) for ${ev.amount}` +
                (ev.absorbed > 0 ? ` (${ev.absorbed} absorbed)` : '');
        }
        case 'enemy-miss':
            return `${nameOf(ev.sourceId)} misses ${nameOf(ev.targetId)} (roll ${ev.roll})`;
        case 'enemy-defend':
            return `${nameOf(ev.sourceId)} braces (+${ev.amount} shield)`;
        case 'enemy-summon':
            return `${nameOf(ev.sourceId)} summons a ${ev.summonName}!`;
        case 'spell-cast':
            return `${nameOf(ev.sourceId)} casts ${ev.name} (-${ev.cost} MP)`;
        case 'mana-regen':
            return null; // too noisy for the log; floats only
        case 'xp-gain':
            return `${nameOf(ev.targetId)} gains ${ev.amount} XP`;
        case 'level-up':
            return `🌟 ${nameOf(ev.targetId)} reached Level ${ev.level}!`;
        case 'status-applied':
            return `${nameOf(ev.targetId)} is ${ev.kind} (${ev.duration} turns)`;
        case 'status-tick':
            return `${nameOf(ev.targetId)} suffers ${ev.amount} ${ev.kind} damage`;
        case 'status-cleansed':
            return `${nameOf(ev.targetId)} is cleansed of ${ev.kinds.join(', ')}`;
        case 'status-end':
            return null; // floats handle this; log would be noise
        case 'status-skip':
            return `${nameOf(ev.sourceId)} is ${ev.kind} and skips its action`;
        case 'gem-summary': {
            const parts = Object.entries(ev.counts ?? {})
                .filter(([, n]) => n > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([color, n]) => `${COLOR_GLYPH[color] ?? '?'}×${n}`);
            if (parts.length === 0) return null; // skip if no gems matched
            return `Matched: ${parts.join(' ')}`;
        }
        case 'event':
            return ev.message;
        default:
            return JSON.stringify(ev);
    }
}

// ----- map rendering -----

const MAP_COL_W = 120;
const MAP_ROW_H = 78;
const MAP_NODE_R = 24;

function nodePosition(node, maxRows) {
    // Spread nodes vertically within their layer, centered around the row axis.
    const x = node.layer * MAP_COL_W + MAP_COL_W / 2;
    const layerHeight = maxRows * MAP_ROW_H;
    // Distribute nodes within the layer's allotted vertical space
    const rowsInLayer = node._rowsInLayer ?? 1;
    const slot = node._slot ?? 0;
    const slotSpacing = layerHeight / (rowsInLayer + 1);
    const y = slotSpacing * (slot + 1);
    return { x, y };
}

export function renderMap(mapEl, map, { currentNodeId, reachableIds, onPickNode, questMarkers = {} }) {
    mapEl.innerHTML = '';
    // Annotate nodes with row info for layout
    const maxRows = Math.max(...map.layers.map(l => l.length));
    for (const layer of map.layers) {
        layer.forEach((node, i) => {
            node._rowsInLayer = layer.length;
            node._slot = i;
        });
    }
    const width = map.layers.length * MAP_COL_W;
    const height = maxRows * MAP_ROW_H;
    mapEl.style.width = `${width}px`;
    mapEl.style.height = `${height}px`;

    // SVG layer for edges
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.classList.add('map-edges');

    const reachable = new Set(reachableIds);
    for (const layer of map.layers) {
        for (const node of layer) {
            const from = nodePosition(node, maxRows);
            for (const nextId of node.next) {
                const nextNode = map.nodes[nextId];
                const to = nodePosition(nextNode, maxRows);
                const line = document.createElementNS(svgNs, 'line');
                line.setAttribute('x1', String(from.x));
                line.setAttribute('y1', String(from.y));
                line.setAttribute('x2', String(to.x));
                line.setAttribute('y2', String(to.y));
                const isFromCurrent = node.id === currentNodeId;
                const isReachableEdge = isFromCurrent && reachable.has(nextId);
                line.classList.add('map-edge');
                if (isReachableEdge) line.classList.add('reachable');
                svg.appendChild(line);
            }
        }
    }
    mapEl.appendChild(svg);

    // Nodes layer
    for (const layer of map.layers) {
        for (const node of layer) {
            const pos = nodePosition(node, maxRows);
            const btn = document.createElement('button');
            btn.className = `map-node type-${node.type}`;
            btn.style.left = `${pos.x - MAP_NODE_R}px`;
            btn.style.top  = `${pos.y - MAP_NODE_R}px`;
            btn.dataset.nodeId = node.id;
            const markers = questMarkers[node.id] ?? [];
            if (markers.length > 0) {
                btn.classList.add('has-quest-marker');
                const labels = markers.map(m => m.label).join(', ');
                btn.title = `${NODE_LABEL[node.type]} — ${labels}`;
                btn.innerHTML = `
                    <span class="map-node-glyph">${NODE_GLYPH[node.type]}</span>
                    <span class="map-node-quest-badge" aria-label="${labels}">★</span>
                `;
            } else {
                btn.title = NODE_LABEL[node.type];
                btn.innerHTML = `<span class="map-node-glyph">${NODE_GLYPH[node.type]}</span>`;
            }
            const isCurrent = node.id === currentNodeId;
            const isReach = reachable.has(node.id);
            if (isCurrent) btn.classList.add('cleared');
            if (isReach) btn.classList.add('reachable');
            if (!isReach && !isCurrent) btn.classList.add('locked');
            btn.disabled = !isReach;
            btn.addEventListener('click', () => {
                if (isReach) onPickNode(node.id);
            });
            mapEl.appendChild(btn);
        }
    }
}

export function renderRecruitOverlay(overlayEl, recruit, party, maxPartySize, { onAccept, onDecline, onReplace }) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const panel = document.createElement('div');
    panel.className = 'rest-panel recruit-panel';

    const partyFull = party.length >= maxPartySize;
    const recruitSlots = renderSlotChips(recruit);
    const stats = `
        <div class="recruit-stats">
            <div>Class: <strong>${recruit.role}</strong> (${recruit.rank} rank)</div>
            <div>Level: <strong>${recruit.level}</strong></div>
            <div>HP: <strong>${recruit.hp} / ${recruit.maxHp}</strong></div>
            <div>AC: <strong>${recruit.ac}</strong></div>
            ${recruitSlots ? `<div class="recruit-slots">Slots: ${recruitSlots}</div>` : ''}
        </div>
    `;

    let actionsHtml;
    if (!partyFull) {
        actionsHtml = `
            <div class="rest-actions">
                <button class="recruit-accept primary">Accept (party has room)</button>
                <button class="recruit-decline">Decline</button>
            </div>
        `;
    } else {
        const replaceButtons = party.map(p => `
            <button class="recruit-replace" data-hero-id="${p.id}">
                Replace ${p.name} <span class="dim">(${p.role}, L${p.level})</span>
            </button>
        `).join('');
        actionsHtml = `
            <h3 class="reward-heading">Party is full — replace whom?</h3>
            <div class="recruit-replace-list">${replaceButtons}</div>
            <div class="rest-actions">
                <button class="recruit-decline">Decline</button>
            </div>
        `;
    }

    panel.innerHTML = `
        <h2>${recruit.name} offers to join</h2>
        <p>A ${recruit.role} approaches and offers to throw in their lot with the party.</p>
        ${stats}
        ${actionsHtml}
    `;
    overlayEl.appendChild(panel);

    const acc = panel.querySelector('.recruit-accept');
    if (acc) acc.addEventListener('click', onAccept);
    panel.querySelectorAll('.recruit-replace').forEach(btn => {
        btn.addEventListener('click', () => onReplace(btn.dataset.heroId));
    });
    panel.querySelector('.recruit-decline').addEventListener('click', onDecline);
}

export function renderEventOverlay(overlayEl, event, { onResolve, isAvailable }) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const panel = document.createElement('div');
    panel.className = 'rest-panel event-panel';

    const choicesHtml = event.choices.map(c => {
        const available = isAvailable ? isAvailable(c) : true;
        const disabled = available ? '' : 'disabled';
        const gateHint = c.requires?.class ? `<span class="event-gate">Requires ${c.requires.class}</span>` : '';
        return `
            <button class="event-choice" data-choice-id="${c.id}" ${disabled}
                    title="${c.requires?.class ? `Requires a ${c.requires.class} in the party` : ''}">
                <span class="event-choice-label">${c.label}</span>
                ${gateHint}
            </button>
        `;
    }).join('');

    panel.innerHTML = `
        <h2>${event.title}</h2>
        <p>${event.body}</p>
        <div class="event-choices">${choicesHtml}</div>
    `;
    overlayEl.appendChild(panel);

    panel.querySelectorAll('.event-choice').forEach(btn => {
        btn.addEventListener('click', () => onResolve(btn.dataset.choiceId));
    });
}

export function setBanner(bannerEl, phase) {
    if (phase === 'victory') {
        bannerEl.textContent = 'RUN COMPLETE';
        bannerEl.className = 'banner victory';
    } else if (phase === 'defeat') {
        bannerEl.textContent = 'PARTY DOWN';
        bannerEl.className = 'banner defeat';
    } else if (phase === 'post-combat') {
        bannerEl.textContent = 'CLEARED';
        bannerEl.className = 'banner cleared';
    } else {
        bannerEl.textContent = '';
        bannerEl.className = 'banner';
    }
}
