/* Where each part of Ruimte sends its crash reports. A DSN only lets a client send, so it is no secret. */
export const TELEMETRY_DSN = {
    daemon: 'https://4a64a9ae7ddcb39c9f23e472b9b0fc54@o4512264930983936.ingest.de.sentry.io/4512264949334096',
    desktop: 'https://803b8dade75e2b308e2e97a5f639ee22@o4512264930983936.ingest.de.sentry.io/4512264955691088',
    station: 'https://7da04963248be92d21e14f25b1d0eaca@o4512264930983936.ingest.de.sentry.io/4512264959688784'
};

export type TelemetrySurface = keyof typeof TELEMETRY_DSN;

/* The release every part reports under, and the one CI creates for a tag `v<version>`. */
export function telemetryRelease(version: string): string {
    return `ruimte@${version}`;
}

/*
 * The SDK's own collection, all off: the scrubber's allow-list is what decides, and this keeps the
 * SDK from gathering what the scrubber would only drop again. Goes in `init` as `dataCollection`.
 */
export const TELEMETRY_DATA_COLLECTION = {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    frameContextLines: 0
};
