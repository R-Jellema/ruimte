import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ComposerSendAction } from '@adecore/agents-react';
import { openRoutineForm } from '@/routines/form-state';
import { useProject } from '@/state/project';
import { useMachineAnswers } from '@/transport/features';

const NONE: readonly ComposerSendAction[] = [];

/* "Repeat…" beside a chat's send button: the routine form with what is being written, in the window's project. */
export function useRepeatSendActions(): readonly ComposerSendAction[] {
    const { t } = useTranslation('routines');
    const endpointId = useProject((s) => s.currentEndpointId) ?? '';
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const answers = useMachineAnswers(endpointId, 'routine.list');
    if (!answers || projectId === null) {
        return NONE;
    }
    return [
        {
            id: 'repeat',
            label: t('composer.repeat'),
            icon: CalendarClock,
            run: (draft) =>
                openRoutineForm({
                    projectId,
                    ...(draft.text === '' ? {} : { prompt: draft.text }),
                    agent: { provider: draft.provider, selection: draft.selection }
                })
        }
    ];
}
