import { Game } from './game.js';
import {
    renderBoard,
    renderParty,
    renderEnemies,
    renderEncounterHeader,
    renderScoreTally,
    renderLog,
    renderRestScreen,
    renderEndScreen,
    renderStashShelf,
    renderResources,
    renderUltMeter,
    renderMap,
    renderEventOverlay,
    renderRecruitOverlay,
    renderFactionChips,
    renderQuestLog,
    renderCodex,
    renderElementsOverlay,
    renderSpellTray,
    renderCharacterSheet,
    hideOverlay,
    setBanner,
    playCascadeAnimation,
    playEventFloats,
} from './ui.js';
import { ULT_FULL, equipItem, unequipItem } from './combat.js';
import { spellsForHero } from './spells.js';
import { FACTIONS } from './factions.js';
import { canEquip } from './items.js';
import { xpForLevel, isChoiceAvailable, MAX_PARTY_SIZE } from './game.js';
import * as persistence from './persistence.js';
import { renderResumePrompt, renderHistoryOverlay } from './ui.js';
import { emptyStash, addToStash, craftUpgrade, getElement, GRADES } from './elements.js';
import { craftPotion, usePotion, getPotion, emptyPotionStore } from './potions.js';

const TURN_TIMER_SECONDS = 45;

function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`missing element #${id}`);
    return el;
}

let activeTimer = null;
let activeGame = null;
// Persistent meta-stash (elements + potions) — loaded once and reused across runs.
let metaStash = { elements: emptyStash(), potions: emptyPotionStore() };

function normalizeMetaStash(raw) {
    if (!raw || typeof raw !== 'object') return { elements: emptyStash(), potions: emptyPotionStore() };
    const elements = raw.elements ?? emptyStash();
    const defaults = emptyStash();
    // Ensure every element has a 4-slot row even if saved format was sparse.
    for (const id of Object.keys(defaults)) {
        if (!Array.isArray(elements[id]) || elements[id].length !== 4) elements[id] = [0, 0, 0, 0];
    }
    return { elements, potions: raw.potions ?? {} };
}

function saveMetaStash() {
    persistence.saveMetaStash(metaStash).catch(() => {});
}

