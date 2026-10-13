import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@adecore/ui';
import type { PromptViewProps } from '@adecore/agents-react/prompts';
import { ApprovalActions, PromptPrimary, PromptCard } from '@adecore/agents-react/prompts';
import type { SecretRequest } from '@ruimte/contracts';
import { isRuimteApp } from '@/computer/ruimte-app';
import { computerButtons, SECRET_ANSWER_FIELD, SECRET_DECLINE, type RuimtePrompt } from '@/prompts/ruimte-prompts';

/* A card of Ruimte's own, drawn the way a chat draws its prompts: a waiting terminal, the machine asking to let an agent into an app, or an agent asking for a launch's secret. */
export function RuimtePromptView({ prompt, props }: { prompt: RuimtePrompt; props: PromptViewProps }) {
    const { t } = useTranslation('prompts');
    const { onAction, disabled, sending, error, top, onReveal } = props;
    const { data } = prompt;

    if (data.kind === 'terminal-waiting') {
        return (
            <PromptCard
                kind="waiting"
                heading={data.request ? t(`waiting.${data.request.kind}`, { tool: data.request.toolName }) : t('waiting.heading')}
                top={top}
                busy={false}
                notice={null}
                error={null}
                actions={
                    <div className="ml-auto flex items-center">
                        <PromptPrimary onClick={onReveal}>{t('waiting.goToTerminal')}</PromptPrimary>
                    </div>
                }
            >
                {data.request?.title && <p className="text-sm text-text">{data.request.title}</p>}
                {data.request?.text && (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-text select-text">{data.request.text}</pre>
                )}
                <p className="text-sm text-text-muted">{t('waiting.body')}</p>
            </PromptCard>
        );
    }

    if (data.kind === 'secret-request') {
        // Keyed on the request, so a field never carries what was typed for one card into the next.
        return <SecretCard key={data.request.requestId} request={data.request} props={props} />;
    }

    const { request } = data;
    const locked = sending || disabled;
    const buttons = computerButtons().map(({ action, ...button }) => ({ ...button, onPress: () => onAction(action) }));
    const words = { node: request.nodeTitle?.trim() || t('computer.unnamed'), project: request.projectName ?? '', app: request.app.name };
    return (
        <PromptCard
            kind="approval"
            heading={t('computer.heading', { app: request.app.name })}
            top={top}
            busy={sending}
            notice={disabled ? t('error.notConnected') : null}
            error={error}
            actions={<ApprovalActions buttons={buttons} locked={locked} sending={sending} />}
        >
            <p className="text-sm text-text">{request.projectName === null ? t('computer.bodyNoProject', words) : t('computer.body', words)}</p>
            <p className="break-all font-mono text-xs text-text-muted select-text">{request.app.bundleId}</p>
            <p className="text-xs text-text-muted">{t('computer.scope', { app: request.app.name })}</p>
            {isRuimteApp(request.app.bundleId) && <p className="text-xs text-text-muted">{t('computer.ruimte')}</p>}
        </PromptCard>
    );
}

/*
 * The value lives in this card's own state only, never in the stack's draft, and is cleared the
 * moment it is sent: a failed send asks for it again rather than keeping it around.
 */
function SecretCard({ request, props }: { request: SecretRequest; props: PromptViewProps }) {
    const { t } = useTranslation('prompts');
    const { onAction, disabled, sending, error, top } = props;
    const [value, setValue] = useState('');
    const locked = sending || disabled;
    const words = { launch: request.launchName, variable: request.variable };

    const save = (event?: FormEvent): void => {
        event?.preventDefault();
        if (locked || value === '') {
            return;
        }
        const sent = value;
        setValue('');
        onAction({ kind: 'answer', answers: { [SECRET_ANSWER_FIELD]: sent } });
    };

    return (
        <PromptCard
            kind="question"
            heading={request.label}
            top={top}
            busy={sending}
            notice={disabled ? t('error.notConnected') : null}
            error={error}
            actions={
                <>
                    <Button size="sm" disabled={locked} onClick={() => onAction({ kind: 'choose', choiceId: SECRET_DECLINE })}>
                        {t('secret.decline')}
                    </Button>
                    <span className="grow" />
                    <PromptPrimary disabled={locked || value === ''} onClick={() => save()}>
                        {t('secret.save')}
                    </PromptPrimary>
                </>
            }
        >
            <p className="text-sm text-text">{t('secret.body', words)}</p>
            <p className="whitespace-pre-wrap break-words text-sm text-text-muted">{request.reason}</p>
            <form onSubmit={save}>
                <Input
                    data-prompt-entry
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    mono
                    aria-label={t('secret.field')}
                    placeholder={request.placeholder ?? t('secret.field')}
                    disabled={locked}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                />
            </form>
            <p className="text-xs text-text-muted">{t('secret.variable', words)}</p>
            {request.replaces && <p className="text-xs text-text-muted">{t('secret.replaces', words)}</p>}
            <p className="text-xs text-text-muted">{t('secret.approval')}</p>
        </PromptCard>
    );
}
