import { CommandPalette } from '@adecore/ui';
import { wantsNewWindow } from '@/project/windows';
import type { Entry } from '@/shell/palette-entries';

/* A row of a list mode. Base UI clicks it for Enter without a modifier, so only a pointer brings one here. */
export function PaletteEntryItem({ entry, onRun }: { entry: Entry; onRun(entry: Entry, newWindow: boolean): void }) {
    return (
        <CommandPalette.Item
            value={entry}
            icon={entry.icon}
            hint={entry.hint || undefined}
            trailing={entry.trailing}
            shortcut={entry.shortcut}
            onClick={(event) => onRun(entry, wantsNewWindow(event))}
        >
            {entry.label}
        </CommandPalette.Item>
    );
}
