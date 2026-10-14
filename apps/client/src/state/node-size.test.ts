import { afterEach, describe, expect, test } from 'bun:test';
import { NODE_SIZE } from '@ruimte/contracts';
import { createCanvasStore } from '@/state/canvas';
import { useEndpoints } from '@/state/endpoints';
import { defaultNodeSize, keepsNodeSizes } from '@/state/node-size';
import { serverInfoOf, useServers } from '@/state/server';

afterEach(() => {
    useServers.getState().forget(useEndpoints.getState().activeId);
});

function keepTerminalSize(): void {
    const endpointId = useEndpoints.getState().activeId;
    useServers.getState().setIdentity(endpointId, { ...serverInfoOf(endpointId), nodeSizes: { terminal: { w: 800, h: 480 } } });
}

describe('the size a new node takes', () => {
    test('is the one the machine keeps for its kind, and the built-in one of every other kind', () => {
        expect(defaultNodeSize('terminal')).toEqual(NODE_SIZE.terminal);
        keepTerminalSize();
        expect(defaultNodeSize('terminal')).toEqual({ w: 800, h: 480 });
        expect(defaultNodeSize('chat')).toEqual(NODE_SIZE.chat);
    });

    test('is what a node added to a canvas starts at, and a node already there keeps its own', () => {
        const canvas = createCanvasStore();
        canvas.setState({ viewId: 'main' });
        const before = canvas.getState().addNode('terminal', { x: 0, y: 0 })!;
        keepTerminalSize();
        const after = canvas.getState().addNode('terminal', { x: 2000, y: 0 })!;
        const { nodes } = canvas.getState();
        expect({ w: nodes[before]!.w, h: nodes[before]!.h }).toEqual(NODE_SIZE.terminal);
        expect({ w: nodes[after]!.w, h: nodes[after]!.h }).toEqual({ w: 800, h: 480 });
    });

    test('is only set on a machine that says it keeps sizes', () => {
        expect(keepsNodeSizes({ features: null })).toBe(false);
        expect(keepsNodeSizes({ features: ['endpoint.info'] })).toBe(false);
        expect(keepsNodeSizes({ features: ['endpoint.info', 'endpoint.setNodeSize'] })).toBe(true);
    });
});
