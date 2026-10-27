import { describe, expect, test } from 'bun:test';
import { MetricWindow, startQuarterMeter, type MetricSink } from './metric-window.ts';

function recordingSink(): { sink: MetricSink; sent: unknown[] } {
    const sent: unknown[] = [];

    return {
        sent,
        sink: {
            count: (name, value, options) => sent.push({ kind: 'count', name, value, ...options }),
            gauge: (name, value, options) => sent.push({ kind: 'gauge', name, value, ...options }),
            distribution: (name, value, options) => sent.push({ kind: 'distribution', name, value, ...options })
        }
    };
}

describe('MetricWindow', () => {
    test('sums a counter, keeps a gauge last and a distribution as its median and maximum, per name and attributes', () => {
        const window = new MetricWindow();

        for (const reason of ['dropped', 'dropped', 'failed']) {
            window.record({ kind: 'count', name: 'link.reconnect', value: 1, attributes: { reason } });
        }

        window.record({ kind: 'gauge', name: 'daemon.memory', value: 120, unit: 'megabyte' });
        window.record({ kind: 'gauge', name: 'daemon.memory', value: 140, unit: 'megabyte' });

        for (const value of [10, 30, 20, 400]) {
            window.record({ kind: 'distribution', name: 'request.duration', value, unit: 'millisecond', attributes: { area: 'fs' } });
        }

        expect(window.drain()).toEqual([
            { kind: 'count', name: 'link.reconnect', value: 2, attributes: { reason: 'dropped' } },
            { kind: 'count', name: 'link.reconnect', value: 1, attributes: { reason: 'failed' } },
            { kind: 'gauge', name: 'daemon.memory', value: 140, unit: 'megabyte', attributes: {} },
            { kind: 'distribution', name: 'request.duration', value: 25, unit: 'millisecond', attributes: { area: 'fs' } },
            { kind: 'distribution', name: 'request.duration', value: 400, unit: 'millisecond', attributes: { area: 'fs' } }
        ]);
        expect(window.drain()).toEqual([]);
    });

    test('a distribution measured once is sent once', () => {
        const window = new MetricWindow();

        window.record({ kind: 'distribution', name: 'workspace.load', value: 180, unit: 'millisecond' });

        expect(window.drain()).toEqual([{ kind: 'distribution', name: 'workspace.load', value: 180, unit: 'millisecond', attributes: {} }]);
    });
});

describe('startQuarterMeter', () => {
    test('sends nothing until its time comes, and what is left when it stops', () => {
        const { sink, sent } = recordingSink();
        let tick = (): void => undefined;
        const meter = startQuarterMeter(sink, {
            schedule: (run) => {
                tick = run;

                return () => undefined;
            }
        });

        meter.record({ kind: 'count', name: 'pulsar.relay', value: 1 });
        meter.record({ kind: 'count', name: 'pulsar.relay', value: 1 });

        expect(sent).toEqual([]);

        tick();

        expect(sent).toEqual([{ kind: 'count', name: 'pulsar.relay', value: 2, attributes: {} }]);

        meter.record({ kind: 'gauge', name: 'broker.sockets', value: 3 });
        meter.stop();

        expect(sent).toHaveLength(2);
    });
});
