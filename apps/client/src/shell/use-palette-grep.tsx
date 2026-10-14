import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaseSensitive, Regex, WholeWord } from 'lucide-react';
import { ButtonGroup, Kbd, KEY_SHORTCUTS } from '@adecore/ui';
import { PaletteNote } from '@/shell/PaletteEntryList';
import { optionId, type PaletteContext, type PaletteModeView } from '@/shell/palette-entries';
import { DEFAULT_GREP_OPTIONS, useGrepSearch, type GrepOptions } from '@/shell/palette-grep';
import { PaletteGrepResults } from '@/shell/PaletteGrepResults';
import { PaletteSearchToggle } from '@/shell/PaletteSearchToggle';
import { useUi } from '@/state/ui';

/* Find in files: the lines of the project folder that match the field, with the three ways a match is read. */
export function usePaletteGrep(
    context: PaletteContext,
    { enabled, folder, openFile }: { enabled: boolean; folder: string | null; openFile(path: string, line: number | null): void }
): PaletteModeView {
    const { t } = useTranslation(['shell']);
    const { query, index, setIndex, close } = context;
    const [grepOptions, setGrepOptions] = useState<GrepOptions>(DEFAULT_GREP_OPTIONS);
    const grep = useGrepSearch(enabled ? folder : null, enabled ? query : '', grepOptions);
    const count = grep.matches.length;
    const activeHit = Math.min(index, count - 1);

    const runHit = (at: number): void => {
        const match = grep.matches[at];
        if (!match) {
            return;
        }
        close();
        openFile(match.path, match.line);
    };

    return {
        count,
        activeOptionId: activeHit >= 0 ? optionId(activeHit) : undefined,
        enter: () => runHit(activeHit),
        // The mode leaves the way it was entered: one key, nothing typed.
        back: () => {
            useUi.getState().setPaletteMode('default');
            return true;
        },
        trailing: (
            <ButtonGroup render={<span />}>
                <PaletteSearchToggle
                    icon={CaseSensitive}
                    label={t('palette.matchCase')}
                    active={grepOptions.caseSensitive}
                    onClick={() => setGrepOptions((current) => ({ ...current, caseSensitive: !current.caseSensitive }))}
                />
                <PaletteSearchToggle
                    icon={WholeWord}
                    label={t('palette.wholeWords')}
                    active={grepOptions.wholeWord}
                    onClick={() => setGrepOptions((current) => ({ ...current, wholeWord: !current.wholeWord }))}
                />
                <PaletteSearchToggle
                    icon={Regex}
                    label={t('palette.regex')}
                    active={grepOptions.regex}
                    onClick={() => setGrepOptions((current) => ({ ...current, regex: !current.regex }))}
                />
            </ButtonGroup>
        ),
        notes: (
            <>
                {query.trim() !== '' && !grep.busy && grep.failure === null && grep.matches.length === 0 && (
                    <PaletteNote>{t('palette.noLineMatch')}</PaletteNote>
                )}
                {query.trim() === '' && <PaletteNote>{t('palette.typeToSearch')}</PaletteNote>}
            </>
        ),
        results: <PaletteGrepResults matches={grep.matches} active={activeHit} optionId={optionId} onHover={(at) => setIndex(at)} onRun={(at) => runHit(at)} />,
        footer: (
            <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-text-faint">
                {grep.failure !== null ? (
                    <span className="text-status-error" role="alert">
                        {grep.failure}
                    </span>
                ) : (
                    <span>
                        {grep.matches.length === 0
                            ? t('palette.nothingYet')
                            : t('palette.grepCount', { count: grep.files, hits: `${grep.matches.length}${grep.truncated ? '+' : ''}` })}
                    </span>
                )}
                <span className="grow" />
                <span>
                    <Kbd shortcut={KEY_SHORTCUTS.enter} variant="inline" /> {t('palette.grepEnterHint')}{' '}
                    <Kbd shortcut={KEY_SHORTCUTS.backspace} variant="inline" /> {t('palette.grepBackHint')}
                </span>
            </div>
        )
    };
}
