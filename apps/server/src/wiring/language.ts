import { join } from 'node:path';
import type { SqlAnalysis } from '../database/sql-analysis.ts';
import type { MachineHome } from '../fs/machine-home.ts';
import type { SharedWatch } from '../fs/shared-watch.ts';
import { LanguageHost } from '../language/host.ts';
import { NativePolicy, phpLanguageServerCheckout, sqlLanguageServerCheckout } from '../language/native.ts';
import { OnDeviceModel } from '../ondevice/model.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { provenanceChat } from '../provenance/chat-facts.ts';
import { ProvenanceService } from '../provenance/provenance-service.ts';
import type { AgentsBundle } from './agents.ts';

/* What the editor asks of the machine: the language servers, the on-device model and who wrote which lines. */
export interface LanguageBundle {
    host: LanguageHost;
    onDevice: OnDeviceModel;
    provenance: ProvenanceService;
}

interface LanguageInput {
    home: string;
    compiled: boolean;
    machineHome: MachineHome;
    watches: SharedWatch;
    projects: ProjectStore;
    sqlAnalysis: SqlAnalysis;
    agents: AgentsBundle;
}

export async function wireLanguage({ home, compiled, machineHome, watches, projects, sqlAnalysis, agents }: LanguageInput): Promise<LanguageBundle> {
    const host = new LanguageHost({
        root: join(home, 'language-servers'),
        watch: { seams: watches },
        folderOf: (projectId) => projects.index.folderOf(projectId),
        holders: (projectId) => projects.holdersOf(projectId),
        machineHome,
        // A compiled daemon ignores local sources and installs the pinned native releases.
        native: new NativePolicy({ checkouts: { 'php-native': phpLanguageServerCheckout(compiled), 'sql-native': sqlLanguageServerCheckout(compiled) } }),
        sqlSettings: (projectId) => sqlAnalysis.settingsOf(projectId),
        untrusted: (path) => agents.untrusted.inFolder(path)
    });
    await host.load();
    const onDevice = new OnDeviceModel();
    const provenance = new ProvenanceService({
        home,
        locate: (chatId) => projects.index.locate(chatId),
        folderOf: (projectId) => projects.index.folderOf(projectId),
        holders: (projectId) => projects.holdersOf(projectId),
        chat: (chatId) => provenanceChat(agents.chats, chatId)
    });
    agents.chats.observe((event) => provenance.consume(event));
    return { host, onDevice, provenance };
}
