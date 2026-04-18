// Lore registry: short text fragments the party can collect during a run.
// Discovered fragments live in `game.codex` and are viewable from the HUD.
// All run-scoped — wipes on a new run.

export const LORE = {
    'inscription-stone': {
        id: 'inscription-stone',
        title: 'Inscription on a Black Stone',
        body: 'He who holds the gem holds the world. He who shatters it holds nothing.',
    },
    'epitaph-tod': {
        id: 'epitaph-tod',
        title: 'Tod Uphill, Lockfingered',
        body: 'A halfling rogue. Picked half the doors in the Underdark, missed the trap on the last one. Buried with his lockpicks.',
    },
    'epitaph-beorham': {
        id: 'epitaph-beorham',
        title: 'Beorham the Bright',
        body: 'A paladin who walked into the dark to bring back the dawn. The dawn never came; his armor remained.',
    },
    'epitaph-ileria': {
        id: 'epitaph-ileria',
        title: 'Ileria of the Spire',
        body: 'A mage who spoke nine dead tongues. The tenth, she was learning when she fell.',
    },
    'pedestal-riddle': {
        id: 'pedestal-riddle',
        title: 'A Pedestal Riddle',
        body: 'The crystals hum. The stones beneath bear words: "Color of dawn opens the door; the others bite."',
    },
};

export function getLore(id) {
    return LORE[id] ?? null;
}

export function listLoreIds() {
    return Object.keys(LORE);
}
