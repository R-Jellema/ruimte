import { machineOfNodeId } from '@/state/node-endpoint';
import { useUi } from '@/state/ui';

/* Every door to the fork dialog goes through here, so the dialog reads the chat on the machine it runs on. */
export function openForkDialog(chatId: string, turnId: string): void {
    const machine = machineOfNodeId(chatId);
    useUi.getState().setForkDialog({ chatId, turnId, ...(machine === undefined ? {} : { machine }) });
}
