import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';

let page: Mounted;

function field(): HTMLInputElement | null {
    return document.querySelector('input[role="combobox"]');
}

function rows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

function highlighted(): HTMLElement | undefined {
    return rows().find((row) => row.hasAttribute('data-highlighted'));
}

function expectFieldHoldsTheKeys(row: HTMLElement): void {
    expect(document.activeElement).toBe(field());
    expect(field()!.getAttribute('aria-activedescendant')).toBe(row.id);
    expect(highlighted()).toBe(row);
}

async function type(text: string): Promise<void> {
    await act(async () => {
        const input = field()!;
        // React tracks the value it set, so the browser's own setter is what makes the change show.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
        // A typed key carries an `inputType`; without one Base UI reads the change as autofill.
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    });
}

function labels(): string[] {
    return rows().map((row) => row.textContent ?? '');
}

async function openPalette(open: () => void, ready: () => boolean): Promise<void> {
    page = mount();
    await page.renderApp();
    await act(async () => open());
    await until(() => field() !== null && document.activeElement === field() && ready());
}

afterEach(async () => {
    await act(async () => useUi.getState().setPaletteOpen(false));
    await page.unmount();
});

describe('the command palette keeps the keyboard in its field', () => {
    beforeEach(async () => {
        await openPalette(
            () => useUi.getState().setPaletteOpen(true),
            () => rows().length > 2
        );
    });

    test('the rows stay out of the tab order', () => {
        expect(rows().every((row) => row.tabIndex === -1)).toBe(true);
    });

    test('the arrow keys move the highlight and the field keeps the focus', async () => {
        expectFieldHoldsTheKeys(rows()[0]!);
        await pressKey(field()!, 'ArrowDown');
        expectFieldHoldsTheKeys(rows()[1]!);
        await pressKey(field()!, 'ArrowDown');
        expectFieldHoldsTheKeys(rows()[2]!);
        await pressKey(field()!, 'ArrowUp');
        expectFieldHoldsTheKeys(rows()[1]!);
    });

    test('hovering a row highlights it and the field keeps the focus', async () => {
        const row = rows()[2]!;
        await act(async () => {
            // On WebKit, which happy-dom passes Base UI's check for, a move without movement is no hover.
            row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 1 }));
        });
        expectFieldHoldsTheKeys(row);
    });

    test('pressing a row does not take the focus out of the field', async () => {
        const pressed = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        await act(async () => {
            rows()[1]!.dispatchEvent(pressed);
        });
        expect(pressed.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(field());
    });

    test('a row that gets the focus anyway hands it back to the field', async () => {
        await pressKey(field()!, 'ArrowDown');
        const row = highlighted()!;
        await act(async () => row.focus());
        expectFieldHoldsTheKeys(row);
    });

    test('what is typed lands in the field and filters the list', async () => {
        const before = rows().length;
        await pressKey(field()!, 'ArrowDown');
        await type('open folder');
        await until(() => rows().length < before);
        expect(field()!.value).toBe('open folder');
        expect(rows().length).toBeGreaterThan(0);
        expect(rows().every((row) => row.textContent!.toLowerCase().includes('open folder'))).toBe(true);
        expectFieldHoldsTheKeys(rows()[0]!);
    });
});

function addMachine(id: string, label: string): void {
    useEndpoints.getState().add({
        id,
        label,
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
}

describe('browsing the folders of a machine', () => {
    const FOLDERS: Record<string, string[]> = { '~/': ['alpha', 'beta', 'gamma'], '~/gamma/': ['x', 'y', 'z'] };
    let disconnect: () => void;

    beforeEach(async () => {
        const machine = new FakeMachine();
        machine.answer('fs.browse', ({ partialPath }) => ({
            parentPath: partialPath,
            exists: true,
            entries: (FOLDERS[partialPath] ?? []).map((name) => ({ name, fullPath: `${partialPath}${name}`, hasCanvas: false }))
        }));
        addMachine('machine-b', 'MacBook Pro');
        disconnect = connectFakeMachine(machine, 'machine-b');
        useEndpoints.getState().setActive('machine-b');
        await openPalette(
            () => useUi.getState().openFolderBrowser(),
            () => labels().join() === 'alpha,beta,gamma'
        );
    });

    afterEach(() => {
        disconnect();
        useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
        useEndpoints.getState().remove('machine-b');
    });

    test('Enter steps into the highlighted folder with its first row highlighted, the field says where, and the palette stays open', async () => {
        await pressKey(field()!, 'ArrowDown');
        await pressKey(field()!, 'ArrowDown');
        expect(highlighted()?.textContent).toBe('gamma');
        await pressKey(field()!, 'Enter');
        await until(() => labels().join() === '..,x,y,z');
        expect(field()!.value).toBe('~/gamma/');
        expectFieldHoldsTheKeys(rows()[0]!);
    });
});

describe('choosing a machine to browse', () => {
    beforeEach(async () => {
        addMachine('machine-b', 'MacBook Pro');
        addMachine('machine-c', 'Studio');
        useEndpoints.getState().setActive('machine-c');
        await openPalette(
            () => useUi.getState().openFolderBrowser(),
            () => rows().length === 2
        );
    });

    afterEach(() => {
        useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
        useEndpoints.getState().remove('machine-b');
        useEndpoints.getState().remove('machine-c');
    });

    test('opens on the machine the app is pointed at, first in the list', () => {
        expect(labels()[0]).toStartWith('Studio');
        expect(labels()[1]).toStartWith('MacBook Pro');
        expectFieldHoldsTheKeys(rows()[0]!);
    });
});
