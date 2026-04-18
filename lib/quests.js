// Quest registry. Quests are multi-step objectives the player accepts during
// a run (typically by engaging an event). Each step is marked complete via
// `Game.advanceQuestStep(questId, stepId)`. Completing the last step calls
// the quest's `reward(game)` and flips its state to 'completed'.
//
// Quests are run-scoped: they reset on a new run.

const QUEST_TEMPLATES = {
    'aid-the-dwarves': {
        id: 'aid-the-dwarves',
        title: 'Aid the Dwarves',
        description: 'A dwarven scout begs help. Find their lost banner and return it.',
        steps: [
            { id: 'find-banner',   label: 'Find the dwarven banner' },
            { id: 'return-banner', label: 'Return the banner to the Dwarven Camp' },
        ],
        reward(game, deps) {
            game.adjustFaction('dwarves', +1);
            const item = deps.pickRandomItem(['rare', 'uncommon']);
            return deps.giveItemToParty(item, 'The dwarves swear allegiance and press a token of gratitude into your hands');
        },
    },

    'severed-hand': {
        id: 'severed-hand',
        title: 'The Severed Hand',
        description: 'A black-iron hand was wrenched from the dwarven king. Return it to camp.',
        steps: [
            { id: 'find-hand',    label: 'Find the black-iron hand' },
            { id: 'deliver-hand', label: 'Deliver the hand to the Dwarven Camp' },
        ],
        reward(game, deps) {
            game.adjustFaction('dwarves', +1);
            const item = deps.pickRandomItem(['rare']);
            return deps.giveItemToParty(item, 'The dwarves restore their king\'s honor and gift you a rare weapon');
        },
    },

    'free-the-prisoner': {
        id: 'free-the-prisoner',
        title: 'Free the Prisoner',
        description: 'A drow patrol drags a captive past — decide their fate.',
        steps: [
            { id: 'resolve', label: 'Free the prisoner' },
        ],
        reward(game) {
            // Concrete effects (faction shift, recruit, item) happen in the
            // event choice itself; the reward is just the closing log line.
            if (game.questFlags.prisonerBribed) return 'The prisoner walks free, the drow appeased.';
            if (game.questFlags.prisonerLiberatedByForce) return 'The prisoner is free; the drow remember.';
            return 'The prisoner is free.';
        },
    },

    'phylactery-riddle': {
        id: 'phylactery-riddle',
        title: 'The Phylactery Riddle',
        description: 'Three inscriptions name the Lich King\'s phylactery. Find all three to shatter it.',
        steps: [
            { id: 'clue-1', label: 'Find the first inscription' },
            { id: 'clue-2', label: 'Find the second inscription' },
            { id: 'clue-3', label: 'Find the third inscription' },
        ],
        reward(game) {
            game.questFlags.phylacteryRiddleSolved = true;
            return 'You hold the true name. The phylactery shall not survive your blade.';
        },
    },

    'hydra-hunt': {
        id: 'hydra-hunt',
        title: 'Hunger of the Hydra',
        description: 'A Hydra stalks the dungeon. Hunt it before it follows you to the boss chamber.',
        steps: [
            { id: 'defeat-hydra', label: 'Defeat or evade the Hydra' },
        ],
        reward(game, deps) {
            const item = deps.pickRandomItem(['uncommon']);
            return deps.giveItemToParty(item, 'The Hydra falls. You salvage a trophy from its hoard');
        },
    },

    'cult-mole': {
        id: 'cult-mole',
        title: 'The Cult Mole',
        description: 'A doubting acolyte offers to sabotage the Lich King from within.',
        steps: [
            { id: 'befriend', label: 'Befriend the acolyte' },
        ],
        reward(game) {
            game.questFlags.cultMoleSet = true;
            return 'They slip back into the cult, ready to weaken your enemy at the moment of truth.';
        },
    },
};

export function listQuestIds() {
    return Object.keys(QUEST_TEMPLATES);
}

export function getQuestTemplate(id) {
    return QUEST_TEMPLATES[id] ?? null;
}

/** Build a fresh quest instance from its template (deep-copies the steps). */
export function instantiateQuest(templateId) {
    const tmpl = QUEST_TEMPLATES[templateId];
    if (!tmpl) return null;
    return {
        id: tmpl.id,
        title: tmpl.title,
        description: tmpl.description,
        state: 'active',
        steps: tmpl.steps.map(s => ({ ...s, completed: false })),
    };
}
