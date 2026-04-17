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
    renderRelicShelf,
    renderUltMeter,
    renderMap,
    renderEventOverlay,
    renderSpellTray,
    renderCharacterSheet,
    hideOverlay,
    setBanner,
    playCascadeAnimation,
    playEventFloats,
} from './ui.js';
import { ULT_FULL } from './combat.js';
import { spellsForHero } from './spells.js';
import { getRelic } from './relics.js';
import { xpForLevel } from './game.js';

const TURN_TIMER_SECONDS = 45;

function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`missing element #${id}`);
    return el;
}

let activeTimer = null;
let activeGame = null;

function startGame(seed) {
    if (activeTimer) clearInterval(activeTimer);

    const game = new Game({ seed });
    activeGame = game;
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
    const relicShelfEl = $('relic-shelf');
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

    function fullRender() {
        annotateParty();
        renderParty(partyEl, game.party, { onHeroClick: showCharacterSheet });
        renderRelicShelf(relicShelfEl, game.ownedRelics());
        setBanner(bannerEl, game.phase);

        const inCombatLike = game.phase === 'combat' || game.phase === 'post-combat';
        playAreaEl.classList.toggle('hidden', !inCombatLike);
        mapEl.classList.toggle('hidden', inCombatLike || game.phase === 'event' || game.phase === 'victory' || game.phase === 'defeat');

        if (inCombatLike && game.encounter) {
            renderBoard(boardEl, game.board.snapshot(), selected);
            renderEnemies(enemyEl, game.encounter.enemies, { boss: game.isBossFloor() });
            renderEncounterHeader(headerEl, {
                name: game.encounterName(),
                floorLabel: game.floorLabel(),
                boss: game.isBossFloor(),
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
            });
        }

        commitBtn.disabled = game.phase !== 'combat' || isAnimating;

        if (game.phase === 'post-combat') {
            renderRestScreen(overlayEl, {
                offers: game.relicOffers.map(id => getRelic(id)).filter(Boolean),
                onPickRelic: (id) => {
                    game.pickRelic(id);
                    fullRender();
                },
                onSkipReward: () => {
                    game.skipReward();
                    fullRender();
                },
                onCamp: () => {
                    game.camp();
                    fullRender();
                },
                onAdvance: () => {
                    game.advance();
                    hideOverlay(overlayEl);
                    selected = null;
                    fullRender();
                    if (game.phase === 'combat') resetTimer();
                },
            });
            stopTimer();
        } else if (game.phase === 'event') {
            renderEventOverlay(overlayEl, game.currentEvent, {
                onResolve: () => {
                    const result = game.resolveEvent();
                    if (result?.message) {
                        renderLog(logEl, [{ type: 'event', message: `${result.eventId}: ${result.message}` }]);
                    }
                    hideOverlay(overlayEl);
                    fullRender();
                },
            });
            stopTimer();
        } else if (game.phase === 'victory' || game.phase === 'defeat') {
            renderEndScreen(overlayEl, {
                status: game.phase,
                onRestart: () => startGame(Date.now()),
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
        } else {
            selected = { r, c };
            fullRender();
        }
    }

    function flashInvalid(cell) {
        cell.classList.add('invalid');
        setTimeout(() => cell.classList.remove('invalid'), 200);
    }

    function commitTurn() {
        if (game.phase !== 'combat' || isAnimating) return;
        const result = game.commitTurn();
        if (result) {
            renderLog(logEl, result.events);
            // Render first so the float anchors point at fresh card positions.
            fullRender();
            playEventFloats(result.events);
        } else {
            fullRender();
        }
        if (game.phase === 'combat') resetTimer();
    }

    function onCastUltimate() {
        if (!game.canCastUltimate() || isAnimating) return;
        const result = game.castUltimate();
        if (result) {
            renderLog(logEl, result.events);
            fullRender();
            playEventFloats(result.events);
        } else {
            fullRender();
        }
    }

    function onCastSpell(spellId, casterId) {
        if (game.phase !== 'combat' || isAnimating) return;
        const result = game.castSpell(spellId, casterId);
        if (!result) return;
        renderLog(logEl, result.events);
        fullRender();
        playEventFloats(result.events);
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
    newRunBtn.onclick = () => startGame(Date.now());

    fullRender();
    // Don't start the timer until we're in combat
}

startGame(Date.now());
