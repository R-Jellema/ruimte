import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView } from '@ruimte/contracts';
import type { DesktopBridge } from '@/desktop/bridge';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
const VOICE_BUTTON = 'Voice Control: press to toggle, hold to talk';

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };
const matchMedia = window.matchMedia;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function button(label: string): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function voiceLog(): Element | null {
    return document.querySelector('[role="log"]');
}

beforeEach(async () => {
    localStorage.clear();
    // The waveform animates on every frame unless motion is reduced, which would keep `act` from ever settling.
    window.matchMedia = (query) => {
        const list = matchMedia.call(window, query);
        if (!query.includes('prefers-reduced-motion')) {
            return list;
        }
        return {
            matches: true,
            media: query,
            onchange: null,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            addListener: () => undefined,
            removeListener: () => undefined,
            dispatchEvent: () => false
        } satisfies MediaQueryList;
    };
    scope.window.ruimteDesktop = {
        platform: 'darwin',
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        isFullscreen: async () => false,
        onFullscreen: () => () => undefined,
        openAi: {
            credentialStatus: async () => ({ configured: true, persistent: true }),
            saveApiKey: async () => ({ configured: true, persistent: true }),
            clearApiKey: async () => ({ configured: false, persistent: true }),
            createLiveSession: async () => ({ session: { id: 'session' }, transport: { type: 'webrtc', sdp: 'v=0' } })
        }
    } as DesktopBridge;
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} }, {}, { thisMachine: true });
    page = mount();
    await page.renderApp();
    await until(() => button(VOICE_BUTTON) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    delete scope.window.ruimteDesktop;
    window.matchMedia = matchMedia;
});

describe('Voice Control as a panel', () => {
    test('takes the place of the panel that was open, and the other way round', async () => {
        await clickOn(button(VOICE_BUTTON));
        await until(() => voiceLog() !== null);
        expect(button('Close Voice Control')).not.toBeNull();
        expect(button(VOICE_BUTTON)!.getAttribute('aria-pressed')).toBe('true');

        await clickOn(button('Files'));
        await until(() => voiceLog() === null);
        expect(button('Close Files')).not.toBeNull();
        expect(button('Close Voice Control')).toBeNull();
        expect(button(VOICE_BUTTON)!.getAttribute('aria-pressed')).toBe('false');

        await clickOn(button(VOICE_BUTTON));
        await until(() => voiceLog() !== null);
        expect(button('Close Files')).toBeNull();
    });
});
