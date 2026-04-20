// STRIPS-style forward planner used by the quest generator.
//
// Problem shape:
//   initialState: string[]         — facts like 'at(party,n3)', 'has(party,relic)'
//   goals:        string[][]       — alternative conjunctive goals; first reachable wins
//   actions:      Action[]         — { name, precond, add, del }
//
// findPlan does breadth-first search over the set of fact-sets; the first goal
// whose conjunction is entailed by a reachable state returns its action path.
// `maxStates` caps the frontier so a pathological problem can't hang the game.

/**
 * @typedef {{name: string, precond: string[], add: string[], del: string[]}} Action
 */

const DEFAULT_MAX_STATES = 20000;

/**
 * Search for a sequence of actions that satisfies any of the supplied goals.
 * Returns `{ plan, goalAchieved }` or null if no goal is reachable within
 * `maxStates` distinct states.
 */
export function findPlan(initialState, goals, actions, { maxStates = DEFAULT_MAX_STATES } = {}) {
    for (const goal of goals) {
        const plan = bfs(initialState, goal, actions, maxStates);
        if (plan !== null) return { plan, goalAchieved: goal };
    }
    return null;
}

function bfs(initialState, goal, actions, maxStates) {
    const start = new Set(initialState);
    if (satisfies(start, goal)) return [];

    const queue = [{ props: start, plan: [] }];
    const visited = new Set([stateKey(start)]);

    while (queue.length > 0) {
        const current = queue.shift();

        for (const action of actions) {
            if (!canApply(current.props, action)) continue;
            const nextProps = applyAction(current.props, action);
            const key = stateKey(nextProps);
            if (visited.has(key)) continue;

            const nextPlan = [...current.plan, action];
            if (satisfies(nextProps, goal)) return nextPlan;

            if (visited.size >= maxStates) return null;
            visited.add(key);
            queue.push({ props: nextProps, plan: nextPlan });
        }
    }
    return null;
}

/** True when every goal fact is present in the state. */
export function satisfies(state, goal) {
    for (const fact of goal) if (!state.has(fact)) return false;
    return true;
}

function canApply(state, action) {
    for (const p of action.precond) if (!state.has(p)) return false;
    return true;
}

function applyAction(state, action) {
    const next = new Set(state);
    for (const p of action.del) next.delete(p);
    for (const p of action.add) next.add(p);
    return next;
}

function stateKey(state) {
    return Array.from(state).sort().join('|');
}
