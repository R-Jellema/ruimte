import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { createDailyDedupe, createScrubber, TELEMETRY_DATA_COLLECTION, TELEMETRY_DSN, telemetryRelease, type DedupeStore } from '@ruimte/telemetry';
import { COMPILED, VERSION } from '../version.ts';

type Sentry = typeof import('@sentry/bun');

/* How the daemon came to run, which says whose log a report belongs beside. */
export type Launcher = 'service' | 'desktop' | 'standalone';

export interface TelemetrySettings {
    readonly dsn: string;
    readonly release: string;
    readonly tags: Readonly<Record<string, string>>;
    readonly home: string;
    readonly username: string;
    readonly hostname: string;
    /* `$RUIMTE_HOME`, where the dedupe remembers what went out. */
    readonly ruimteHome: string;
}

interface ProjectSource {
    known(): Promise<ReadonlyArray<{ name: string; folder: string }>>;
}

const FLUSH_MS = 2000;
const STDERR_LINES = 5;

let sentry: Sentry | null = null;
let settings: TelemetrySettings | null = null;
let projects: ProjectSource | null = null;
let projectRedactions: readonly string[] = [];
const secrets = new Set<string>();

/*
 * Reports go out only from a release build: `scripts/compile.ts` stamps `RUIMTE_TELEMETRY` into the
 * binary, so a checkout, `bun dev`, a test and a local compile stay silent whatever their environment says.
 */
export function telemetryBuild(): boolean {
    return COMPILED && process.env.RUIMTE_TELEMETRY === '1';
}

/* What a report of this daemon carries besides the error itself; null when this build reports nothing. */
export function telemetrySettings(launcher: Launcher, ruimteHome: string): TelemetrySettings | null {
    if (!telemetryBuild()) {
        return null;
    }
    return {
        dsn: TELEMETRY_DSN.daemon,
        release: telemetryRelease(VERSION),
        tags: { launcher, platform: process.platform, arch: process.arch },
        home: homedir(),
        username: userInfo().username,
        hostname: hostname(),
        ruimteHome
    };
}

/* Machine state: no client's file request reaches it (`fs/machine-home.ts`). */
export function dedupeStorePath(ruimteHome: string): string {
    return join(ruimteHome, 'telemetry', 'sent.json');
}

export function fileDedupeStore(path: string): DedupeStore {
    return {
        read: () => {
            const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
            return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {};
        },
        write: (entries) => {
            mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
            writeFileSync(path, JSON.stringify(entries), { mode: 0o600 });
        }
    };
}

/*
 * What every report of the daemon goes through, the hang watchdog's included: the scrubber, then
 * the dedupe, which lets one error out once a day.
 */
export function daemonBeforeSend(current: TelemetrySettings, redactions: () => Iterable<string> = () => []): <T extends object>(event: T) => T | null {
    const scrubber = createScrubber({
        home: current.home,
        username: current.username,
        hostname: current.hostname,
        redactions,
        tags: ['launcher', 'platform', 'arch', 'helper', 'language_server', 'hang']
    });
    const dedupe = createDailyDedupe({ store: fileDedupeStore(dedupeStorePath(current.ruimteHome)) });
    return (event) => {
        const scrubbed = scrubber.scrubEvent(markInApp(event));
        return scrubbed !== null && dedupe.admit(scrubbed) ? scrubbed : null;
    };
}

/*
 * Bun maps the frames of the compiled daemon back to the source itself, to paths relative to the
 * build, which the SDK does not count as the app's own.
 */
export function markInApp<T extends object>(event: T): T {
    const exception = (event as { exception?: { values?: Array<{ stacktrace?: { frames?: Array<{ filename?: string; in_app?: boolean }> } }> } }).exception;
    for (const value of exception?.values ?? []) {
        for (const frame of value.stacktrace?.frames ?? []) {
            if (frame.filename !== undefined) {
                frame.in_app = !frame.filename.includes('node_modules') && !frame.filename.startsWith('native:');
            }
        }
    }
    return event;
}

