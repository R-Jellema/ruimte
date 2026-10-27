/* What the handlers reach the outside through, so a test hands in a fake upstream and a cache of its own. */
export interface CacheLike {
    match(request: Request): Promise<Response | undefined>;
    put(request: Request, response: Response): Promise<void>;
}

export interface Deps {
    fetch(url: string, init: RequestInit): Promise<Response>;
    cache: CacheLike;
    now(): number;
    /* Work that may finish after the answer, such as filling the cache. */
    defer(work: Promise<unknown>): void;
    /* An error the handler answered with `internal`, for the crash reports. */
    report?(error: unknown): void;
}
