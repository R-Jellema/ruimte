import { CodedError } from '@adecore/agents';

export type ArchiveErrorCode =
    | 'not-an-archive'
    | 'corrupt'
    | 'entry-not-found'
    | 'not-readable'
    | 'entry-too-large'
    | 'too-large'
    | 'too-compressed'
    | 'too-many-entries'
    | 'exists'
    | 'not-a-directory'
    | 'bad-path'
    | 'outside-project'
    | 'git-state'
    | 'ruimte-state';

export class ArchiveError extends CodedError<ArchiveErrorCode> {}

// What one extract writes at most, counted as it inflates; a header can claim any size it likes.
export const ARCHIVE_EXTRACT_MAX_BYTES = 4 * 1024 * 1024 * 1024;

// What one extract or one scan of an archive walks through at most, a ceiling well past any listing anyone reads.
export const ARCHIVE_SCAN_MAX_ENTRIES = 200_000;

// What listing a compressed tar unpacks at most to read its headers; past it the listing ends as truncated.
export const ARCHIVE_SCAN_MAX_BYTES = 4 * 1024 * 1024 * 1024;

// Deflate tops out near 1032 to 1, and text and logs rarely pass 50; past this the bytes are a bomb, not a file.
export const ARCHIVE_MAX_RATIO = 200;

// Below this any ratio is fine: a small file of zeros is no threat, and the ratio of a few bytes says nothing.
export const ARCHIVE_RATIO_FLOOR_BYTES = 8 * 1024 * 1024;

/*
 * Counts what goes into an inflater and what comes out, and stops the inflating the moment the output
 * passes its ceiling or grows too far past its input. It runs on the bytes as they arrive, never on the
 * sizes a header claims.
 */
export class InflateMeter {
    private consumed = 0;
    private produced = 0;

    private readonly maxBytes: number;
    private readonly tooLarge: () => Error;

    constructor(maxBytes: number, tooLarge: () => Error) {
        this.maxBytes = maxBytes;
        this.tooLarge = tooLarge;
    }

    take(bytes: number): void {
        this.consumed += bytes;
    }

    give(bytes: number): void {
        this.produced += bytes;
        if (this.produced > this.maxBytes) {
            throw this.tooLarge();
        }
        if (this.produced > ARCHIVE_RATIO_FLOOR_BYTES && this.produced > this.consumed * ARCHIVE_MAX_RATIO) {
            throw new ArchiveError('too-compressed', 'This archive unpacks to far more than it holds, which is how a zip bomb looks. It is not opened.');
        }
    }
}
