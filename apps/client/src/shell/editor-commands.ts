import {
    ArrowDownToLine,
    ArrowUpToLine,
    Book,
    BookOpen,
    BoxSelect,
    CaseSensitive,
    ChevronsDownUp,
    ChevronsUpDown,
    Code,
    Columns3,
    CornerDownLeft,
    CornerLeftUp,
    FoldHorizontal,
    FoldVertical,
    IndentIncrease,
    ListChecks,
    ListCollapse,
    ListTree,
    Merge,
    ScanSearch,
    Slash,
    Split,
    TextCursor,
    UnfoldVertical,
    type LucideIcon
} from 'lucide-react';
import i18next from 'i18next';
import type { Shortcut } from '@adecore/ui';
import type { EditorRunCommand } from '@adecore/editor';
import { editorShortcut } from '@/shell/editor-keymap';
import { editorForCommand } from '@/shell/panels/focused-editor';

/*
 * The editing commands of a file editor that have a place in the menu and the palette, with their words
 * at `shell:menu.<key>` and `shell:palette.commands.<key>`. A table of their own, so a menu can list
 * them without loading an editor; the command table (`shell/command-table.ts`) takes them in.
 */
interface EditorCommandSpec {
    readonly key: string;
    readonly icon: LucideIcon;
    readonly command: EditorRunCommand;
    readonly shortcut?: Shortcut;
    /* A group the Code menu keeps its own submenu for. */
    readonly group?: 'folding';
}

