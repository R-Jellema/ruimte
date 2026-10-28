import type { LanguageLogLine } from '@ruimte/contracts';

const MAX_LINES = 500;
const MAX_LINE_LENGTH = 2000;

/* The last lines a kind wrote, for the status UI to show when something went wrong. Bounded, so a chatty server costs memory only up to a cap. */
export class LanguageLog {
    private readonly lines: LanguageLogLine[] = [];
    private readonly now: () => number;

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    push(stream: LanguageLogLine['stream'], text: string, detail: { source?: string; level?: string } = {}): void {
        const at = this.now();
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trimEnd();
            if (line === '') {
                continue;
            }
            this.lines.push({
                at,
                stream,
                text: line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line,
                ...(detail.source === undefined ? {} : { source: detail.source }),
                ...(detail.level === undefined ? {} : { level: detail.level })
            });
        }
        if (this.lines.length > MAX_LINES) {
            this.lines.splice(0, this.lines.length - MAX_LINES);
        }
    }

    tail(count = MAX_LINES): LanguageLogLine[] {
        return this.lines.slice(-count);
    }

    /* The last line of a stream, which is where a process says why it ended. A trace line is no reason. */
    last(stream: LanguageLogLine['stream']): string | null {
        return this.lines.findLast((line) => line.stream === stream && line.source !== 'trace')?.text ?? null;
    }

    /* What the server's own streams said, for a crash report: trace carries source text and a message carries what a person is shown, and neither leaves the machine. */
    serverOutput(): string[] {
        return this.lines.filter((line) => line.stream === 'server' && line.source !== 'trace' && line.source !== 'message').map((line) => line.text);
    }
}