/* Starts reporting for the serving daemon. Errors only: no tracing, no sessions, no breadcrumbs, no logs. */
export async function startTelemetry(current: TelemetrySettings): Promise<void> {
    const loaded = await import('@sentry/bun');
    settings = current;
    const beforeSend = daemonBeforeSend(current, () => [...secrets, ...projectRedactions]);
    loaded.initWithoutDefaultIntegrations({
        dsn: current.dsn,
        release: current.release,
        environment: 'production',
        dataCollection: TELEMETRY_DATA_COLLECTION,
        attachStacktrace: false,
        maxBreadcrumbs: 0,
        integrations: [
            loaded.functionToStringIntegration(),
            loaded.linkedErrorsIntegration(),
            loaded.dedupeIntegration(),
            loaded.nodeContextIntegration({ app: false, cloudResource: false, culture: false, device: { cpu: false, memory: false } })
        ],
        initialScope: { tags: { ...current.tags } },
        beforeSend: (event) => beforeSend(event),
        beforeBreadcrumb: () => null
    });
    sentry = loaded;
}

/* What the watchdog worker needs to report on its own while this thread is stuck. */
export function activeTelemetrySettings(): TelemetrySettings | null {
    return settings;
}

/* A value no report may carry, such as the local secret. */
export function rememberSecret(secret: string): void {
    secrets.add(secret);
}

/* The registry the names and folders of projects are read from before a report goes out. */
export function watchProjects(source: ProjectSource): void {
    projects = source;
}

async function refreshRedactions(): Promise<void> {
    if (projects === null) {
        return;
    }
    try {
        const known = await projects.known();
        projectRedactions = known.flatMap((project) => [project.name, project.folder]);
    } catch {
        // A registry that cannot be read leaves the names of the last read, and the generic rules still apply.
    }
}

/* An error nothing caught, on the way to ending the process; resolves once it is sent or the wait is over. */
export async function reportFatal(error: unknown): Promise<void> {
    const active = sentry;
    if (active === null) {
        return;
    }
    try {
        await refreshRedactions();
        active.withScope((scope) => {
            scope.setLevel('fatal');
            active.captureException(error, { mechanism: { type: 'auto.node.onuncaughtexception', handled: false } });
        });
        await active.flush(FLUSH_MS);
    } catch {
        // Reporting a crash never stands in the way of the exit.
    }
}

export interface HelperExit {
    /* Which helper: `database`, `apple-foundation`, `on-device` or `language-server`. */
    readonly helper: string;
    /* The kind of language server; only for a kind Ruimte ships. */
    readonly kind?: string;
    readonly code: number | null;
    readonly signal?: string | null;
    readonly stderr?: readonly string[];
}

/* A helper process that ended while the daemon still needed it. */
export function reportHelperExit(exit: HelperExit): void {
    const active = sentry;
    if (active === null) {
        return;
    }
    void refreshRedactions().then(() => {
        active.captureEvent({
            message: `The ${exit.helper} helper exited unexpectedly`,
            level: 'error',
            fingerprint: ['helper-exit', exit.helper, exit.kind ?? ''],
            tags: { helper: exit.helper, ...(exit.kind === undefined ? {} : { language_server: exit.kind }) },
            extra: {
                exit_code: exit.code ?? -1,
                ...(exit.signal ? { signal: exit.signal } : {}),
                stderr: (exit.stderr ?? []).slice(-STDERR_LINES)
            }
        });
    });
}

/* Sends what is still queued before a clean exit. */
export async function stopTelemetry(): Promise<void> {
    await sentry?.close(FLUSH_MS);
}

/* The last lines of a process's stderr, kept for a report of its exit. */
export class StderrTail {
    private readonly lines: string[] = [];
    private readonly size: number;

    constructor(size = STDERR_LINES) {
        this.size = size;
    }

    push(text: string): void {
        for (const line of text.split(/\r?\n/)) {
            if (line.trim() === '') {
                continue;
            }
            this.lines.push(line);
            if (this.lines.length > this.size) {
                this.lines.shift();
            }
        }
    }

    get(): string[] {
        return [...this.lines];
    }
}
