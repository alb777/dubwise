// @ts-check
/**
 * The action log: what was typed, how each idea was read and by whom, how long the AI took and what failed. It stays
 * in this browser, the last entries in localStorage, until `log save` downloads it, so a problem met on another
 * computer can be looked at later. Pure apart from its storage, so the tests can drive it.
 * @typedef {{ at: string, visit: string, event: string } & Record<string, unknown>} Entry
 */

const KEY = "dubwise-log";
/** The longest text an entry keeps: an idea fits, a pasted riddim is cut short. */
const TEXT = 300;

/** Long texts cut short. @param {Record<string, unknown>} details */
function clip(details) {
    return Object.fromEntries(
        Object.entries(details).map(([key, value]) => [
            key,
            typeof value === "string" && value.length > TEXT ? `${value.slice(0, TEXT)}…` : value,
        ]),
    );
}

/**
 * @param {{ storage?: Storage, limit?: number, now?: () => Date }} [options] storage defaults to localStorage
 */
export function createLog({ storage, limit = 500, now = () => new Date() } = {}) {
    /** Tells the visits apart, as a page reload starts a new one. */
    const visit = Math.random().toString(36).slice(2, 8);

    /** @returns {Entry[] | null} null when storage is blocked, as in some private windows */
    function read() {
        try {
            const saved = JSON.parse((storage ?? globalThis.localStorage).getItem(KEY) ?? "[]");
            return Array.isArray(saved) ? saved : [];
        } catch {
            return null;
        }
    }

    /** The entries as last written, which is all the log has while storage is blocked. */
    let entries = read() ?? [];

    function write() {
        try {
            (storage ?? globalThis.localStorage).setItem(KEY, JSON.stringify(entries));
        } catch {
            // Blocked or full: the log still holds this visit.
        }
    }

    return {
        /**
         * Note what happened. `at`, `visit` and `event` are the log's own keys.
         * @param {string} event @param {Record<string, unknown>} [details]
         */
        add(event, details = {}) {
            // Read first, so two tabs add to one log instead of writing over each other's entries.
            entries = [...(read() ?? entries), { at: now().toISOString(), visit, event, ...clip(details) }].slice(
                -limit,
            );
            write();
        },
        /** @returns {Entry[]} */
        entries: () => read() ?? entries,
        clear() {
            entries = [];
            write();
        },
    };
}

/** One line for the console: the local time, what happened and its details. @param {Entry} entry */
export function describeEntry({ at, visit, event, ...details }) {
    const date = new Date(at);
    const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
        .map((n) => String(n).padStart(2, "0"))
        .join(":");
    const text = Object.entries(details)
        .map(([key, value]) => `${key} ${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join(", ");
    return `${time} ${event}${text ? `: ${text}` : ""}`;
}
