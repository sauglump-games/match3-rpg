// Slay-the-Spire-style branching run map.
//
// Structure: layered DAG. Each layer has 1..N nodes; edges only go from layer L
// to layer L+1. The player starts at the layer-0 frontier and picks one node;
// after clearing it, the player picks among that node's outgoing edges.
//
// Layer composition:
//   layer 0:           three combat nodes (the player chooses a starting path)
//   layers 1..N-3:     mixed nodes — width and type weights scale with depth
//   layer N-2:         a single mandatory camp (rest before the boss)
//   layer N-1:         the boss
//
// `depth` is the layered length of the run (and == shortest-path distance from
// any layer-0 entry to the boss). Each node also carries a `distance` field
// for clarity. With our strict layered DAG these match `node.layer`, but the
// field will stay correct if cross-layer / skip edges are added later.
//
// Map size and variance scale with party level: a fresh L1 group runs the
// default depth, while higher-level groups get longer maps with wider middle
// layers and more variance (more elites, recruits, events).

import { mulberry32 } from './rng.js';

export const NODE_TYPES = ['combat', 'elite', 'camp', 'event', 'recruit', 'boss'];

export const NODE_GLYPH = {
    combat:  '⚔',
    elite:   '☠',
    camp:    '⛺',
    event:   '?',
    recruit: '🤝',
    boss:    '👑',
};

export const NODE_LABEL = {
    combat:  'Combat',
    elite:   'Elite',
    camp:    'Rest Site',
    event:   'Event',
    recruit: 'Wandering Hero',
    boss:    'Boss',
};

export const MIN_MAP_DEPTH  = 4;
export const BASE_MAP_DEPTH = 10;       // L1 party default; was 6
export const DEPTH_PER_PARTY_LEVEL = 1; // every party level above 1 adds 1 more layer

function pickWeighted(rng, weights) {
    const entries = Object.entries(weights);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = rng() * total;
    for (const [k, w] of entries) {
        r -= w;
        if (r <= 0) return k;
    }
    return entries[entries.length - 1][0];
}

/**
 * Width of a middle layer based on its depth-fraction (0..1) across the run.
 * Early layers stay narrow (2-3); late middle layers fan out (3-5) so the
 * player has more meaningful route choices as the run thickens.
 */
function layerWidth(rng, fraction) {
    const min = fraction > 0.5 ? 3 : 2;
    const max = 3 + Math.min(2, Math.floor(fraction * 3));   // 3, 4, 5
    return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Type weights for a middle layer, biased by depth-fraction.
 * Early layers favor combat; later layers add more elites, events, recruits.
 */
function layerWeights(fraction) {
    return {
        combat:  6 - 3 * fraction,         // 6 → 3
        elite:   1.0 + 3 * fraction,       // 1 → 4
        camp:    1.5,
        event:   1 + 1 * fraction,         // 1 → 2
        recruit: 0.8 + 0.7 * fraction,     // 0.8 → 1.5
    };
}

/**
 * Compute an effective map depth from optional explicit value and party level.
 * partyLevel >= 1; each level above 1 adds DEPTH_PER_PARTY_LEVEL layers.
 */
export function effectiveMapDepth({ depth = null, partyLevel = 1 } = {}) {
    if (depth != null) return Math.max(MIN_MAP_DEPTH, depth);
    const lvl = Math.max(1, partyLevel);
    return Math.max(MIN_MAP_DEPTH, BASE_MAP_DEPTH + (lvl - 1) * DEPTH_PER_PARTY_LEVEL);
}

export function generateMap({ seed = Date.now(), depth = null, partyLevel = 1 } = {}) {
    const effDepth = effectiveMapDepth({ depth, partyLevel });
    if (effDepth < MIN_MAP_DEPTH) throw new Error(`map depth must be >= ${MIN_MAP_DEPTH}`);
    const rng = mulberry32(seed);
    const layers = [];
    let counter = 0;
    const newNode = (type, col, layerIdx) => ({
        id: `n${counter++}`,
        type,
        layer: layerIdx,
        distance: layerIdx,    // shortest-path distance from any layer-0 entry
        col,
        next: [],
    });

    // Layer 0: three combat entries
    layers.push([
        newNode('combat', 0, 0),
        newNode('combat', 1, 0),
        newNode('combat', 2, 0),
    ]);

    // Middle layers — width + weights scale with depth-fraction
    const middleCount = effDepth - 3;
    for (let L = 1; L <= middleCount; L++) {
        const fraction = middleCount === 0 ? 0 : (L - 1) / Math.max(1, middleCount - 1);
        const width = layerWidth(rng, fraction);
        const weights = layerWeights(fraction);
        const layer = [];
        for (let i = 0; i < width; i++) {
            layer.push(newNode(pickWeighted(rng, weights), i, L));
        }
        layers.push(layer);
    }

    // Penultimate: mandatory camp
    layers.push([newNode('camp', 0, effDepth - 2)]);

    // Boss layer
    layers.push([newNode('boss', 0, effDepth - 1)]);

    // Wire forward edges, biasing toward column-adjacent successors
    for (let L = 0; L < layers.length - 1; L++) {
        const cur = layers[L];
        const nxt = layers[L + 1];
        for (const node of cur) {
            const candidates = nxt.slice().sort((a, b) =>
                Math.abs(a.col - node.col) - Math.abs(b.col - node.col)
            );
            const numEdges = nxt.length === 1 ? 1 : 1 + Math.floor(rng() * 2);
            for (let k = 0; k < Math.min(numEdges, candidates.length); k++) {
                if (!node.next.includes(candidates[k].id)) {
                    node.next.push(candidates[k].id);
                }
            }
        }
        // Make sure every next-layer node is reachable
        const incoming = new Set();
        for (const node of cur) for (const id of node.next) incoming.add(id);
        for (const target of nxt) {
            if (incoming.has(target.id)) continue;
            const closest = cur.slice().sort((a, b) =>
                Math.abs(a.col - target.col) - Math.abs(b.col - target.col)
            )[0];
            if (closest && !closest.next.includes(target.id)) {
                closest.next.push(target.id);
            }
        }
    }

    const nodes = {};
    for (const layer of layers) for (const n of layer) nodes[n.id] = n;

    return { layers, nodes, depth: effDepth };
}

/** Convenience: list of all nodes in layer order. */
export function flatNodes(map) {
    const out = [];
    for (const layer of map.layers) for (const n of layer) out.push(n);
    return out;
}
