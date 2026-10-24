import { useTranslation } from 'react-i18next';
import { ArrowUp, ChevronDown } from 'lucide-react';
import type { GitActionKind } from '@ruimte/contracts';
import { pushAllButton, pushable, type PushButton, type PushEntry } from '@/shell/panels/git-actions';
import { Button, ButtonGroup, Icon, Menu, Tooltip } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';

interface PushMenuProps {
    /* What a folder with a single repository pushes; with more than one the button pushes them all. */
    button: PushButton;
    /* The checkout that single button belongs to; null while no repository is read yet. */
    active: string | null;
    /* Every repository the panel draws. */
    entries: readonly PushEntry[];
    busy: boolean;
    onPush(cwd: string, kind: GitActionKind): void;
    onPushAll(): void;
}

/*
 * The split button in the header: the left half says how many commits go out and pushes them, over
 * every repository at once when there are several, and the chevron opens the flyout that pushes or
 * publishes one on its own. A branch without an upstream is published, which the left half then says.
 */
export function PushMenu({ button, active, entries, busy, onPush, onPushAll }: PushMenuProps) {
    const { t } = useTranslation('panels');
    const one = entries.length <= 1;
    const main = one ? button : pushAllButton(entries);
    const ahead = (one ? entries : pushable(entries)).reduce((count, entry) => count + entry.ahead, 0);
    const anyRow = entries.some((entry) => !entry.button.disabled);

    return (
        <ButtonGroup render={<span />}>
            <Tooltip label={main.reason}>
                <Button
                    size="sm"
                    variant="secondary"
                    className="rounded-r-none tabular-nums"
                    aria-label={main.label}
                    disabled={main.disabled || busy || (one && active === null)}
                    onClick={() => {
                        if (!one) {
                            onPushAll();
                        } else if (active !== null) {
                            onPush(active, button.kind);
                        }
                    }}
                >
                    {main.kind === 'publish' ? (
                        main.label
                    ) : (
                        <>
                            <Icon icon={ArrowUp} size={14} />
                            {formatNumber(ahead)}
                        </>
                    )}
                </Button>
            </Tooltip>
            <Menu.Root>
                <Tooltip label={t('git.push.one')} name>
                    <Menu.Trigger render={<Button size="sm" variant="secondary" className="rounded-l-none px-1.5" disabled={!anyRow || busy} />}>
                        <Icon icon={ChevronDown} size={14} />
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Popup className="w-72" align="end">
                    {entries.map((entry) => (
                        <Menu.Item key={entry.cwd} disabled={busy || entry.button.disabled} onClick={() => onPush(entry.cwd, entry.button.kind)}>
                            <span className="truncate">{entry.label}</span>
                            <span className="grow" />
                            <Menu.Hint className="truncate">{entry.button.disabled ? entry.button.reason : entry.button.label}</Menu.Hint>
                            {entry.ahead > 0 && (
                                <span className="flex shrink-0 items-center text-text-faint">
                                    <Icon icon={ArrowUp} size={12} />
                                    <span className="tabular-nums">{formatNumber(entry.ahead)}</span>
                                </span>
                            )}
                        </Menu.Item>
                    ))}
                </Menu.Popup>
            </Menu.Root>
        </ButtonGroup>
    );
}
