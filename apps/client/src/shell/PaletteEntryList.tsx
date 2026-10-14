import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Kbd, SectionLabel } from '@adecore/ui';
import { wantsNewWindow } from '@/project/windows';
import { optionId, type Entry } from '@/shell/palette-entries';

export function PaletteNote({ children }: { children: ReactNode }) {
    return <div className="px-3 py-6 text-center text-xs text-text-faint">{children}</div>;
}

/* The rows of a list mode under the label of each section they fall in. */
export function PaletteEntryList({
    entries,
    active,
    onHover,
    onRun
}: {
    entries: readonly Entry[];
    active: Entry | undefined;
    onHover(index: number): void;
    onRun(entry: Entry, newWindow: boolean): void;
}) {
    const { t } = useTranslation(['shell']);
    return entries.map((entry, i) => {
        const first = i === 0 || entries[i - 1]!.section !== entry.section;
        return (
            <div key={entry.id}>
                {first && (
                    <SectionLabel render={<div />} className="px-2.5 pt-1.5 pb-1">
                        {t(`palette.sections.${entry.section}`)}
                    </SectionLabel>
                )}
                <button
                    id={optionId(i)}
                    role="option"
                    aria-selected={entry === active}
                    data-active={entry === active}
                    className="cursor-row flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-text-muted"
                    onMouseEnter={() => onHover(i)}
                    onClick={(e) => onRun(entry, wantsNewWindow(e))}
                >
                    <span className="shrink-0 text-text-faint">{entry.icon}</span>
                    <span className="min-w-0 truncate">{entry.label}</span>
                    {entry.hint && <span className="min-w-0 shrink-[1000] truncate text-xs text-text-faint">{entry.hint}</span>}
                    <span className="grow" />
                    {entry.trailing}
                    {entry.shortcut && <Kbd shortcut={entry.shortcut} variant="inline" className="shrink-0" />}
                </button>
            </div>
        );
    });
}
