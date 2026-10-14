import {
    canMoveCell,
    canSplit,
    cellAt,
    cellCount,
    closeCell,
    closeCellsRightOf,
    closeOtherCells,
    dropView,
    evenCells,
    evenColumns,
    focusCell,
    focusDirection,
    focusedViewId,
    isSameCell,
    moveCell,
    showViewIn,
    singleLayout,
    undoShowView
} from '@/shell/split';
import type { DocumentState } from '@/state/document';
import { canStandInCell, type DocumentKit } from '@/state/document-model';

/* Which view stands in which cell, which cell has the focus, and how big each is. */
export function createDocumentGridSlice({
    set,
    get,
    commit
}: DocumentKit): Pick<
    DocumentState,
    | 'setActiveView'
    | 'showView'
    | 'undoShowView'
    | 'dropViewAt'
    | 'moveCellTo'
    | 'splitFocused'
    | 'closeCellAt'
    | 'closeOtherCells'
    | 'closeCellsRightOf'
    | 'focusCellAt'
    | 'toggleMaximized'
    | 'focusTowards'
    | 'resizeColumns'
    | 'resizeCells'
    | 'evenColumns'
    | 'evenCells'
    | 'setBodyFocused'
> {
    return {
        setActiveView(id) {
            const state = get();
            if (!canStandInCell(state, id) || state.activeViewId === id) {
                return;
            }
            if (state.layout === null) {
                commit(singleLayout(id));
                return;
            }
            const shown = showViewIn(state.layout, id);
            if (shown !== null) {
                commit(shown.layout);
            }
        },

        showView(id, options) {
            const state = get();
            if (!canStandInCell(state, id)) {
                return null;
            }
            if (state.layout === null) {
                commit(singleLayout(id));
                return null;
            }
            const shown = showViewIn(state.layout, id, options);
            if (shown !== null) {
                commit(shown.layout);
            }
            return shown;
        },

        undoShowView(shown) {
            const state = get();
            if (state.layout !== null) {
                // A loose view that was replaced is closed by now, and a closed tab does not come back with this.
                const back = shown.replaced !== null && !canStandInCell(state, shown.replaced) ? { ...shown, replaced: null } : shown;
                commit(undoShowView(state.layout, back));
            }
        },

        dropViewAt(viewId, at, zone) {
            const state = get();
            if (state.layout === null || !canStandInCell(state, viewId) || !canSplit(state.layout, at, zone, viewId)) {
                return;
            }
            commit(dropView(state.layout, viewId, at, zone));
        },

        moveCellTo(from, at, zone) {
            const state = get();
            if (state.layout !== null && canMoveCell(state.layout, from, at, zone)) {
                commit(moveCell(state.layout, from, at, zone));
            }
        },

        splitFocused(direction, viewId) {
            const state = get();
            if (state.layout !== null) {
                get().dropViewAt(viewId, state.layout.focus, direction);
            }
        },

        closeCellAt(at) {
            const state = get();
            if (state.layout === null) {
                return;
            }
            const next = closeCell(state.layout, at);
            if (next !== state.layout) {
                commit(next);
            }
        },

        closeOtherCells(at) {
            const state = get();
            const next = state.layout === null ? null : closeOtherCells(state.layout, at);
            if (next !== null && next !== state.layout) {
                commit(next);
            }
        },

        closeCellsRightOf(at) {
            const state = get();
            const next = state.layout === null ? null : closeCellsRightOf(state.layout, at);
            if (next !== null && next !== state.layout) {
                commit(next);
            }
        },

        focusCellAt(at) {
            const state = get();
            // Asked on every press and every focus inside a cell, so the cell that already has it
            // costs nothing, since a commit writes every editor back.
            if (state.layout !== null && cellAt(state.layout, at) !== null && !isSameCell(state.layout.focus, at)) {
                commit(focusCell(state.layout, at));
            }
        },

        toggleMaximized() {
            const state = get();
            if (state.maximized !== null) {
                set({ maximized: null });
                return;
            }
            if (state.layout !== null && cellCount(state.layout) > 1) {
                set({ maximized: focusedViewId(state.layout) });
            }
        },

        focusTowards(direction) {
            const state = get();
            if (state.layout !== null) {
                commit(focusDirection(state.layout, direction));
            }
        },

        /* A drag is not a move of the grid, since no editor opens or closes, so it sets the sizes alone. */
        resizeColumns(sizes) {
            set((state) => {
                if (state.layout === null || sizes.length !== state.layout.columns.length) {
                    return {};
                }
                const columns = state.layout.columns.map((column, index) => ({ ...column, size: sizes[index]! }));
                return { layout: { ...state.layout, columns } };
            });
        },

        resizeCells(column, sizes) {
            set((state) => {
                const held = state.layout?.columns[column];
                if (!state.layout || !held || sizes.length !== held.cells.length) {
                    return {};
                }
                const cells = held.cells.map((cell, index) => ({ ...cell, size: sizes[index]! }));
                const columns = state.layout.columns.map((candidate, index) => (index === column ? { ...candidate, cells } : candidate));
                return { layout: { ...state.layout, columns } };
            });
        },

        evenColumns(at, all) {
            set((state) => (state.layout === null ? {} : { layout: evenColumns(state.layout, at, all) }));
        },

        evenCells(column, at, all) {
            set((state) => (state.layout === null ? {} : { layout: evenCells(state.layout, column, at, all) }));
        },

        setBodyFocused(focused) {
            set({ bodyFocused: focused });
        }
    };
}
