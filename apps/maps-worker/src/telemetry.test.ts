import { describe, expect, test } from 'bun:test';
import type { Env } from './env.ts';
import { telemetryOptions } from './telemetry.ts';

const ENV = { PUBLIC_ORIGIN: 'https://maps.test' } satisfies Env;

describe('the telemetry of the map service', () => {
    test('is off without a DSN', () => {
        expect(telemetryOptions(ENV)).toBeUndefined();
    });

    test('reports under the DSN and release of the deploy, without tracing, and logs only warnings and errors', () => {
        const options = telemetryOptions({ ...ENV, OBSERVATORY_DSN: 'https://key@ingest.test/9', OBSERVATORY_RELEASE: 'maps@0123456789ab' });

        expect(options).toMatchObject({ dsn: 'https://key@ingest.test/9', release: 'maps@0123456789ab', defaultIntegrations: false, maxBreadcrumbs: 0 });
        expect(options?.tracesSampleRate).toBeUndefined();
        expect(options?.integrations).toContainEqual(expect.objectContaining({ name: 'ConsoleLogs' }));
    });

    test('sends an error without the request, so no tile path or ticket leaves', () => {
        const options = telemetryOptions({ ...ENV, OBSERVATORY_DSN: 'https://key@ingest.test/9' })!;
        const event = options.beforeSend!(
            {
                type: undefined,
                message: 'unhandled',
                request: { url: 'https://maps.ruimte.app/v1/m/grant/14/8410/5385.pbf', headers: { authorization: 'Bearer ticket' } },
                user: { ip_address: '192.0.2.7' }
            },
            {}
        );

        expect(event).toEqual({ type: undefined, message: 'unhandled' });
    });
});
