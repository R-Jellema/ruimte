import type { KeyboardEvent, ReactNode } from 'react';
import type { Command } from '@/shell/commands';

export interface Entry extends Command {
    icon: ReactNode;
    /* Set on a jump row for a node of the view on screen; an empty palette offers only those. */
    here?: boolean;
    /* Pushed to the end of the row, where a state belongs: the hint next to a name is about the name. */
    trailing?: ReactNode;
    /* What Cmd-click or Cmd+Enter (Ctrl off macOS) does instead of `run`, such as a project in a window of its own. */
    inNewWindow?: () => void;
    section: 'recent' | 'jump' | 'files' | 'views' | 'projects' | 'actions' | 'settings' | 'folders' | 'machines';
    /* The folder a browse row stands for: what Enter steps into, and what Tab completes the field
       to without stepping in. Navigating is the palette's own business, so such a row has no `run`. */
    browsePath?: string;
    /* What the row also answers to without showing it, such as the title and the address of a page. */
    keywords?: string;
}

/* What the palette shares with the mode on screen: the field and the highlight. */
export interface PaletteContext {
    open: boolean;
    query: string;
    setQuery(query: string): void;
    index: number;
    setIndex(index: number | ((index: number) => number)): void;
    close(): void;
}

/* One mode of the palette as the body draws it around the one field every mode shares. */
export interface PaletteModeView {
    /* What the arrow keys walk. */
    count: number;
    activeOptionId: string | undefined;
    enter(event: KeyboardEvent<HTMLInputElement>): void;
    /* Tab and Backspace in an empty field; true when the mode took the key. */
    tab?(): boolean;
    back?(): boolean;
    /* Over the bottom edge of the field, such as a search that is still running. */
    overlay?: ReactNode;
    leading?: ReactNode;
    trailing?: ReactNode;
    /* What the list says instead of rows, read out as it changes. */
    notes?: ReactNode;
    results: ReactNode;
    footer?: ReactNode;
}

export const LIST_ID = 'palette-list';

export function optionId(index: number): string {
    return `palette-option-${index}`;
}

export function matches(query: string, text: string): boolean {
    // Every typed word has to appear somewhere, in any order.
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = text.toLowerCase();
    return words.every((word) => haystack.includes(word));
}

/* Whether a row answers to the query, by what it shows and by what it only answers to. */
export function entryMatches(query: string, entry: Pick<Entry, 'label' | 'hint' | 'keywords'>): boolean {
    return matches(query, [entry.label, entry.hint, entry.keywords].filter(Boolean).join(' '));
}

/* A browser shows a page a person knows by its title and its address, not by the name of the node. */
export function pageKeywords(url: string | undefined, page: { url: string; title: string } | undefined): string {
    return [url, page?.url, page?.title].filter(Boolean).join(' ');
}

/* The row with the highlight. Every list opens with its first row highlighted. */
export function activeEntryOf(entries: readonly Entry[], index: number): Entry | undefined {
    return entries[Math.min(index, entries.length - 1)];
}
