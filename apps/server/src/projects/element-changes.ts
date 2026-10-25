import type { DrawingDocument } from '@ruimte/contracts';

interface Seen {
    /* The oldest rev this machine saw the drawing at; what happened before it is unknown. */
    since: number;
    rev: number;
    elements: Map<string, string>;
    /* The rev at which each element last changed, appeared or went, as far as this machine saw. */
    changedAt: Map<string, number>;
}

/*
 * Which elements of a drawing changed after a given rev, from the documents this machine saw go by.
 * The file keeps only its latest rev, so this is what tells an agent's edit of one element apart from
 * a person's change to another. It lives in memory: after a restart only the rev the drawing is at counts.
 */
export class ElementChanges {
    private readonly views = new Map<string, Seen>();

    /* Takes in the document a view is at now, whoever wrote it. */
    note(key: string, document: DrawingDocument): void {
        // Keys in one order: a document read back from disk lists them as its schema does, a client's as it sent them.
        const elements = new Map(document.elements.map((element) => [element.id, JSON.stringify(element, Object.keys(element).sort())]));
        const seen = this.views.get(key);
        // A rev that went back is a file put back by hand or by git; the history before it says nothing.
        if (seen === undefined || document.rev < seen.rev) {
            this.views.set(key, { since: document.rev, rev: document.rev, elements, changedAt: new Map() });
            return;
        }
        for (const [id, text] of elements) {
            if (seen.elements.get(id) !== text) {
                seen.changedAt.set(id, document.rev);
            }
        }
        for (const id of seen.elements.keys()) {
            if (!elements.has(id)) {
                seen.changedAt.set(id, document.rev);
            }
        }
        seen.rev = document.rev;
        seen.elements = elements;
    }

    /* The ids among `ids` that changed after `revision`; every one of them when this machine never saw that revision. */
    changedSince(key: string, current: DrawingDocument, revision: number, ids: readonly string[]): string[] {
        this.note(key, current);
        const seen = this.views.get(key)!;
        if (revision < seen.since || revision > seen.rev) {
            return [...ids];
        }
        return ids.filter((id) => (seen.changedAt.get(id) ?? -1) > revision);
    }
}
