import { projectSidebarViews, type AgentStatus, type ProjectChangedEvent, type ProjectSidebarResult, type ProjectSummary } from '@ruimte/contracts';
import { TransportError, type Transport } from '@/transport/transport';

export interface SidebarMachineSnapshot {
    projects: ProjectSidebarResult['projects'];
    statuses: Record<string, AgentStatus>;
    state: 'loading' | 'ready' | 'offline' | 'error' | 'unsupported';
}

/* What one request brings: the projects, or the standing status of every terminal or every chat. */
type Part = 'projects' | 'sessions' | 'chats';

const ALL_PARTS: readonly Part[] = ['projects', 'sessions', 'chats'];

export interface SidebarWatchOptions {
    pollMs?: number;
    /* Whether this page polls now. Every window draws a sidebar, and only the one with the focus has to. */
    polls?: () => boolean;
}

function focusedPage(): boolean {
    return typeof document === 'undefined' || document.hasFocus();
}

function statusKeyOf(part: Part): string | null {
    return part === 'sessions' ? 'terminal:' : part === 'chats' ? 'chat:' : null;
}

export class SidebarWatch {
    private snapshot: SidebarMachineSnapshot = { projects: [], statuses: {}, state: 'loading' };
    private readonly listeners = new Set<() => void>();
    private readonly off: (() => void)[];
    private readonly interval: ReturnType<typeof setInterval>;
    private readonly queued = new Set<Part>();
    private disposed = false;
    private loading = false;
    private generation = 0;
    // The statuses an event set while a list was out, which are newer than that list.
    private touched = new Set<string>();

    private readonly transport: Transport;

    constructor(transport: Transport, { pollMs = 15_000, polls = focusedPage }: SidebarWatchOptions = {}) {
        this.transport = transport;
        this.off = [
            transport.subscribeStatus((status) => {
                this.generation++;
                this.queued.clear();
                if (status === 'open') {
                    this.set({ ...this.snapshot, state: 'loading' });
                    this.refresh();
                } else {
                    this.set({ ...this.snapshot, state: 'offline' });
                }
            }),
            transport.on('project.changed', (event) => this.changed(event)),
            transport.on('project.summary', ({ summary }) => this.summary(summary)),
            transport.on('session.list-changed', () => this.queue(['sessions'])),
            transport.on('session.status', ({ sessionId, agent }) => this.status(`terminal:${sessionId}`, agent?.status ?? 'running')),
            transport.on('session.exit', ({ sessionId }) => this.status(`terminal:${sessionId}`, 'exited')),
            transport.on('chat.status', ({ chatId, info }) => this.status(`chat:${chatId}`, info.status))
        ];
        // A project no client has open has no watcher on the machine, so an edit from outside reaches no event.
        this.interval = setInterval(() => {
            if (polls()) {
                this.queue(['projects']);
            }
        }, pollMs);
        this.refresh();
    }

    getSnapshot = (): SidebarMachineSnapshot => this.snapshot;
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    dispose(): void {
        this.disposed = true;
        this.off.forEach((off) => off());
        clearInterval(this.interval);
        this.listeners.clear();
    }

    /* Everything again, as on a fresh link. */
    refresh = (): void => {
        this.queue(ALL_PARTS);
    };

    private status(key: string, status: AgentStatus): void {
        this.touched.add(key);
        this.set({ ...this.snapshot, statuses: { ...this.snapshot.statuses, [key]: status } });
    }

    /* The document comes along, so a project this sidebar lists takes its rows from it without asking. */
    private changed({ projectId, document }: ProjectChangedEvent): void {
        const known = this.snapshot.projects.some((project) => project.summary.projectId === projectId);
        if (!known || this.snapshot.state !== 'ready') {
            this.queue(['projects']);
            return;
        }
        const views = projectSidebarViews(document.views, document.shared ?? [], document.flags);
        this.set({
            ...this.snapshot,
            projects: this.snapshot.projects.map((project) => (project.summary.projectId === projectId ? { ...project, views } : project))
        });
    }

    private summary(summary: ProjectSummary): void {
        const known = this.snapshot.projects.some((project) => project.summary.projectId === summary.projectId);
        // A closed project leaves the list and a new one joins it, which only the machine's list says in full.
        if (!known || summary.closedAt != null || this.snapshot.state !== 'ready') {
            this.queue(['projects']);
            return;
        }
        this.set({
            ...this.snapshot,
            projects: this.snapshot.projects.map((project) => (project.summary.projectId === summary.projectId ? { ...project, summary } : project))
        });
    }

    private set(snapshot: SidebarMachineSnapshot): void {
        if (this.disposed || JSON.stringify(snapshot) === JSON.stringify(this.snapshot)) {
            return;
        }
        this.snapshot = snapshot;
        this.listeners.forEach((listener) => listener());
    }

    /*
     * Asked at once, in the turn of the event, so a list another client of the machine asks for in that
     * turn is one request (`ActiveTransport`). While a round is out the next one gathers and waits.
     */
    private queue(parts: readonly Part[]): void {
        if (this.disposed || this.snapshot.state === 'unsupported') {
            return;
        }
        if (this.transport.status !== 'open') {
            this.set({ ...this.snapshot, state: 'offline' });
            return;
        }
        // After a failed round the parts it lacked are not known to be current, so the next asks for all of them.
        for (const part of this.snapshot.state === 'error' ? ALL_PARTS : parts) {
            this.queued.add(part);
        }
        this.load();
    }

    private load(): void {
        if (this.disposed || this.loading || this.queued.size === 0 || this.transport.status !== 'open') {
            return;
        }
        const parts = [...this.queued];
        this.queued.clear();
        this.loading = true;
        this.touched = new Set();
        const generation = this.generation;
        const wants = (part: Part): boolean => parts.includes(part);
        void Promise.all([
            wants('projects') ? this.transport.request('project.sidebar', {}) : null,
            wants('sessions') ? this.transport.request('session.list', {}) : null,
            wants('chats') ? this.transport.request('chat.list', {}) : null
        ])
            .then(([overview, sessions, chats]) => {
                if (this.disposed || generation !== this.generation) {
                    return;
                }
                const fetched: Record<string, AgentStatus> = {};
                for (const session of sessions?.sessions ?? []) {
                    fetched[`terminal:${session.sessionId}`] =
                        session.agent?.live || session.agent?.status === 'exited' ? session.agent.status : session.exited ? 'error' : 'running';
                }
                for (const chat of chats?.chats ?? []) {
                    fetched[`chat:${chat.chatId}`] = chat.status;
                }
                const replaced = parts.map(statusKeyOf).filter((prefix): prefix is string => prefix !== null);
                // A list replaces every status of its kind, except one an event set while the list was out.
                const kept = Object.entries(this.snapshot.statuses).filter(
                    ([key]) => this.touched.has(key) || !replaced.some((prefix) => key.startsWith(prefix))
                );
                this.set({
                    projects: overview?.projects ?? this.snapshot.projects,
                    statuses: { ...fetched, ...Object.fromEntries(kept) },
                    state: 'ready'
                });
            })
            .catch((error: unknown) => {
                if (generation !== this.generation) {
                    return;
                }
                const unsupported =
                    error instanceof TransportError && ['unknown-request', 'unknown-type', 'bad-request', 'not-implemented'].includes(error.code);
                this.set({ ...this.snapshot, state: unsupported ? 'unsupported' : this.transport.status === 'open' ? 'error' : 'offline' });
            })
            .finally(() => {
                this.loading = false;
                this.load();
            });
    }
}
