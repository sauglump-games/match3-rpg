// Slay-the-Spire-style branching run map.
//
// Structure: layered DAG. Each layer has 1..N nodes; edges only go from layer L
// to layer L+1. The player starts at the layer-0 frontier and picks one node;
// after clearing it, the player picks among that node's outgoing edges.
//
// Layer composition:
//   layer 0:           three combat nodes (the player chooses a starting path)
//   layers 1..N-3:     mixed nodes weighted toward combat
//   layer N-2:         a single mandatory camp (rest before the boss)
//   layer N-1:         the boss

import { mulberry32 } from './rng.js';

export const NODE_TYPES = ['combat', 'elite', 'camp', 'event', 'boss'];

export const NODE_GLYPH = {
    combat: '⚔',
    elite:  '☠',
    camp:   '⛺',
    event:  '?',
    boss:   '👑',
};

export const NODE_LABEL = {
    combat: 'Combat',
    elite:  'Elite',
    camp:   'Rest Site',
    event:  'Event',
    boss:   'Boss',
};

const DEFAULT_DEPTH = 6;

const TYPE_WEIGHTS = {
    combat: 6,
    elite:  1.5,
    camp:   1.5,
    event:  1,
};

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

export function generateMap({ seed = Date.now(), depth = DEFAULT_DEPTH } = {}) {
    if (depth < 4) throw new Error('map depth must be >= 4');
    const rng = mulberry32(seed);
    const layers = [];
    let counter = 0;
    const newNode = (type, col, layerIdx) => ({
        id: `n${counter++}`, type, layer: layerIdx, col, next: [],
    });

    // Layer 0: three combat entries
    layers.push([
        newNode('combat', 0, 0),
        newNode('combat', 1, 0),
        newNode('combat', 2, 0),
    ]);

    // Middle layers
    for (let L = 1; L <= depth - 3; L++) {
        const width = 2 + Math.floor(rng() * 3); // 2-4
        const layer = [];
        for (let i = 0; i < width; i++) {
            layer.push(newNode(pickWeighted(rng, TYPE_WEIGHTS), i, L));
        }
        layers.push(layer);
    }

    // Penultimate layer: mandatory camp
    layers.push([newNode('camp', 0, depth - 2)]);

    // Boss layer
    layers.push([newNode('boss', 0, depth - 1)]);

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

    return { layers, nodes, depth };
}

/** Convenience: list of all nodes in layer order. */
export function flatNodes(map) {
    const out = [];
    for (const layer of map.layers) for (const n of layer) out.push(n);
    return out;
}
