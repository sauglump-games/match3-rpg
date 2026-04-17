export const COLORS = ['ruby', 'sapphire', 'emerald', 'topaz', 'diamond', 'amethyst'];

const SPECIAL_NONE = null;
const SPECIAL_FLAME = 'flame';
const SPECIAL_HYPERCUBE = 'hypercube';

export class Board {
    constructor({ size = 8, rows = null, cols = null, rng = Math.random } = {}) {
        this.rows = rows ?? size;
        this.cols = cols ?? size;
        this.rng = rng;
        this.grid = this.#generateInitialGrid();
    }

    #randomColor() {
        return COLORS[Math.floor(this.rng() * COLORS.length)];
    }

    #newGem(color = null) {
        return { color: color ?? this.#randomColor(), special: SPECIAL_NONE };
    }

    #generateInitialGrid() {
        const grid = [];
        for (let r = 0; r < this.rows; r++) {
            const row = [];
            for (let c = 0; c < this.cols; c++) {
                let color;
                let attempts = 0;
                do {
                    color = this.#randomColor();
                    attempts++;
                } while (
                    attempts < 20 && (
                        (c >= 2 && row[c - 1].color === color && row[c - 2].color === color) ||
                        (r >= 2 && grid[r - 1][c].color === color && grid[r - 2][c].color === color)
                    )
                );
                row.push({ color, special: SPECIAL_NONE });
            }
            grid.push(row);
        }
        return grid;
    }

    inBounds(r, c) {
        return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
    }

    isAdjacent(r1, c1, r2, c2) {
        return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
    }

    /**
     * Attempt a swap. If it produces at least one match, resolve all cascades
     * and return { ok: true, cascades, scoreByColor, specialsSpawned }.
     * Otherwise revert and return { ok: false }.
     */
    swap(r1, c1, r2, c2) {
        if (!this.inBounds(r1, c1) || !this.inBounds(r2, c2)) return { ok: false };
        if (!this.isAdjacent(r1, c1, r2, c2)) return { ok: false };

        const a = this.grid[r1][c1];
        const b = this.grid[r2][c2];
        this.grid[r1][c1] = b;
        this.grid[r2][c2] = a;

        const matches = this.#findMatches();
        if (matches.length === 0) {
            this.grid[r1][c1] = a;
            this.grid[r2][c2] = b;
            return { ok: false };
        }

        return this.#resolveCascades(matches);
    }

    #findMatches() {
        const matches = [];
        for (let r = 0; r < this.rows; r++) {
            let start = 0;
            for (let c = 1; c <= this.cols; c++) {
                const endOfRun = c === this.cols || this.grid[r][c].color !== this.grid[r][start].color;
                if (endOfRun) {
                    if (c - start >= 3) {
                        matches.push({
                            color: this.grid[r][start].color,
                            cells: Array.from({ length: c - start }, (_, i) => ({ r, c: start + i })),
                            orientation: 'horizontal',
                        });
                    }
                    start = c;
                }
            }
        }
        for (let c = 0; c < this.cols; c++) {
            let start = 0;
            for (let r = 1; r <= this.rows; r++) {
                const endOfRun = r === this.rows || this.grid[r][c].color !== this.grid[start][c].color;
                if (endOfRun) {
                    if (r - start >= 3) {
                        matches.push({
                            color: this.grid[start][c].color,
                            cells: Array.from({ length: r - start }, (_, i) => ({ r: start + i, c })),
                            orientation: 'vertical',
                        });
                    }
                    start = r;
                }
            }
        }
        return matches;
    }

    #scoreForMatch(match, chain) {
        const len = match.cells.length;
        let multiplier = 1;
        if (len === 4) multiplier = 3;
        else if (len >= 5) multiplier = 8;
        return len * 10 * multiplier * chain;
    }

    #resolveCascades(initialMatches) {
        const cascades = [];
        const scoreByColor = {};
        const specialsSpawned = [];
        let chain = 0;
        let matches = initialMatches;

        while (matches.length > 0) {
            chain++;
            const preSnapshot = this.snapshot();
            const stepScore = {};
            const cellsToClear = new Set();
            const preserved = []; // { r, c, kind, color } — survives the clear, becomes a special

            for (const m of matches) {
                const value = this.#scoreForMatch(m, chain);
                stepScore[m.color] = (stepScore[m.color] || 0) + value;
                scoreByColor[m.color] = (scoreByColor[m.color] || 0) + value;

                let specialKind = null;
                if (m.cells.length === 4) specialKind = SPECIAL_FLAME;
                else if (m.cells.length >= 5) specialKind = SPECIAL_HYPERCUBE;

                const anchor = specialKind ? m.cells[Math.floor(m.cells.length / 2)] : null;
                for (const cell of m.cells) {
                    if (anchor && cell.r === anchor.r && cell.c === anchor.c) {
                        preserved.push({ r: cell.r, c: cell.c, kind: specialKind, color: m.color });
                    } else {
                        cellsToClear.add(`${cell.r},${cell.c}`);
                    }
                }
            }

            // Trigger any pre-existing specials located in cleared cells.
            const triggered = [];
            const queue = [...cellsToClear];
            const seen = new Set(queue);
            while (queue.length > 0) {
                const key = queue.shift();
                const [r, c] = key.split(',').map(Number);
                const gem = this.grid[r][c];
                if (!gem || !gem.special) continue;
                triggered.push({ kind: gem.special, color: gem.color, r, c });
                const newlyCleared = this.#expandFromSpecial(gem, r, c);
                for (const k of newlyCleared) {
                    cellsToClear.add(k);
                    if (!seen.has(k)) {
                        seen.add(k);
                        queue.push(k);
                    }
                }
            }

            for (const key of cellsToClear) {
                const [r, c] = key.split(',').map(Number);
                this.grid[r][c] = null;
            }

            for (const sp of preserved) {
                if (cellsToClear.has(`${sp.r},${sp.c}`)) continue;
                this.grid[sp.r][sp.c] = { color: sp.color, special: sp.kind };
                specialsSpawned.push({ kind: sp.kind, at: { r: sp.r, c: sp.c }, color: sp.color });
            }

            this.#collapseAndRefill();
            const postSnapshot = this.snapshot();
            cascades.push({
                chain,
                matches,
                scoreByColor: stepScore,
                triggered,
                preSnapshot,
                clearedCells: [...cellsToClear],
                postSnapshot,
            });
            matches = this.#findMatches();
        }

        return { ok: true, cascades, scoreByColor, specialsSpawned };
    }

    #expandFromSpecial(gem, r, c) {
        const cleared = [];
        if (gem.special === SPECIAL_FLAME) {
            for (let cc = 0; cc < this.cols; cc++) {
                cleared.push(`${r},${cc}`);
            }
            for (let rr = 0; rr < this.rows; rr++) {
                cleared.push(`${rr},${c}`);
            }
        } else if (gem.special === SPECIAL_HYPERCUBE) {
            for (let rr = 0; rr < this.rows; rr++) {
                for (let cc = 0; cc < this.cols; cc++) {
                    if (this.grid[rr][cc] && this.grid[rr][cc].color === gem.color) {
                        cleared.push(`${rr},${cc}`);
                    }
                }
            }
        }
        return cleared;
    }

    #collapseAndRefill() {
        for (let c = 0; c < this.cols; c++) {
            const surviving = [];
            for (let r = this.rows - 1; r >= 0; r--) {
                if (this.grid[r][c] !== null) surviving.push(this.grid[r][c]);
            }
            while (surviving.length < this.rows) {
                surviving.push(this.#newGem());
            }
            for (let r = this.rows - 1; r >= 0; r--) {
                this.grid[r][c] = surviving[this.rows - 1 - r];
            }
        }
    }

    /** Read-only snapshot for rendering. */
    snapshot() {
        return this.grid.map(row => row.map(gem => ({ ...gem })));
    }
}
