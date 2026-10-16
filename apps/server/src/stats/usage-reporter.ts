import {
    AddressBookClient,
    AddressBookRequestError,
    isoWeekOf,
    USAGE_COUNTERS,
    USAGE_MAX_COUNT,
    USAGE_MAX_STARTUP_MS,
    UsageBatchSchema,
    UsageDaySchema,
    type UsageBatch,
    type UsageDay
} from '@ruimte/pulsar';
import { errorText } from '../error-text.ts';
import type { UsageCounter, UsageDayRecord } from './usage-counter.ts';

// After a failure the address book is knocked on this often at most, however often a client lists providers.
const RETRY_MS = 10 * 60 * 1000;
const SEND_TIMEOUT_MS = 10_000;

type Platform = UsageDay['platform'];
type Arch = UsageDay['arch'];

function platformOf(platform: string): Platform {
    return platform === 'darwin' || platform === 'linux' || platform === 'win32' ? platform : 'other';
}

function archOf(arch: string): Arch {
    return arch === 'arm64' || arch === 'x64' ? arch : 'other';
}

function median(values: readonly number[]): number | null {
    if (values.length === 0) {
        return null;
    }
    const sorted = values.toSorted((one, other) => one - other);
    const middle = Math.floor(sorted.length / 2);
    return Math.round(sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2);
}

/* The day as the address book takes it, or null when it never would. */
export function usageDayOf(record: UsageDayRecord, cohortWeek: string, platform: string = process.platform, arch: string = process.arch): UsageDay | null {
    const counts = Object.fromEntries(
        USAGE_COUNTERS.flatMap((counter) => {
            const value = record.counts[counter] ?? 0;
            return value > 0 ? [[counter, Math.min(value, USAGE_MAX_COUNT)]] : [];
        })
    );
    const startup = median(record.startups);
    const parsed = UsageDaySchema.safeParse({
        date: record.date,
        version: record.version,
        platform: platformOf(platform),
        arch: archOf(arch),
        launcher: record.launcher,
        signedIn: record.signedIn,
        firstThisWeek: record.firstThisWeek,
        firstThisMonth: record.firstThisMonth,
        cohortWeek,
        ...(startup === null ? {} : { startupMs: Math.min(Math.max(startup, 1), USAGE_MAX_STARTUP_MS) }),
        counts
    });
    return parsed.success ? parsed.data : null;
}

export function sendToAddressBook(batch: UsageBatch): Promise<void> {
    return new AddressBookClient({ fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) }) }).sendUsage(batch);
}

interface UsageReporterOptions {
    counter: UsageCounter;
    // The machine's switch; off sends nothing.
    enabled(): boolean;
    signedIn(): Promise<boolean>;
    send?: (batch: UsageBatch) => Promise<void>;
    now?: () => number;
}

/*
 * Sends the finished days the counter keeps, when the daemon starts and whenever a client lists the
 * providers, which is when the model catalogs are fetched too: no clock of its own. A day goes once:
 * an answer of 400 drops it as well, since it would never be taken; any other failure keeps it for
 * the next try, until it is too old to send.
 */
export class UsageReporter {
    private readonly options: UsageReporterOptions;
    private readonly send: (batch: UsageBatch) => Promise<void>;
    private readonly now: () => number;
    private failedAt: number | null = null;
    private inFlight: Promise<void> | null = null;

    constructor(options: UsageReporterOptions) {
        this.options = options;
        this.send = options.send ?? sendToAddressBook;
        this.now = options.now ?? Date.now;
    }

    /* One send at a time; a second caller waits for the first one's answer. */
    flush(): Promise<void> {
        this.inFlight ??= this.run().finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    private async run(): Promise<void> {
        if (!this.options.enabled()) {
            return;
        }
        const { counter } = this.options;
        counter.noteSignedIn(await this.options.signedIn().catch(() => false));
        const now = this.now();
        // A time in the future means the clock went back; that failure counts as old.
        if (this.failedAt !== null && now >= this.failedAt && now - this.failedAt < RETRY_MS) {
            return;
        }
        const records = counter.finished();
        const firstDate = counter.firstDate;
        if (records.length === 0 || firstDate === null) {
            return;
        }
        const cohortWeek = isoWeekOf(firstDate);
        const days = records.flatMap((record) => {
            const day = usageDayOf(record, cohortWeek);
            return day === null ? [] : [day];
        });
        const unsendable = records.filter((record) => !days.some((day) => day.date === record.date)).map((record) => record.date);
        if (unsendable.length > 0) {
            counter.forget(unsendable);
        }
        const batch = UsageBatchSchema.safeParse({ days });
        if (!batch.success) {
            await counter.persist();
            return;
        }
        const dates = days.map((day) => day.date);
        try {
            await this.send(batch.data);
            this.failedAt = null;
            counter.forget(dates);
        } catch (e) {
            if (e instanceof AddressBookRequestError && e.status === 400) {
                console.warn('The address book refused the usage counts; they are dropped:', errorText(e));
                counter.forget(dates);
            } else {
                this.failedAt = now;
                console.warn('Could not send the usage counts; they wait for the next try:', errorText(e));
            }
        }
        await counter.persist();
    }
}
