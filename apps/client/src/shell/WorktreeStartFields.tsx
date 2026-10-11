import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModelPicker } from '@adecore/agents-react/chat/ui/Pickers';
import { useProviders } from '@adecore/agents-react/state/providers';
import { FieldHint, FormError, Input } from '@adecore/ui';
import type { WorktreeStart } from '@/shell/use-worktree-start';

/* The branch name, the base with the commit it names, and the model, for a dialog that starts a chat in a worktree. */
export function WorktreeStartFields({ start, idPrefix, onSubmit }: { start: WorktreeStart; idPrefix: string; onSubmit(): void }) {
    const { t } = useTranslation('shell');
    const providers = useProviders((s) => s.providers);
    const pickable = providers.filter((entry) => entry.installed && entry.capabilities.chat);
    const [pickerOpen, setPickerOpen] = useState(false);
    const submitOnEnter = (e: React.KeyboardEvent): void => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            onSubmit();
        }
    };
    return (
        <>
            <label className="mt-3 block text-xs text-text-muted" htmlFor={`${idPrefix}-branch`}>
                {t('newWorktreeChat.branchLabel')}
            </label>
            <Input
                id={`${idPrefix}-branch`}
                mono
                className="mt-1"
                value={start.branch}
                spellCheck={false}
                onChange={(e) => start.setBranch(e.target.value)}
                onKeyDown={submitOnEnter}
            />
            {start.branchProblem !== null && <FormError className="mt-1">{start.branchProblem}</FormError>}
            <label className="mt-3 block text-xs text-text-muted" htmlFor={`${idPrefix}-base`}>
                {t('newWorktreeChat.baseLabel')}
            </label>
            <Input
                id={`${idPrefix}-base`}
                mono
                className="mt-1"
                list={`${idPrefix}-refs`}
                value={start.base}
                spellCheck={false}
                onChange={(e) => start.setBase(e.target.value)}
                onKeyDown={submitOnEnter}
            />
            <datalist id={`${idPrefix}-refs`}>
                {(start.refs?.refs ?? []).map((ref) => (
                    <option key={`${ref.kind}:${ref.name}`} value={ref.name} />
                ))}
            </datalist>
            <FieldHint>
                {start.commit === 'missing'
                    ? t('newWorktreeChat.baseMissing')
                    : start.baseKnown && start.commit !== null
                      ? t('newWorktreeChat.baseCommit', { commit: start.commit.commit.slice(0, 7), subject: start.commit.subject })
                      : t('newWorktreeChat.baseLooking')}
            </FieldHint>
            {start.provider !== null && start.selection !== null && pickable.length > 0 && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-muted">{t('newWorktreeChat.model')}</span>
                    <ModelPicker
                        providers={pickable}
                        provider={start.provider}
                        selection={start.selection}
                        open={pickerOpen}
                        onOpenChange={setPickerOpen}
                        onChange={(provider, model) => start.pickProvider(provider, { model, options: {} })}
                    />
                </div>
            )}
        </>
    );
}
