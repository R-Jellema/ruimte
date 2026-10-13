import type { ComputerUse } from '../computer/computer-use.ts';
import type { Dispatcher } from '../dispatcher.ts';

/*
 * None of these is owner-only: the settings offer the switch for every machine a person reaches, and an
 * agent still gets nothing until that person grants Accessibility at the Mac and lets it into an app.
 */
export function registerComputerHandlers(dispatcher: Dispatcher, computer: ComputerUse): void {
    dispatcher.register('computer.status', () => computer.refreshStatus());

    dispatcher.register('computer.setEnabled', (payload) => computer.setEnabled(payload.enabled, payload.language));

    dispatcher.register('computer.restart', () => computer.restart());

    dispatcher.register('computer.requestGrant', (payload) => computer.requestGrant(payload.grant));

    dispatcher.register('computer.control', (payload) => computer.control(payload.action));

    dispatcher.register('computer.setLanguage', async (payload) => {
        await computer.setLanguage(payload.language);
        return {};
    });

    dispatcher.register('computer.approvals', () => ({ approvals: computer.pendingApprovals() }));

    dispatcher.register('computer.answer', async (payload) => ({ accepted: await computer.answer(payload.requestId, payload.choice) }));

    dispatcher.register('computer.grants', () => computer.grants());

    dispatcher.register('computer.revoke', async (payload) => ({ removed: await computer.revoke(payload.bundleId, payload.kind, payload.nodeId) }));
}
