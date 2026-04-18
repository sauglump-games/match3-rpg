// Run persistence backed by IndexedDB.
//
// Three stores under db `gem-crawler`:
//   - active-run    : single key 'current' holds the in-progress Game state
//                     (or absent if no run is active). Auto-saved after every
//                     player action; cleared when the run ends.
//   - run-history   : auto-incrementing log of completed/abandoned runs with
//                     metadata (seed, outcome, depth reached, party, etc.).
//                     Players can replay any past seed from the History view.
//   - meta          : long-lived meta progression (element stash, potion
//                     counts) that SURVIVES across runs. Single key 'stash'.

const DB_NAME = 'gem-crawler';
const DB_VERSION = 2;
const STORE_ACTIVE = 'active-run';
const STORE_HISTORY = 'run-history';
const STORE_META = 'meta';
const ACTIVE_KEY = 'current';
const META_KEY = 'stash';

export function isAvailable() {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDb() {
    return new Promise((resolve, reject) => {
        if (!isAvailable()) {
            reject(new Error('IndexedDB is not available in this environment.'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_ACTIVE)) {
                db.createObjectStore(STORE_ACTIVE);
            }
            if (!db.objectStoreNames.contains(STORE_HISTORY)) {
                db.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(STORE_META)) {
                db.createObjectStore(STORE_META);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB open blocked.'));
    });
}

function reqToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function withStore(storeName, mode, fn) {
    let db;
    try {
        db = await openDb();
    } catch (err) {
        // No IndexedDB available (e.g., private mode, JSDOM). Persistence
        // becomes a silent no-op in that case.
        return null;
    }
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = await fn(store);
    await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
        tx.onabort    = () => reject(tx.error);
    });
    db.close();
    return result;
}

// ----- active run -----

export async function saveActiveRun(state) {
    return withStore(STORE_ACTIVE, 'readwrite', store => reqToPromise(store.put(state, ACTIVE_KEY)));
}

export async function loadActiveRun() {
    return withStore(STORE_ACTIVE, 'readonly', store => reqToPromise(store.get(ACTIVE_KEY)));
}

export async function clearActiveRun() {
    return withStore(STORE_ACTIVE, 'readwrite', store => reqToPromise(store.delete(ACTIVE_KEY)));
}

// ----- run history -----

export async function appendRunHistory(record) {
    return withStore(STORE_HISTORY, 'readwrite', store => reqToPromise(store.add(record)));
}

export async function listRunHistory(limit = 50) {
    return withStore(STORE_HISTORY, 'readonly', store => new Promise((resolve, reject) => {
        const out = [];
        const req = store.openCursor(null, 'prev'); // newest first
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor && out.length < limit) {
                out.push(cursor.value);
                cursor.continue();
            } else {
                resolve(out);
            }
        };
        req.onerror = () => reject(req.error);
    }));
}

export async function clearRunHistory() {
    return withStore(STORE_HISTORY, 'readwrite', store => reqToPromise(store.clear()));
}

// ----- meta (persistent stash across runs) -----

export async function saveMetaStash(stash) {
    return withStore(STORE_META, 'readwrite', store => reqToPromise(store.put(stash, META_KEY)));
}

export async function loadMetaStash() {
    return withStore(STORE_META, 'readonly', store => reqToPromise(store.get(META_KEY)));
}

export async function clearMetaStash() {
    return withStore(STORE_META, 'readwrite', store => reqToPromise(store.delete(META_KEY)));
}

/** Wipe every store. Returns when all three have committed. */
export async function clearAll() {
    await clearActiveRun();
    await clearRunHistory();
    await clearMetaStash();
}
