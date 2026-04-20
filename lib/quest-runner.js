// Stateful wrapper around a generated quest. Tracks the evolving fact set,
// applies the player's map movement, auto-fires eligible non-travel actions
// (pickups, unlocks, etc.), and re-runs the planner whenever the world state
// changes — including on interferences, where an external event deletes or
// adds facts to the quest state.
//
// Status transitions:
//   active    — plan exists; goal not yet satisfied.
//   completed — any of the kit's goals is fully satisfied by current state.
//   failed    — no action sequence from current state satisfies any goal.

import { findPlan, satisfies } from './quest-planner.js';

/**
 * @param {object} quest  The object returned by generateQuest().
 * @returns {{
 *   state: () => Set<string>,
 *   plan: () => object[]|null,
 *   goal: () => string[]|null,
 *   status: () => 'active'|'completed'|'failed',
 *   location: () => string|null,
 *   enterNode: (nodeId: string) => string,
 *   applyInterference: (input: { label?: string, removeFacts?: string[], addFacts?: string[] }) => string,
 *   nextHint: () => string|null,
 * }}
 */
export function createQuestRunner(quest, { firedIds = [] } = {}) {
    const state = new Set(quest.initialState);
    let plan = quest.plan ? [...quest.plan] : null;
    let goalAchieved = quest.goalAchieved ?? null;
    const fired = new Set(firedIds);
    let status = evaluateStatus();

    function evaluateStatus() {
        for (const g of quest.goals) {
            if (satisfies(state, g)) return 'completed';
        }
        return plan === null ? 'failed' : 'active';
    }

    function partyLocation() {
        // Party location is encoded as `at(party,<nodeId>)` in the fact set.
        const prefix = 'at(party,';
        for (const f of state) {
            if (f.startsWith(prefix)) return f.slice(prefix.length, -1);
        }
        return null;
    }

    function applyAutoActions() {
        // Any non-travel action whose preconditions now hold fires automatically.
        // Loops to a fixed point so a pickup can immediately enable an unlock, etc.
        let changed = true;
        while (changed) {
            changed = false;
            for (const a of quest.actions) {
                if (a.name.startsWith('Travel(')) continue;
                if (!a.precond.every(p => state.has(p))) continue;
                const hasEffect = a.add.some(p => !state.has(p)) || a.del.some(p => state.has(p));
                if (!hasEffect) continue;
                for (const p of a.del) state.delete(p);
                for (const p of a.add) state.add(p);
                changed = true;
                break;
            }
        }
    }

    function replan() {
        const result = findPlan(Array.from(state), quest.goals, quest.actions);
        if (!result) {
            plan = null;
            goalAchieved = null;
            return;
        }
        plan = result.plan;
        goalAchieved = result.goalAchieved;
    }

    function enterNode(nodeId) {
        const from = partyLocation();
        if (from !== nodeId) {
            if (from) state.delete(`at(party,${from})`);
            state.add(`at(party,${nodeId})`);
        }
        applyAutoActions();
        replan();
        status = evaluateStatus();
        return status;
    }

    function applyInterference({ removeFacts = [], addFacts = [] } = {}) {
        for (const f of removeFacts) state.delete(f);
        for (const f of addFacts)    state.add(f);
        applyAutoActions();
        replan();
        status = evaluateStatus();
        return status;
    }

    function nextHint() {
        return plan && plan.length > 0 ? plan[0].name : null;
    }

    /**
     * Pick an eligible interference from the quest's grounded deck and apply
     * it. Eligible = not yet fired, and its `requires` fact (if any) currently
     * holds. `filter` narrows the deck further (by id / by trigger category).
     * Returns the card that fired, or null if nothing was eligible.
     */
    function drawInterference({ rng, filter = () => true } = {}) {
        const deck = quest.interferences ?? [];
        const eligible = [];
        for (const card of deck) {
            if (fired.has(card.id)) continue;
            if (card.requires && !state.has(card.requires)) continue;
            if (!filter(card)) continue;
            eligible.push(card);
        }
        if (eligible.length === 0) return null;
        const idx = rng ? Math.floor(rng() * eligible.length) : 0;
        const card = eligible[idx];
        fired.add(card.id);
        applyInterference({ removeFacts: card.remove, addFacts: card.add });
        return card;
    }

    function toSnapshot() {
        return {
            state: Array.from(state),
            plan: plan ? plan.map(a => a.name) : null,
            goalAchieved: goalAchieved ? [...goalAchieved] : null,
            firedIds: Array.from(fired),
        };
    }

    return {
        state:    () => new Set(state),
        plan:     () => (plan ? [...plan] : null),
        goal:     () => (goalAchieved ? [...goalAchieved] : null),
        status:   () => status,
        location: partyLocation,
        firedInterferences: () => new Set(fired),
        enterNode,
        applyInterference,
        drawInterference,
        nextHint,
        toSnapshot,
    };
}

/**
 * Rehydrate a runner from a snapshot produced by `runner.toSnapshot()`.
 * The quest object must match the one the snapshot was taken against (same
 * actions by name, same interferences, same goals).
 */
export function createQuestRunnerFromSnapshot(quest, snapshot) {
    const byName = new Map(quest.actions.map(a => [a.name, a]));
    const restoredPlan = snapshot.plan
        ? snapshot.plan.map(name => byName.get(name)).filter(Boolean)
        : null;
    return createQuestRunner(
        {
            ...quest,
            initialState: snapshot.state,
            plan: restoredPlan,
            goalAchieved: snapshot.goalAchieved,
        },
        { firedIds: snapshot.firedIds ?? [] },
    );
}
