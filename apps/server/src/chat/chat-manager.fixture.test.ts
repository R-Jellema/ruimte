import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatItem, ContextSource } from '@ruimte/contracts';
import { ProviderRegistry } from '../providers/registry.ts';
import { AttachmentStore } from '@adecore/agents/chat/attachment-store';
import { ChatManager } from './chat-manager.ts';
import { ChatRecorder, RecordingStore } from './chat-test-helpers.ts';
import { fakeClaude } from '@adecore/agents/chat/fake-claude';
import { inProcess } from '@adecore/agents/chat/fake-cli';

const FIXTURE = join(dirname(fileURLToPath(import.meta.resolve('@adecore/agents/chat/subagent-reader'))), 'fixtures', 'claude-projects');
const LINKED: ContextSource[] = [{ id: 'dev-1', kind: 'device', title: 'iPhone 18 Pro Max' }];
// A chat's title timer and its CLI outlive a shutdown; only a dispose ends them.
export async function retire(target: ChatManager): Promise<void> {
    await target.shutdown();
    for (const info of target.list()) {
        target.get(info.chatId)?.dispose();
    }
}
export async function makeChatFixture() {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-chat-'));
    const attachments = new AttachmentStore(home);
    const store = new RecordingStore(home, { attachments });
    const claude = inProcess(fakeClaude);
    const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });
    function makeManager(extra: Partial<ConstructorParameters<typeof ChatManager>[0]> = {}) {
        return new ChatManager({
            providers,
            store,
            attachments,
            spawn: claude.spawn,
            env: { PATH: process.env.PATH, HOME: home, RUIMTE_HOOK_URL: 'x' },
            ...extra
        });
    }
    const manager = makeManager();
    const recorder = new ChatRecorder();
    manager.subscribe('c1', recorder.sink());
    function subagentWork(): Array<Extract<ChatItem, { kind: 'tool' | 'assistant' }>> {
        return [...recorder.items.values()].filter(
            (item): item is Extract<ChatItem, { kind: 'tool' | 'assistant' }> =>
                (item.kind === 'tool' || item.kind === 'assistant') && Boolean(item.parentToolUseId)
        );
    }
    return { home, attachments, store, claude, manager, recorder, makeManager, subagentWork };
}
export { FIXTURE, LINKED };
