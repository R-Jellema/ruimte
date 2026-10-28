const PREPARE = 'textDocument/prepareCallHierarchy';
const FOLLOW_UPS = new Set(['callHierarchy/incomingCalls', 'callHierarchy/outgoingCalls', 'typeHierarchy/supertypes', 'typeHierarchy/subtypes']);
// These answer plain arrays of items.
const TYPE_ITEMS = new Set(['textDocument/prepareTypeHierarchy', 'typeHierarchy/supertypes', 'typeHierarchy/subtypes']);
const TAG = '$ruimteServer';

interface Tagged {
    [TAG]: string;
    data: unknown;
}

function isTagged(data: unknown): data is Tagged {
    return typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>)[TAG] === 'string';
}

function tagItem(item: unknown, server: string): unknown {
    if (typeof item !== 'object' || item === null) {
        return item;
    }
    const data: Tagged = { [TAG]: server, data: (item as { data?: unknown }).data };
    return { ...item, data };
}

/* The item a client sends back, plain again for the server, with the process that made it. Null for an item no process tagged. */
export function pinnedItem(method: string, params: object): { server: string; params: object } | null {
    if (!FOLLOW_UPS.has(method)) {
        return null;
    }
    const item = (params as { item?: { data?: unknown } }).item;
    if (item === undefined || !isTagged(item.data)) {
        return null;
    }
    const { data, ...rest } = item as { data: Tagged };
    const original = data.data;
    return { server: data[TAG], params: { ...params, item: { ...rest, ...(original === undefined ? {} : { data: original }) } } };
}

/*
 * Marks the items an answer hands out with the process that made them, inside their `data` field, which a
 * client sends back whole. Two servers can offer a call or type hierarchy, and the follow-up has to reach the one that made the item.
 */
export function tagHierarchy(method: string, result: unknown, server: string): unknown {
    if (!Array.isArray(result)) {
        return result;
    }
    if (method === PREPARE || TYPE_ITEMS.has(method)) {
        return result.map((item) => tagItem(item, server));
    }
    const side = method === 'callHierarchy/incomingCalls' ? 'from' : method === 'callHierarchy/outgoingCalls' ? 'to' : null;
    if (side === null) {
        return result;
    }
    return result.map((call) =>
        typeof call === 'object' && call !== null ? { ...call, [side]: tagItem((call as Record<string, unknown>)[side], server) } : call
    );
}
