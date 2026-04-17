import { NODE_GLYPH, NODE_LABEL } from './map.js';

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
        case 'mana-regen': {
            const anchor = actorAnchor(ev.targetId);
            if (!anchor) return;
            popFloat({ x: anchor.x, y: anchor.y, text: `+${ev.amount} MP`, classes: 'float-mana small' });
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

function renderHpBar(current, max) {
    const pct = Math.max(0, Math.min(100, (current / max) * 100));
    return `
        <div class="hp-bar">
            <div class="hp-bar-fill" style="width: ${pct}%"></div>
            <span class="hp-bar-text">${current}/${max}</span>
        </div>
    `;
}

function renderManaBar(current, max) {
    const pct = Math.max(0, Math.min(100, (current / max) * 100));
    return `
        <div class="mana-bar">
            <div class="mana-bar-fill" style="width: ${pct}%"></div>
            <span class="mana-bar-text">${current}/${max} MP</span>
        </div>
    `;
}

export function renderParty(partyEl, party, { onHeroClick } = {}) {
    partyEl.innerHTML = '';
    for (const hero of party) {
        const card = document.createElement('div');
        card.className = `hero-card rank-${hero.rank}` + (hero.alive ? '' : ' dead');
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
                ${hero.maxMana > 0 ? renderManaBar(hero.mana, hero.maxMana) : ''}
                ${hero.shield > 0 ? `<div class="shield">🛡 ${hero.shield}</div>` : ''}
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
            ${resistChips(enemy)}
            <div class="${intentClass}">${enemy.alive ? intentLabel(intent) : '—'}</div>
        `;
        enemyEl.appendChild(card);
    }
}

export function renderSpellTray(trayEl, party, { canCast, onCast }) {
    trayEl.innerHTML = '';
    const casters = party.filter(p => p.maxMana > 0 && p.alive);
    if (casters.length === 0) {
        trayEl.classList.add('empty');
        trayEl.textContent = '';
        return;
    }
    trayEl.classList.remove('empty');
    for (const hero of casters) {
        const group = document.createElement('div');
        group.className = 'spell-group';
        group.innerHTML = `<div class="spell-group-header">${hero.name} (L${hero.level}, ${hero.mana}/${hero.maxMana} MP)</div>`;
        const list = document.createElement('div');
        list.className = 'spell-list';
        // Lazily import the spell list per role/level via the canCast lookup
        // (caller knows the registry).
        for (const spell of hero._spells ?? []) {
            const btn = document.createElement('button');
            btn.className = 'spell-btn';
            btn.title = spell.description;
            btn.dataset.spellId = spell.id;
            btn.dataset.casterId = hero.id;
            btn.innerHTML = `
                <span class="spell-name">${spell.name}</span>
                <span class="spell-cost">${spell.cost} MP</span>
            `;
            btn.disabled = !canCast(spell.id, hero.id);
            btn.addEventListener('click', () => onCast(spell.id, hero.id));
            list.appendChild(btn);
        }
        group.appendChild(list);
        trayEl.appendChild(group);
    }
}

export function renderCharacterSheet(overlayEl, hero, { onClose }) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const sheet = document.createElement('div');
    sheet.className = 'rest-panel character-sheet';
    const next = hero._xpForNext ?? null;
    const xpLine = next == null
        ? `<div>XP: ${hero.xp} (max level)</div>`
        : `<div>XP: ${hero.xp} / ${next}</div>`;
    const spells = hero._spells ?? [];
    const spellsHtml = spells.length === 0
        ? '<div class="char-sheet-none">No spells.</div>'
        : `<ul class="char-sheet-spells">${spells.map(s => `
            <li><strong>${s.name}</strong> — ${s.cost} MP — ${s.description}</li>
        `).join('')}</ul>`;
    sheet.innerHTML = `
        <h2>${ROLE_GLYPH[hero.role] ?? '?'} ${hero.name}</h2>
        <div class="char-sheet-stats">
            <div>Class: <strong>${hero.role}</strong> (${hero.rank} rank)</div>
            <div>Level: <strong>${hero.level}</strong></div>
            ${xpLine}
            <div>HP: <strong>${hero.hp} / ${hero.maxHp}</strong></div>
            ${hero.maxMana > 0 ? `<div>Mana: <strong>${hero.mana} / ${hero.maxMana}</strong></div>` : ''}
            <div>AC: <strong>${hero.ac}</strong></div>
            ${hero.shield > 0 ? `<div>Shield: <strong>${hero.shield}</strong></div>` : ''}
        </div>
        <h3 class="char-sheet-section">Spells</h3>
        ${spellsHtml}
        <h3 class="char-sheet-section">Inventory</h3>
        <div class="char-sheet-none">No inventory yet — gear coming soon.</div>
        <div class="rest-actions">
            <button class="char-sheet-close primary">Close</button>
        </div>
    `;
    overlayEl.appendChild(sheet);
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

export function renderEncounterHeader(headerEl, { name, floorLabel, boss }) {
    headerEl.innerHTML = `
        <span class="floor-label">Depth ${floorLabel}</span>
        <span class="encounter-name${boss ? ' boss' : ''}">${name}${boss ? ' — BOSS' : ''}</span>
    `;
}

export function renderRestScreen(overlayEl, { offers, onPickRelic, onSkipReward, onCamp, onAdvance }) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const panel = document.createElement('div');
    panel.className = 'rest-panel';

    const rewardSection = offers.length > 0
        ? `
            <h3 class="reward-heading">Choose a Relic</h3>
            <div class="relic-offers">
                ${offers.map(r => `
                    <button class="relic-card" data-id="${r.id}">
                        <div class="relic-name">${r.name}</div>
                        <div class="relic-rarity">${r.rarity}</div>
                        <div class="relic-desc">${r.description}</div>
                    </button>
                `).join('')}
            </div>
            <div class="reward-skip-row">
                <button class="rest-skip-reward link-button">Skip relic</button>
            </div>
        `
        : '';

    const restSection = `
        <h3 class="rest-heading">Catch Your Breath</h3>
        <div class="rest-actions">
            <button class="rest-camp">Camp (heal 40% HP)</button>
            <button class="rest-advance primary">Descend</button>
        </div>
    `;

    panel.innerHTML = `
        <h2>Encounter Cleared</h2>
        ${rewardSection}
        ${restSection}
    `;
    overlayEl.appendChild(panel);

    panel.querySelectorAll('.relic-card').forEach(btn => {
        btn.addEventListener('click', () => onPickRelic(btn.dataset.id));
    });
    const skipBtn = panel.querySelector('.rest-skip-reward');
    if (skipBtn) skipBtn.addEventListener('click', onSkipReward);

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

export function renderRelicShelf(shelfEl, relics) {
    shelfEl.innerHTML = '';
    if (relics.length === 0) {
        shelfEl.classList.add('empty');
        shelfEl.textContent = 'No relics yet';
        return;
    }
    shelfEl.classList.remove('empty');
    for (const r of relics) {
        const chip = document.createElement('span');
        chip.className = 'relic-chip';
        chip.textContent = r.name;
        chip.title = r.description;
        shelfEl.appendChild(chip);
    }
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

export function renderLog(logEl, events) {
    for (const ev of events) {
        const text = describeEvent(ev);
        if (text == null) continue;
        const li = document.createElement('li');
        li.className = `log-${ev.type}`;
        li.textContent = text;
        logEl.prepend(li);
    }
    while (logEl.children.length > 30) logEl.removeChild(logEl.lastChild);
}

function describeEvent(ev) {
    switch (ev.type) {
        case 'damage': {
            const crit = ev.crit ? ' CRIT!' : '';
            const mod = ev.modifier === 'weak' ? ' (weak!)' :
                        ev.modifier === 'resist' ? ' (resisted)' :
                        ev.modifier === 'true' ? ' (true)' : '';
            return `${ev.source} hits ${ev.targetId} for ${ev.amount}${crit}${mod}`;
        }
        case 'heal':
            return `${ev.source} heals ${ev.targetId} for ${ev.amount}`;
        case 'shield':
            return `${ev.source} grants ${ev.amount} shield to ${ev.targetId}`;
        case 'meter':
            return `${ev.source} charges ultimate (+${ev.amount}, total ${ev.total})`;
        case 'ult-cast':
            return `🔮 SUMMONER ULTIMATE — ${ev.amount} damage to all enemies!`;
        case 'enemy-attack': {
            const tag = ev.intent === 'big-attack' ? 'BIG STRIKE' : 'attacks';
            return `${ev.sourceId} ${tag} ${ev.targetId} (roll ${ev.roll}) for ${ev.amount}` +
                (ev.absorbed > 0 ? ` (${ev.absorbed} absorbed)` : '');
        }
        case 'enemy-miss':
            return `${ev.sourceId} misses ${ev.targetId} (roll ${ev.roll})`;
        case 'enemy-defend':
            return `${ev.sourceId} braces (+${ev.amount} shield)`;
        case 'enemy-summon':
            return `${ev.sourceId} summons a ${ev.summonName}!`;
        case 'spell-cast':
            return `${ev.sourceId} casts ${ev.name} (-${ev.cost} MP)`;
        case 'mana-regen':
            return null; // too noisy for the log; floats only
        case 'xp-gain':
            return `${ev.targetId} gains ${ev.amount} XP`;
        case 'level-up':
            return `🌟 ${ev.targetId} reached Level ${ev.level}!`;
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

export function renderMap(mapEl, map, { currentNodeId, reachableIds, onPickNode }) {
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
            btn.title = NODE_LABEL[node.type];
            btn.innerHTML = `<span class="map-node-glyph">${NODE_GLYPH[node.type]}</span>`;
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

export function renderEventOverlay(overlayEl, event, { onResolve }) {
    overlayEl.innerHTML = '';
    overlayEl.classList.add('visible');
    const panel = document.createElement('div');
    panel.className = 'rest-panel event-panel';
    panel.innerHTML = `
        <h2>${event.title}</h2>
        <p>${event.body}</p>
        <div class="rest-actions">
            <button class="event-cta primary">${event.cta}</button>
        </div>
    `;
    overlayEl.appendChild(panel);
    panel.querySelector('.event-cta').addEventListener('click', onResolve);
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