function startGame(opts = {}) {
    // opts: { seed?: number, restored?: Game }
    if (activeTimer) clearInterval(activeTimer);

    const game = opts.restored ?? new Game({ seed: opts.seed ?? Date.now() });
    activeGame = game;
    // checkpoint immediately so a fresh run is recoverable
    persistence.saveActiveRun(game.toJSON()).catch(() => {});
    let selected = null;
    let timerSecondsLeft = TURN_TIMER_SECONDS;
    let isAnimating = false;

    const boardEl = $('board');
    const partyEl = $('party');
    const enemyEl = $('enemies');
    const headerEl = $('encounter-header');
    const scoreEl = $('score-tally');
    const logEl = $('log');
    const bannerEl = $('banner');
    const timerEl = $('timer');
    const overlayEl = $('overlay');
    const stashShelfEl = $('relic-shelf'); // repurposed: shows element stash summary
    const resourcesEl = $('resources');
    const factionsEl = $('factions');
    const questsBtn = $('quests-btn');
    const codexBtn = $('codex-btn');
    const elementsBtn = $('elements-btn');
    const historyBtn = $('history-btn');
    const ultEl = $('ult-meter');
    const mapEl = $('map');
    const playAreaEl = $('play-area');
    const spellTrayEl = $('spell-tray');
    const commitBtn = $('commit-btn');
    const newRunBtn = $('new-run-btn');

    // Annotate party data with derived helpers the UI needs (spells + xp curve).
    function annotateParty() {
        for (const hero of game.party) {
            hero._spells = spellsForHero(hero);
            hero._xpForNext = xpForLevel(hero.level + 1);
        }
    }

    // Tracks per-color score from the previous render so the party renderer
    // can pulse hero cards when THIS render delivered fresh gems to their color.
    let lastScoreSnapshot = {};

    function fullRender() {
        annotateParty();
        const justReceived = new Set();
        for (const [color, score] of Object.entries(game.scoreThisTurn ?? {})) {
            const prev = lastScoreSnapshot[color] ?? 0;
            if (score > prev) justReceived.add(color);
        }
        lastScoreSnapshot = { ...(game.scoreThisTurn ?? {}) };

        renderParty(partyEl, game.party, {
            onHeroClick: showCharacterSheet,
            scoreByColor: game.scoreThisTurn,
            justReceived,
        });
        renderStashShelf(stashShelfEl, metaStash);
        renderResources(resourcesEl, { rations: game.rations, torches: game.torches, darkness: game.darkness });
        renderFactionChips(factionsEl, game.factions, FACTIONS);
        setBanner(bannerEl, game.phase);

        const inCombatLike = game.phase === 'combat' || game.phase === 'post-combat';
        playAreaEl.classList.toggle('hidden', !inCombatLike);
        const mapHidden = inCombatLike
            || game.phase === 'event'
            || game.phase === 'recruit'
            || game.phase === 'victory'
            || game.phase === 'defeat';
        mapEl.classList.toggle('hidden', mapHidden);

        if (inCombatLike && game.encounter) {
            renderBoard(boardEl, game.board.snapshot(), selected);
            renderEnemies(enemyEl, game.encounter.enemies, { boss: game.isBossFloor() });
            renderEncounterHeader(headerEl, {
                name: game.encounterName(),
                floorLabel: game.floorLabel(),
                boss: game.isBossFloor(),
                act: game.currentAct(),
            });
            renderScoreTally(scoreEl, game.scoreThisTurn);
            const ultBtn = renderUltMeter(ultEl, game.encounter.ultMeter, ULT_FULL, game.canCastUltimate());
            if (ultBtn) ultBtn.onclick = onCastUltimate;
            renderSpellTray(spellTrayEl, game.party, {
                canCast: (spellId, casterId) => game.canCastSpell(spellId, casterId),
                onCast: onCastSpell,
            });
            spellTrayEl.classList.remove('hidden');
        } else {
            spellTrayEl.classList.add('hidden');
        }

        if (game.phase === 'map') {
            renderMap(mapEl, game.map, {
                currentNodeId: game.currentNodeId,
                reachableIds: game.reachableNodes().map(n => n.id),
                onPickNode: onPickNode,
                questMarkers: game.questMarkersByNode?.() ?? {},
            });
        }

        commitBtn.disabled = game.phase !== 'combat' || isAnimating;

        if (game.phase === 'post-combat') {
            renderRestScreen(overlayEl, {
                elementOffers: game.elementOffers,
                lootOffer: game.lootOffer,
                party: game.party,
                onPickElement: (idx) => {
                    const picked = game.pickElementOffer(idx);
                    if (picked) {
                        addToStash(metaStash.elements, picked.elementId, picked.grade, 1);
                        saveMetaStash();
                        const name = getElement(picked.elementId)?.name ?? picked.elementId;
                        renderLog(logEl, [{ type: 'event', message: `Stashed ${name} (grade ${GRADES[picked.grade - 1]}).` }]);
                    }
                    fullRender();
                    afterAction();
                },
                onPickLoot: (heroId) => {
                    const result = game.pickItem(heroId);
                    if (result === true) {
                        renderLog(logEl, [{ type: 'event', message: 'The party stows the loot.' }]);
                    } else if (result === 'inventory-full') {
                        renderLog(logEl, [{ type: 'event', message: 'That hero has no room.' }]);
                    }
                    fullRender();
                    afterAction();
                },
                onSkipLoot: () => {
                    game.skipLoot();
                    fullRender();
                    afterAction();
                },
                onCamp: () => {
                    const result = game.camp();
                    if (result === 'fitful') {
                        renderLog(logEl, [{ type: 'event', message: 'No rations — the party rests poorly and loses HP.' }]);
                    } else if (result === 'rested') {
                        renderLog(logEl, [{ type: 'event', message: 'The party rests, consuming 1 ration.' }]);
                    }
                    fullRender();
                    afterAction();
                },
                onAdvance: () => {
                    game.advance();
                    hideOverlay(overlayEl);
                    selected = null;
                    fullRender();
                    afterAction();
                    if (game.phase === 'combat') resetTimer();
                },
            });
            stopTimer();
        } else if (game.phase === 'event') {
            renderEventOverlay(overlayEl, game.currentEvent, {
                onResolve: (choiceId) => {
                    const result = game.resolveEvent(choiceId);
                    if (result?.message) {
                        renderLog(logEl, [{ type: 'event', message: `${result.eventId}: ${result.message}` }]);
                    }
                    hideOverlay(overlayEl);
                    fullRender();
                    afterAction();
                },
                isAvailable: (choice) => isChoiceAvailable(game, choice),
            });
            stopTimer();
        } else if (game.phase === 'recruit') {
            renderRecruitOverlay(overlayEl, game.recruitOffer, game.party, MAX_PARTY_SIZE, {
                onAccept: () => {
                    const result = game.acceptRecruit();
                    if (result === true) {
                        renderLog(logEl, [{ type: 'event', message: `Recruit joined the party.` }]);
                    }
                    hideOverlay(overlayEl);
                    fullRender();
                    afterAction();
                },
                onReplace: (heroId) => {
                    const dropped = game.party.find(h => h.id === heroId)?.name ?? heroId;
                    const result = game.acceptRecruit(heroId);
                    if (result === true) {
                        renderLog(logEl, [{ type: 'event', message: `${dropped} departs; recruit joins in their place.` }]);
                    }
                    hideOverlay(overlayEl);
                    fullRender();
                    afterAction();
                },
                onDecline: () => {
                    game.declineRecruit();
                    hideOverlay(overlayEl);
                    fullRender();
                    afterAction();
                },
            });
            stopTimer();
        } else if (game.phase === 'victory' || game.phase === 'defeat') {
            renderEndScreen(overlayEl, {
                status: game.phase,
                onRestart: () => startGame({ seed: Date.now() }),
            });
            stopTimer();
        } else if (game.phase === 'map') {
            hideOverlay(overlayEl);
            stopTimer();
        } else {
            hideOverlay(overlayEl);
        }
    }

    function onPickNode(nodeId) {
        if (game.phase !== 'map') return;
        const before = game.phase;
        const node = game.map.nodes[nodeId];
        game.pickNode(nodeId);
        selected = null;
        // Log camp/event resolutions to the combat log so the player gets feedback
        if (node.type === 'camp') {
            renderLog(logEl, [{ type: 'event', message: 'Rest site: party rests and recovers.' }]);
        }
        fullRender();
        afterAction();
        if (game.phase === 'combat') resetTimer();
    }

    async function onCellClick(ev) {
        const cell = ev.target.closest('.gem');
        if (!cell) return;
        if (game.phase !== 'combat' || isAnimating) return;
        const r = Number(cell.dataset.r);
        const c = Number(cell.dataset.c);
        if (selected === null) {
            selected = { r, c };
            fullRender();
            return;
        }
        if (selected.r === r && selected.c === c) {
            selected = null;
            fullRender();
            return;
        }
        if (game.board.isAdjacent(selected.r, selected.c, r, c)) {
            const result = game.trySwap(selected.r, selected.c, r, c);
            const swapTarget = cell;
            selected = null;
            if (!result.ok) {
                fullRender();
                flashInvalid(swapTarget);
                return;
            }
            isAnimating = true;
            commitBtn.disabled = true;
            try {
                await playCascadeAnimation(boardEl, result.cascades, game.board.snapshot());
            } finally {
                isAnimating = false;
            }
            fullRender();
            afterAction();
        } else {
            selected = { r, c };
            fullRender();
        }
    }

    function flashInvalid(cell) {
        cell.classList.add('invalid');
        setTimeout(() => cell.classList.remove('invalid'), 200);
    }

    function buildNameLookup() {
        const map = {};
        for (const h of game.party ?? []) map[h.id] = h.name;
        for (const e of game.encounter?.enemies ?? []) map[e.id] = e.name;
        return map;
    }

    function commitTurn() {
        if (game.phase !== 'combat' || isAnimating) return;
        const result = game.commitTurn();
        if (result) {
            renderLog(logEl, result.events, { nameById: buildNameLookup() });
            // Render first so the float anchors point at fresh card positions.
            fullRender();
            playEventFloats(result.events);
        } else {
            fullRender();
        }
        afterAction();
        if (game.phase === 'combat') resetTimer();
    }

    function onCastUltimate() {
        if (!game.canCastUltimate() || isAnimating) return;
        const result = game.castUltimate();
        if (result) {
            renderLog(logEl, result.events, { nameById: buildNameLookup() });
            fullRender();
            playEventFloats(result.events);
        } else {
            fullRender();
        }
        afterAction();
    }

    function onCastSpell(spellId, casterId) {
        if (game.phase !== 'combat' || isAnimating) return;
        const result = game.castSpell(spellId, casterId);
        if (!result) return;
        renderLog(logEl, result.events, { nameById: buildNameLookup() });
        fullRender();
        playEventFloats(result.events);
        afterAction();
    }

    function showCharacterSheet(heroId) {
        const hero = game.party.find(p => p.id === heroId);
        if (!hero) return;
        annotateParty();
        renderCharacterSheet(overlayEl, hero, {
            onClose: () => {
                hideOverlay(overlayEl);
                fullRender();
            },
            onEquip: (itemId) => {
                equipItem(hero, itemId);
                showCharacterSheet(heroId);
                afterAction();
            },
            onUnequip: (slot) => {
                unequipItem(hero, slot);
                showCharacterSheet(heroId);
                afterAction();
            },
            canEquipItem: canEquip,
        });
    }

    function tickTimer() {
        timerSecondsLeft -= 1;
        timerEl.textContent = `${timerSecondsLeft}s`;
        if (timerSecondsLeft <= 5) timerEl.classList.add('warn');
        if (timerSecondsLeft <= 0) commitTurn();
    }

    function resetTimer() {
        timerSecondsLeft = TURN_TIMER_SECONDS;
        timerEl.textContent = `${timerSecondsLeft}s`;
        timerEl.classList.remove('warn');
        if (activeTimer) clearInterval(activeTimer);
        activeTimer = setInterval(tickTimer, 1000);
    }

    function stopTimer() {
        if (activeTimer) {
            clearInterval(activeTimer);
            activeTimer = null;
        }
        timerEl.textContent = '—';
        timerEl.classList.remove('warn');
    }

    boardEl.onclick = onCellClick;
    commitBtn.onclick = commitTurn;
    newRunBtn.onclick = () => onRequestNewRun();
    questsBtn.onclick = () => {
        renderQuestLog(overlayEl, game.quests, {
            generated: game.generatedQuestSummaries?.() ?? [],
            onClose: () => { hideOverlay(overlayEl); fullRender(); },
        });
    };
    codexBtn.onclick = () => {
        renderCodex(overlayEl, game.codex, {
            onClose: () => { hideOverlay(overlayEl); fullRender(); },
        });
    };
    function openElementsOverlay() {
        renderElementsOverlay(overlayEl, metaStash, {
            canUsePotions: game.phase !== 'victory' && game.phase !== 'defeat',
            onCraftUpgrade: (elementId, fromGrade) => {
                if (craftUpgrade(metaStash.elements, elementId, fromGrade)) {
                    saveMetaStash();
                    renderLog(logEl, [{ type: 'event', message: `Crafted 1 grade-${GRADES[fromGrade]} ${getElement(elementId)?.name}.` }]);
                }
                openElementsOverlay();
            },
            onCraftPotion: (potionId) => {
                if (craftPotion(metaStash.elements, metaStash.potions, potionId)) {
                    saveMetaStash();
                    renderLog(logEl, [{ type: 'event', message: `Brewed ${getPotion(potionId)?.name}.` }]);
                }
                openElementsOverlay();
            },
            onUsePotion: (potionId) => {
                const msg = usePotion(metaStash.potions, potionId, game);
                if (msg) {
                    saveMetaStash();
                    persistence.saveActiveRun(game.toJSON()).catch(() => {});
                    renderLog(logEl, [{ type: 'event', message: `Drank ${getPotion(potionId)?.name}: ${msg}` }]);
                }
                openElementsOverlay();
                fullRender();
            },
            onClose: () => { hideOverlay(overlayEl); fullRender(); },
        });
    }
    elementsBtn.onclick = openElementsOverlay;
    historyBtn.onclick = () => openHistory();

    async function openHistory() {
        const records = await persistence.listRunHistory(50).catch(() => []);
        renderHistoryOverlay(overlayEl, records, {
            onReplay: (seed) => onReplaySeed(seed),
            onReset: async () => {
                try {
                    await persistence.clearAll();
                    // The in-memory game keeps running, but its DB save has
                    // been wiped — mark it archived so we don't try to push
                    // an end-of-run record for a now-orphaned game.
                    game._archived = true;
                } catch {/* ignore */}
                openHistory();
            },
            onClose: () => { hideOverlay(overlayEl); fullRender(); },
        });
    }

    fullRender();

    // ----- helpers below are nested so they capture `game` -----

    function saveActive() {
        // Fire-and-forget; persistence is best-effort and silent on failure.
        if (game.phase === 'victory' || game.phase === 'defeat') return;
        persistence.saveActiveRun(game.toJSON()).catch(() => {});
    }

    async function endRunIfFinished() {
        if (game.phase !== 'victory' && game.phase !== 'defeat') return;
        if (game._archived) return;
        game._archived = true;
        const record = buildRunHistoryRecord(game, game.phase);
        try {
            await persistence.appendRunHistory(record);
            await persistence.clearActiveRun();
        } catch {/* ignore */}
    }

    /** Persistence checkpoint after any state-mutating action. */
    function afterAction() {
        saveActive();
        endRunIfFinished();
    }

    async function onRequestNewRun() {
        // Active mid-run? Archive as 'abandoned' before starting fresh.
        if (game.phase !== 'victory' && game.phase !== 'defeat') {
            try {
                await persistence.appendRunHistory(buildRunHistoryRecord(game, 'abandoned'));
                await persistence.clearActiveRun();
            } catch {/* ignore */}
        }
        startGame({ seed: Date.now() });
    }

    function onReplaySeed(seed) {
        startGame({ seed });
    }
}
function buildRunHistoryRecord(game, outcome) {
    const node = game.currentNodeId ? game.map?.nodes?.[game.currentNodeId] : null;
    return {
        seed: game.seed,
        startedAt: game.runStartedAt,
        endedAt: Date.now(),
        outcome,
        finalDepth: node?.distance ?? 0,
        mapDepth: game.map?.depth ?? 0,
        encounterName: game.currentTemplate?.name ?? null,
        bossName: game.isBossFloor() ? game.encounterName() : null,
        party: game.party.map(p => ({ name: p.name, role: p.role, level: p.level, alive: p.alive })),
        codexCount: game.codex.length,
        questsCompleted: game.completedQuests().length,
    };
}

// ----- boot: try to resume a saved run, otherwise start fresh -----

async function boot() {
    // Load persistent meta-stash once at startup (element/potion counts).
    try {
        const raw = await persistence.loadMetaStash();
        metaStash = normalizeMetaStash(raw);
    } catch {/* ignore */}

    let saved = null;
    try {
        saved = await persistence.loadActiveRun();
    } catch {/* ignore */}
    if (!saved) {
        startGame({ seed: Date.now() });
        return;
    }
    const overlayEl = document.getElementById('overlay');
    renderResumePrompt(overlayEl, saved, {
        onResume: () => {
            try {
                const restored = Game.fromJSON(saved);
                startGame({ restored });
            } catch (err) {
                console.error('failed to restore run:', err);
                persistence.clearActiveRun().catch(() => {});
                startGame({ seed: Date.now() });
            }
        },
        onDiscard: async () => {
            try {
                await persistence.appendRunHistory(buildRunHistoryRecord(Game.fromJSON(saved), 'abandoned'));
            } catch {/* ignore */}
            await persistence.clearActiveRun().catch(() => {});
            startGame({ seed: Date.now() });
        },
    });
}

boot();
