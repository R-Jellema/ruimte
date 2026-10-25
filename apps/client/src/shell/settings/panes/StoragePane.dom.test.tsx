import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { REQUEST_SCHEMAS, type ArtifactCleanupProposal, type ArtifactStorageResult, type ProjectCanvasView, type RequestType } from '@ruimte/contracts';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';
import { FakeMachine } from '../../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../../testing/fake-workspace';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 6, 24, 7);

const STORAGE: ArtifactStorageResult = {
    projects: [
        { projectId: 'project-chats', projectName: 'Chats', artifacts: 1, versions: 30, bytes: 33 * MB },
        { projectId: 'project-atlas', projectName: 'Atlas', artifacts: 8, versions: 163, bytes: 700 * MB }
    ],
    total: { artifacts: 9, versions: 193, bytes: 733 * MB },
    disk: { free: 388 * 1024 * MB, size: 1024 * 1024 * MB }
};

const SUMMARY: ArtifactCleanupProposal = {
    id: 'morning',
    artifactId: 'morning',
    title: 'Morning summary',
    versions: [1, 2, 3].map((number) => ({ versionId: `m-${number}`, number, createdAt: START + number * DAY, bytes: 4 * MB })),
    bytes: 12 * MB
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function text(): string {
    return document.body.textContent ?? '';
}

function button(label: string): HTMLElement | null {
    return ([...document.querySelectorAll('button')] as HTMLElement[]).find((element) => element.textContent?.trim() === label) ?? null;
}

async function openStorage(): Promise<void> {
    await act(async () => useUi.getState().setSettings({ open: true, section: 'storage' }));
}

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('artifact.storage', () => STORAGE);
    machine.answer('artifact.cleanup', (payload) =>
        payload.mode === 'preview' ? { proposals: [SUMMARY] } : { removed: payload.versions.length, freedBytes: payload.versions.length * 4 * MB }
    );
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'files' }));
    await page.unmount();
    workspace.close();
});

describe('the Storage pane', () => {
    test('shows what the machine keeps, a bar per project and what is free', async () => {
        await openStorage();
        await until(() => text().includes('Output on Fake machine'));
        expect(text()).toContain('733 MB');
        expect(text()).toContain('388 GB free on the disk');
        expect(document.querySelector('[aria-label="Output by project"]')?.querySelectorAll('li')).toHaveLength(2);
        // The largest project first.
        expect(text().indexOf('Atlas')).toBeLessThan(text().indexOf('Chats'));
        expect(text()).toContain('8 artifacts, 163 versions');
    });

    test('Show in Output opens the panel on that project', async () => {
        await openStorage();
        await until(() => text().includes('Show in Output'));
        await clickOn(button('Show in Output'));
        expect(useUi.getState().settings.open).toBe(false);
        expect(useUi.getState().panel.open && useUi.getState().panel.kind).toBe('output');
    });

    test('Review removes exactly the versions left checked', async () => {
        await openStorage();
        await until(() => text().includes('Older versions of Morning summary'));
        expect(text()).toContain('Frees 12 MB, 3 versions');
        await clickOn(button('Review'));
        await until(() => document.querySelector('[role="dialog"] [role="checkbox"][aria-label="Version 2"]') !== null);
        await clickOn(document.querySelector('[role="checkbox"][aria-label="Version 2"]'));
        await until(() => button('Remove 2 versions') !== null);
        await clickOn(button('Remove 2 versions'));
        await until(() => machine.requests('artifact.cleanup').some((payload) => payload.mode === 'confirm'));
        expect(machine.requests('artifact.cleanup').find((payload) => payload.mode === 'confirm')).toEqual({
            mode: 'confirm',
            versions: [
                { artifactId: 'morning', versionId: 'm-1' },
                { artifactId: 'morning', versionId: 'm-3' }
            ]
        });
        await until(() => text().includes('8 MB freed on Fake machine'));
    });

    test('Not now puts a proposal away for this session', async () => {
        await openStorage();
        await until(() => text().includes('Older versions of Morning summary'));
        await clickOn(button('Not now'));
        await until(() => text().includes('Nothing to clean up'));
        expect(machine.requests('artifact.cleanup').every((payload) => payload.mode === 'preview')).toBe(true);
    });

    test('a machine with nothing to let go says so', async () => {
        machine.answer('artifact.cleanup', () => ({ proposals: [] }));
        await openStorage();
        await until(() => text().includes('Nothing to clean up'));
    });

    test('a machine that does not keep Output asks for an update and is never asked', async () => {
        const all = Object.keys(REQUEST_SCHEMAS) as RequestType[];
        machine.answersOnly(all.filter((type) => !type.startsWith('artifact.')));
        await openStorage();
        await until(() => text().includes('Fake machine runs an older Ruimte'));
        expect(machine.requests('artifact.storage')).toHaveLength(0);
    });

    test('a machine that does not answer says so', async () => {
        await openStorage();
        await until(() => text().includes('Output on Fake machine'));
        await act(async () => machine.lose());
        await until(() => text().includes('Fake machine does not answer right now.'));
        expect(text()).not.toContain('Show in Output');
    });
});
