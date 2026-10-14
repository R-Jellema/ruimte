import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DesktopBridge } from '@/desktop/bridge';
import { useSettings } from '@/state/settings';
import { useWindow } from '@/state/window';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { machineBridge } from '../../testing/machine-bridge';

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };

let page: Mounted;
let chosen: string[];
let found: Promise<boolean>;
let choose: (mode: 'local' | 'none') => Promise<void>;

function text(): string {
    return page.host.textContent ?? '';
}

function button(label: string): HTMLButtonElement | null {
    return [...page.host.querySelectorAll('button')].find((element) => element.textContent?.includes(label)) ?? null;
}

function radio(label: string): HTMLElement | null {
    return [...page.host.querySelectorAll<HTMLElement>('[role="radio"]')].find((element) => element.textContent?.includes(label)) ?? null;
}

async function open(): Promise<void> {
    scope.window.ruimteDesktop = {
        platform: 'darwin',
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        isFullscreen: async () => false,
        onFullscreen: () => () => undefined,
        machine: machineBridge('ask', { found: () => found, choose: (mode) => choose(mode) })
    };
    page = mount();
    await page.renderApp();
    await until(() => text().includes('Welcome to Ruimte'));
}

beforeEach(() => {
    chosen = [];
    found = Promise.resolve(false);
    choose = async (mode) => {
        chosen.push(mode);
    };
    useWindow.getState().setBooting(false);
    useSettings.setState({ onboardingSkipWelcome: false });
});

afterEach(async () => {
    await page.unmount();
    useSettings.setState({ onboardingSkipWelcome: false });
    delete scope.window.ruimteDesktop;
});

describe('the first start of a new install', () => {
    test('asks before anything else, with this computer running agents chosen', async () => {
        await open();
        expect(radio('This computer runs agents')?.getAttribute('aria-checked')).toBe('true');
        expect(radio('Only connect to my machines')?.getAttribute('aria-checked')).toBe('false');
        expect(text()).not.toContain('Open folder');
    });

    test('offers the machine that already runs here', async () => {
        found = Promise.resolve(true);
        await open();
        await until(() => radio('Use this machine') !== null);
        expect(radio('Use this machine')?.getAttribute('aria-checked')).toBe('true');
        expect(text()).not.toContain('This computer runs agents');
    });

    test('Continue runs a machine here and marks the task list to open without the welcome', async () => {
        await open();
        await clickOn(button('Continue'));
        expect(chosen).toEqual(['local']);
        expect(useSettings.getState().onboardingSkipWelcome).toBe(true);
        expect(text()).toContain('Restarting…');
        expect(button('Restarting…')?.disabled).toBe(true);
    });

    test('connecting only sends none and leaves the welcome for the machine that never comes', async () => {
        await open();
        await clickOn(radio('Only connect to my machines'));
        await clickOn(button('Continue'));
        expect(chosen).toEqual(['none']);
        expect(useSettings.getState().onboardingSkipWelcome).toBe(false);
    });

    test('a choice that could not be saved says why and asks again', async () => {
        choose = () => Promise.reject(new Error('disk full'));
        await open();
        await clickOn(button('Continue'));
        await until(() => text().includes('Ruimte could not save this choice. disk full'));
        expect(button('Continue')?.disabled).toBe(false);
        expect(radio('This computer runs agents')?.getAttribute('aria-checked')).toBe('true');
        expect(useSettings.getState().onboardingSkipWelcome).toBe(false);
    });

    test('the group comes before Continue, and both take the keyboard', async () => {
        await open();
        const group = page.host.querySelector('[role="radiogroup"]');
        const next = button('Continue');
        expect(group).not.toBeNull();
        expect(next).not.toBeNull();
        expect((group as Node).compareDocumentPosition(next as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(next?.tabIndex).toBe(0);
        expect(radio('This computer runs agents')?.tabIndex).toBe(0);
    });
});
