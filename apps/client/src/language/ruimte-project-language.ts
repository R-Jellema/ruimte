import { createSnippetTransformWorker } from './snippet-transform-worker';
import i18next from 'i18next';
import {
    lspLanguageIdOf,
    ProjectLanguage as SharedProjectLanguage,
    shikiLanguageOf,
    shikiLanguageOfPath,
    type LanguageDocumentHandle,
    type ProjectFiles,
    type RenameSuggestionsRequest
} from '@adecore/editor-react';
import type { Editor } from '@adecore/editor';
import { fileUriToPath, pathToFileUri, type Diagnostic } from '@adecore/lsp';
import { onDeviceClientFor } from '@/ondevice/ondevice-client';
import { parseNames } from '@/ondevice/names-model';
import { namesPrompt } from '@/ondevice/prompts';
import { openFileLink } from '@/shell/panels/file-links';
import { RUIMTE_EDITOR_KEYMAP } from '@/shell/editor-keymap';
import { isApplePlatform } from '@/desktop/bridge';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import type { Transport } from '@/transport/transport';
import { LanguageStatusTracker } from './status';
import { WireLanguageService, type WireLanguageServiceOptions } from './wire-service';
import { readPanelHeight, writePanelHeight } from './panel-height';
import type { DraftProjectFiles } from './project-files';
import { isPathBelow } from '@/shell/panels/files-tree';

export class ProjectLanguage extends SharedProjectLanguage {
    declare readonly service: WireLanguageService;
    readonly transport: Transport;
    readonly status: LanguageStatusTracker;
    // The wire resynchronizes from the sending editor without starting a second document owner.
    private readonly openEditors: Map<string, Editor[]>;
    private readonly stopDrafts: () => void;

    constructor(
        transport: Transport,
        projectId: string,
        folder: string,
        files: ProjectFiles | DraftProjectFiles | null = null,
        openFile: (folder: string, path: string, line: number) => void = (root, path, line) => void openFileLink(root, { path, line, directory: false })
    ) {
        const openEditors = new Map<string, Editor[]>();
        let applyEdit: WireLanguageServiceOptions['applyEdit'];
        const service = new WireLanguageService({
            transport,
            projectId,
            folder,
            textOf: (uri) => openEditors.get(uri)?.[0]?.getText(),
            applyEdit: (params) => applyEdit?.(params) ?? Promise.resolve({ applied: false, failureReason: 'The project language is not ready' })
        });
        const panelBodyHeight = readPanelHeight();
        super(service, {
            i18n: i18next,
            folder,
            ...(files === null ? {} : { files }),
            apple: isApplePlatform(),
            keymap: RUIMTE_EDITOR_KEYMAP,
            snippetTransformWorker: createSnippetTransformWorker,
            ...(panelBodyHeight === undefined ? {} : { panelBodyHeight }),
            onPanelResize: writePanelHeight,
            // Machine reports include documents held by other clients, which the shared editor does not own.
            problemSource: (listener) =>
                transport.on('language.diagnostics', (event) => {
                    if (event.projectId === projectId) {
                        listener({ path: event.path, server: event.server, diagnostics: event.diagnostics as Diagnostic[] });
                    }
                }),
            openPlace: (place) => {
                const path = fileUriToPath(place.uri);
                if (path !== null) {
                    openFile(folder, path, place.position.line + 1);
                }
            },
            pathOfUri: (uri) => service.pathOfLocation(uri),
            serverNames: (uri) => service.serversOf(uri),
            notify: (notification) => useToasts.getState().show(notification),
            suggestNames: (request, signal) => suggestNames(transport, request, signal)
        });
        this.openEditors = openEditors;
        applyEdit = (params) => this.applyWorkspaceEdit(params.edit);
        this.transport = transport;
        this.status = new LanguageStatusTracker(transport, projectId);
        void this.status.refresh().catch(() => undefined);
        this.stopDrafts = files !== null && 'watchUnsaved' in files ? holdUnsavedTexts(service, folder, files) : () => undefined;
    }

    override acquire(uri: string, languageId: string, editor: Editor): LanguageDocumentHandle {
        const editors = this.openEditors.get(uri) ?? [];
        editors.push(editor);
        this.openEditors.set(uri, editors);
        let held: LanguageDocumentHandle;
        try {
            held = super.acquire(uri, languageId, editor);
        } catch (error) {
            editors.splice(editors.indexOf(editor), 1);
            if (editors.length === 0) {
                this.openEditors.delete(uri);
            }
            throw error;
        }
        let released = false;
        return {
            uri,
            service: this.service,
            get ready() {
                return held.ready;
            },
            release: () => {
                if (released) {
                    return;
                }
                released = true;
                editors.splice(editors.indexOf(editor), 1);
                if (editors.length === 0) {
                    this.openEditors.delete(uri);
                }
                held.release();
            }
        };
    }

    override dispose(): void {
        this.stopDrafts();
        super.dispose();
        this.openEditors.clear();
        this.service.dispose();
        this.status.dispose();
    }
}

/* The servers read the unsaved text of every file of the project that a server serves, whether an editor shows it or not. */
function holdUnsavedTexts(service: WireLanguageService, folder: string, files: DraftProjectFiles): () => void {
    let held = new Set<string>();
    return files.watchUnsaved((texts) => {
        const holding = new Set<string>();
        for (const [path, text] of texts) {
            const languageId = isPathBelow(folder, path) ? lspLanguageIdOf(shikiLanguageOfPath(path)) : null;
            if (languageId !== null) {
                const uri = pathToFileUri(path);
                holding.add(uri);
                service.holdText(uri, languageId, text);
            }
        }
        for (const uri of held) {
            if (!holding.has(uri)) {
                service.releaseText(uri);
            }
        }
        held = holding;
    });
}

async function suggestNames(transport: Transport, request: RenameSuggestionsRequest, signal: AbortSignal): Promise<readonly string[]> {
    if (!useSettings.getState().aiOnDeviceHelp || signal.aborted) {
        return [];
    }
    const client = onDeviceClientFor(transport);
    if (!(await client.availability()).available || signal.aborted) {
        return [];
    }
    const result = await client.generate(
        {
            purpose: 'names',
            prompt: namesPrompt({ ...request, language: shikiLanguageOf(request.languageId), uses: [...request.uses] })
        },
        signal
    );
    return result.state === 'done' ? parseNames(result.text, request.name, request.languageId, 3) : [];
}

interface Entry {
    language: ProjectLanguage;
    references: number;
}

const entries = new WeakMap<Transport, Map<string, Entry>>();

export function acquireProjectLanguage(
    transport: Transport,
    projectId: string,
    folder: string,
    files: ProjectFiles | null = null
): { language: ProjectLanguage; release(): void } {
    let projects = entries.get(transport);
    if (projects === undefined) {
        projects = new Map();
        entries.set(transport, projects);
    }
    const key = `${projectId}\0${folder}`;
    let entry = projects.get(key);
    if (entry === undefined) {
        entry = { language: new ProjectLanguage(transport, projectId, folder, files), references: 0 };
        projects.set(key, entry);
    }
    entry.references++;
    const held = entry;
    let released = false;
    return {
        language: held.language,
        release: () => {
            if (!released) {
                released = true;
                if (--held.references === 0) {
                    projects.delete(key);
                    held.language.dispose();
                }
            }
        }
    };
}