const TABLE = {
    'toggle-line-comment': { icon: Slash, key: 'toggleLineComment', command: 'toggleLineComment', shortcut: editorShortcut('toggleLineComment') },
    'toggle-block-comment': { icon: Code, key: 'toggleBlockComment', command: 'toggleBlockComment', shortcut: editorShortcut('toggleBlockComment') },
    'join-lines': { icon: Merge, key: 'joinLines', command: 'joinLines', shortcut: editorShortcut('joinLines') },
    'split-line': { icon: Split, key: 'splitLine', command: 'splitLine', shortcut: editorShortcut('splitLine') },
    'start-new-line': { icon: CornerDownLeft, key: 'startNewLine', command: 'startNewLine', shortcut: editorShortcut('startNewLine') },
    'start-new-line-before': { icon: CornerLeftUp, key: 'startNewLineBefore', command: 'startNewLineBefore', shortcut: editorShortcut('startNewLineBefore') },
    'toggle-case': { icon: CaseSensitive, key: 'toggleCase', command: 'toggleCase', shortcut: editorShortcut('toggleCase') },
    'auto-indent-lines': { icon: IndentIncrease, key: 'autoIndentLines', command: 'autoIndentLines', shortcut: editorShortcut('autoIndentLines') },
    'collapse-region': { icon: FoldVertical, key: 'collapseRegion', command: 'collapseRegion', shortcut: editorShortcut('collapse'), group: 'folding' },
    'expand-region': { icon: UnfoldVertical, key: 'expandRegion', command: 'expandRegion', shortcut: editorShortcut('expand'), group: 'folding' },
    'collapse-region-recursively': {
        icon: ListCollapse,
        key: 'collapseRegionRecursively',
        command: 'collapseRegionRecursively',
        shortcut: editorShortcut('collapseRecursively'),
        group: 'folding'
    },
    'expand-region-recursively': {
        icon: ListTree,
        key: 'expandRegionRecursively',
        command: 'expandRegionRecursively',
        shortcut: editorShortcut('expandRecursively'),
        group: 'folding'
    },
    'collapse-all-regions': {
        icon: ChevronsDownUp,
        key: 'collapseAllRegions',
        command: 'collapseAllRegions',
        shortcut: editorShortcut('collapseAll'),
        group: 'folding'
    },
    'expand-all-regions': {
        icon: ChevronsUpDown,
        key: 'expandAllRegions',
        command: 'expandAllRegions',
        shortcut: editorShortcut('expandAll'),
        group: 'folding'
    },
    'fold-selection': { icon: FoldHorizontal, key: 'foldSelection', command: 'foldSelection', shortcut: editorShortcut('foldSelection'), group: 'folding' },
    'collapse-doc-comments': {
        icon: Book,
        key: 'collapseDocComments',
        command: 'collapseDocComments',
        shortcut: editorShortcut('collapseDocComments'),
        group: 'folding'
    },
    'expand-doc-comments': {
        icon: BookOpen,
        key: 'expandDocComments',
        command: 'expandDocComments',
        shortcut: editorShortcut('expandDocComments'),
        group: 'folding'
    },
    'expand-all-to-level-1': {
        icon: ListTree,
        key: 'expandAllToLevel1',
        command: 'expandAllToLevel1',
        shortcut: editorShortcut('expandAllToLevel1'),
        group: 'folding'
    },
    'expand-all-to-level-2': {
        icon: ListTree,
        key: 'expandAllToLevel2',
        command: 'expandAllToLevel2',
        shortcut: editorShortcut('expandAllToLevel2'),
        group: 'folding'
    },
    'expand-all-to-level-3': {
        icon: ListTree,
        key: 'expandAllToLevel3',
        command: 'expandAllToLevel3',
        shortcut: editorShortcut('expandAllToLevel3'),
        group: 'folding'
    },
    'expand-all-to-level-4': {
        icon: ListTree,
        key: 'expandAllToLevel4',
        command: 'expandAllToLevel4',
        shortcut: editorShortcut('expandAllToLevel4'),
        group: 'folding'
    },
    'expand-all-to-level-5': {
        icon: ListTree,
        key: 'expandAllToLevel5',
        command: 'expandAllToLevel5',
        shortcut: editorShortcut('expandAllToLevel5'),
        group: 'folding'
    },
    'select-next-occurrence': {
        icon: ScanSearch,
        key: 'selectNextOccurrence',
        command: 'selectNextOccurrence',
        shortcut: editorShortcut('selectNextOccurrence')
    },
    'unselect-occurrence': { icon: BoxSelect, key: 'unselectOccurrence', command: 'unselectOccurrence', shortcut: editorShortcut('unselectOccurrence') },
    'select-all-occurrences': {
        icon: ListChecks,
        key: 'selectAllOccurrences',
        command: 'selectAllOccurrences',
        shortcut: editorShortcut('selectAllOccurrences')
    },
    'add-caret-above': { icon: ArrowUpToLine, key: 'addCaretAbove', command: 'addCaretAbove', shortcut: editorShortcut('addCaretAbove') },
    'add-caret-below': { icon: ArrowDownToLine, key: 'addCaretBelow', command: 'addCaretBelow', shortcut: editorShortcut('addCaretBelow') },
    'toggle-column-mode': { icon: Columns3, key: 'toggleColumnMode', command: 'toggleColumnMode', shortcut: editorShortcut('toggleColumnMode') },
    'add-caret-per-selected-line': {
        icon: TextCursor,
        key: 'addCaretPerSelectedLine',
        command: 'addCaretPerSelectedLine',
        shortcut: editorShortcut('addCaretPerSelectedLine')
    }
} satisfies Record<string, EditorCommandSpec>;

export type EditorCommandId = keyof typeof TABLE;

export const EDITOR_COMMANDS: Record<EditorCommandId, EditorCommandSpec> = TABLE;

export const EDITOR_COMMAND_IDS = Object.keys(EDITOR_COMMANDS) as EditorCommandId[];

interface EditorCommandRow {
    id: string;
    label: string;
    shortcut?: Shortcut;
    run(): void;
}

/* The palette's rows for the editing commands. They run after the palette has handed the focus back, which is what says which editor is meant. */
export function editorCommandRows(): EditorCommandRow[] {
    return EDITOR_COMMAND_IDS.map((id) => ({
        id,
        label: i18next.t(`shell:palette.commands.${EDITOR_COMMANDS[id].key}`),
        shortcut: EDITOR_COMMANDS[id].shortcut,
        run: () => {
            requestAnimationFrame(() => {
                editorForCommand()?.runCommand(EDITOR_COMMANDS[id].command);
            });
        }
    }));
}
