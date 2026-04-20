// Map-aware quest generator.
//
// A "kit" is a reusable quest blueprint. The generator grounds a kit against a
// concrete map: it picks nodes for the kit's entities (plants), auto-builds
// forward-only travel actions from the map's DAG edges, and invokes the kit's
// buildActions/buildGoals with a context object. The resulting STRIPS problem
// is fed to the planner to guarantee the quest is solvable given the node
// layout the player will actually see.
//
// Representation:
//   - Locations are map node IDs (e.g. 'n3'). The party is tracked as `at(party,<id>)`.
//   - Every directed map edge becomes one forward `Travel(a→b)` action.
//   - The player may start at any layer-0 entry node; we accept a problem if
//     at least one entry leads to a plan.
//
// Failure modes return `null` so callers can reroll with a new seed:
//   - A plant's `match` predicate matches no unclaimed node.
//   - The planner finds no solution from any entry node.

import { mulberry32 } from './rng.js';
import { findPlan } from './quest-planner.js';

/**
 * Generate a quest from a kit against the given map. Returns a grounded quest
 * problem and a verified plan, or null if the kit cannot be satisfied.
 *
 * @param {{ map: object, kit: object, seed: number, maxStates?: number }} args
 */
export function generateQuest({ map, kit, seed, maxStates }) {
    const rng = mulberry32(seed >>> 0);

    const plantings = plantEntities(map, kit.plants ?? [], rng);
    if (plantings === null) return null;

    const bossNodeId = findBossNodeId(map);
    const entryNodeIds = map.layers[0].map(n => n.id);
    const travelActions = buildTravelActions(map);
    const plantFacts = factsFromPlantings(plantings);

    const baseCtx = { map, plantings, bossNodeId, travelActions };
    const kitActions = kit.buildActions(baseCtx);
    const actions = [...travelActions, ...kitActions];
    const interferences = groundInterferences(kit.interferences ?? [], plantings);

    for (const entryNodeId of entryNodeIds) {
        const ctx = { ...baseCtx, entryNodeId };
        const initialState = [...plantFacts, `at(party,${entryNodeId})`];
        const goals = kit.buildGoals(ctx);
        const result = findPlan(initialState, goals, actions, { maxStates });
        if (result) {
            return {
                kitId: kit.id,
                title: kit.title,
                description: kit.description ?? '',
                plantings,
                bossNodeId,
                entryNodeId,
                initialState,
                goals,
                actions,
                interferences,
                plan: result.plan,
                goalAchieved: result.goalAchieved,
            };
        }
    }
    return null;
}

/**
 * Retry `generateQuest` with incrementing seeds until a solvable grounding is
 * found or attempts are exhausted. Useful for callers that don't care which
 * exact seed succeeds, only that the chosen kit fits this map.
 */
export function generateSolvableQuest({ map, kit, seed, attempts = 8, maxStates }) {
    for (let i = 0; i < attempts; i++) {
        const q = generateQuest({ map, kit, seed: (seed + i * 0x9E3779B1) >>> 0, maxStates });
        if (q) return q;
    }
    return null;
}

function plantEntities(map, plants, rng) {
    const claimed = new Set();
    const out = {};
    for (const plant of plants) {
        const candidates = [];
        for (const layer of map.layers) {
            for (const n of layer) {
                if (claimed.has(n.id)) continue;
                if (plant.match(n, map)) candidates.push(n);
            }
        }
        if (candidates.length === 0) return null;
        const pick = candidates[Math.floor(rng() * candidates.length)];
        claimed.add(pick.id);
        out[plant.entity] = {
            entity: plant.entity,
            label: plant.label ?? plant.entity,
            nodeId: pick.id,
            nodeType: pick.type,
        };
    }
    return out;
}

function factsFromPlantings(plantings) {
    const facts = [];
    for (const p of Object.values(plantings)) {
        facts.push(`at(${p.entity},${p.nodeId})`);
    }
    return facts;
}

function buildTravelActions(map) {
    const actions = [];
    for (const layer of map.layers) {
        for (const node of layer) {
            for (const nextId of node.next) {
                actions.push({
                    name: `Travel(${node.id}->${nextId})`,
                    precond: [`at(party,${node.id})`],
                    add: [`at(party,${nextId})`],
                    del: [`at(party,${node.id})`],
                });
            }
        }
    }
    return actions;
}

function findBossNodeId(map) {
    const last = map.layers[map.layers.length - 1];
    const boss = last.find(n => n.type === 'boss') ?? last[0];
    return boss.id;
}

/**
 * Substitute `$entity` tokens in an interference string with the node id where
 * that entity was planted. Returns null if the string references an entity not
 * present in plantings — the caller drops such interferences silently, since
 * a kit may declare optional cards that don't always ground.
 */
function substituteEntities(s, plantings) {
    let ok = true;
    const out = s.replace(/\$(\w+)/g, (_, entity) => {
        const p = plantings[entity];
        if (!p) { ok = false; return ''; }
        return p.nodeId;
    });
    return ok ? out : null;
}

function groundInterferences(rawCards, plantings) {
    const out = [];
    for (const raw of rawCards) {
        const requires = raw.requires ? substituteEntities(raw.requires, plantings) : null;
        if (raw.requires && requires === null) continue;

        const remove = [];
        let ok = true;
        for (const s of (raw.remove ?? [])) {
            const g = substituteEntities(s, plantings);
            if (g === null) { ok = false; break; }
            remove.push(g);
        }
        if (!ok) continue;

        const add = [];
        for (const s of (raw.add ?? [])) {
            const g = substituteEntities(s, plantings);
            if (g === null) { ok = false; break; }
            add.push(g);
        }
        if (!ok) continue;

        out.push({
            id: raw.id,
            label: raw.label,
            requires,
            remove,
            add,
        });
    }
    return out;
}
