import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import {
    REQUEST_SCHEMAS,
    type ArtifactGetResult,
    type ArtifactSummary,
    type ArtifactVersion,
    type ProjectCanvasView,
    type RequestType
} from '@ruimte/contracts';
import { useUi } from '@/state/ui';
import { useFiles } from '@/state/files';
import { TransportError } from '@/transport/transport';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const REPORTS: Record<string, string> = {
    'v-new': '# Dependency report\n\n9 behind\n',
    'v-old': '# Dependency report\n\n8 behind\n'
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function version(versionId: string, number: number, createdAt: number, patch: Partial<ArtifactVersion> = {}): ArtifactVersion {
    return {
        versionId,
        number,
        createdAt,
        files: [{ name: 'dependency-report.md', mime: 'text/markdown', size: REPORTS[versionId]?.length ?? 10, sha256: versionId }],
        bytes: REPORTS[versionId]?.length ?? 10,
        provenance: { maker: 'agent', machineId: 'mac', chatId: 'chat-gone' },
        copiedTo: [],
        ...patch
    };
}

function summary(artifactId: string, title: string, patch: Partial<ArtifactSummary> = {}): ArtifactSummary {
    const latest = patch.latest ?? version(`${artifactId}-v1`, 1, NOW);
    return {
        artifactId,
        projectId: 'project-atlas',
        projectName: 'Atlas',
        title,
        kind: 'report',
        createdAt: latest.createdAt,
        latest,
        versionCount: 1,
        totalBytes: latest.bytes,
        ...patch
    };
}

const DEPENDENCIES: ArtifactGetResult = {
    artifact: { artifactId: 'deps', projectId: 'project-atlas', projectName: 'Atlas', title: 'Dependency report', kind: 'report', createdAt: NOW - 7 * DAY },
    versions: [version('v-new', 2, NOW), version('v-old', 1, NOW - 7 * DAY)],
    chatPresent: false
};

const LIST: ArtifactSummary[] = [
    summary('deps', 'Dependency report', { latest: DEPENDENCIES.versions[0]!, versionCount: 2 }),
    summary('shots', 'Nightly screenshots', { kind: 'image', latest: version('shots-v1', 1, NOW - 3 * DAY) }),
    summary('beacon', 'Beacon build', { projectId: 'project-beacon', projectName: 'Beacon', kind: 'build', latest: version('beacon-v1', 1, NOW - 20 * DAY) })
];

function text(): string {
    return page.host.textContent ?? '';
}

function buttonWithText(label: string): HTMLElement | null {
    return ([...document.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.trim() === label) ?? null;
}

function filter(label: string): HTMLElement | null {
    const bar = page.host.querySelector('[role="group"][aria-label="Filters"]');
    // A project's chip starts with its glyph, which may be a letter of its own.
    return ([...(bar?.querySelectorAll('button') ?? [])] as HTMLElement[]).find((button) => button.textContent?.trim().endsWith(label)) ?? null;
}

function menuItem(label: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[]).find((item) => item.textContent?.includes(label)) ?? null;
}

async function openPanel(): Promise<void> {
    await act(async () => useUi.getState().setPanel({ open: true, kind: 'output' }));
}

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('artifact.list', () => ({ artifacts: LIST }));
    machine.answer('artifact.get', ({ artifactId }) => {
        if (artifactId !== 'deps') {
            throw new TransportError('not-found', 'No such artifact');
        }
        return DEPENDENCIES;
    });
    machine.answer('bytes.read', ({ resource, offset }) => {
        const body = resource.kind === 'artifact' ? (REPORTS[resource.versionId] ?? '') : '';
        return { mime: 'text/markdown', size: body.length, version: 'v', offset, data: btoa(body.slice(offset)) };
    });
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'files' }));
    await page.unmount();
    workspace.close();
    useFiles.setState({ tabs: [] });
});

describe('the Output panel', () => {
    test('lists this project by date, and All projects adds the others', async () => {
        await openPanel();
        await until(() => text().includes('Dependency report'));
        expect(machine.requests('artifact.watch')).toHaveLength(1);
        expect(text()).toContain('Today');
        expect(text()).toContain('This week');
        expect(text()).toContain('Nightly screenshots');
        expect(text()).not.toContain('Beacon build');
        expect(text()).toContain('2 shown');

        await clickOn(filter('Atlas'));
        await clickOn(menuItem('All projects'));
        await until(() => text().includes('Beacon build'));
        expect(text()).toContain('Earlier');
        expect(text()).toContain('3 shown');
    });

    test('a kind narrows the list, and a filter nothing passes says so', async () => {
        await openPanel();
        await until(() => text().includes('Nightly screenshots'));
        await clickOn(filter('All kinds'));
        await clickOn(menuItem('Image'));
        await until(() => !text().includes('Dependency report'));
        expect(text()).toContain('Nightly screenshots');

        await clickOn(filter('Any size'));
        await clickOn(menuItem('Over 1 GB'));
        await until(() => text().includes('Nothing matches these filters.'));
        await clickOn(buttonWithText('Reset'));
        await until(() => text().includes('Dependency report'));
    });

    test('a row opens its latest versions under it', async () => {
        await openPanel();
        await until(() => text().includes('Dependency report'));
        await clickOn(page.host.querySelector('[aria-label="Show versions"]'));
        await until(() => machine.requests('artifact.get').length > 0 && text().includes('Latest'));
        expect(machine.requests('artifact.get')[0]).toEqual({ artifactId: 'deps' });
    });

    test('a machine with nothing saved says how something gets there', async () => {
        machine.answer('artifact.list', () => ({ artifacts: [] }));
        await openPanel();
        await until(() => text().includes('Nothing saved yet'));
    });

    test('a machine that does not keep Output asks for an update and is never asked', async () => {
        const all = Object.keys(REQUEST_SCHEMAS) as RequestType[];
        machine.answersOnly(all.filter((type) => !type.startsWith('artifact.')));
        await openPanel();
        await until(() => text().includes('This machine runs an older Ruimte'));
        expect(machine.requests('artifact.list')).toHaveLength(0);
        expect(machine.requests('artifact.watch')).toHaveLength(0);
    });
});

describe('the artifact view', () => {
    async function openDependencies(): Promise<void> {
        await openPanel();
        await until(() => text().includes('Dependency report'));
        await clickOn(
            ([...page.host.querySelectorAll('section button')] as HTMLElement[]).find((button) => button.textContent?.startsWith('Dependency report')) ?? null
        );
        await until(() => text().includes('Where it came from') && text().includes('9 behind'));
    }

    test('shows the latest version, its record and a chat that is gone', async () => {
        await openDependencies();
        expect(text()).toContain('Versions');
        expect(text()).toContain('By an agent');
        expect(text()).toContain('Chat removed');
        expect(text()).toContain('An agent cannot set or change it.');
        expect(machine.requests('bytes.read')[0]!.resource).toEqual({ kind: 'artifact', artifactId: 'deps', versionId: 'v-new', file: 0 });
    });

    test('Compare sets the version before it beside the latest', async () => {
        await openDependencies();
        await clickOn(buttonWithText('Compare'));
        await until(() => text().includes('Pick a base') && text().includes('Base'));
        await until(() => text().includes('+1') && text().includes('-1'));
    });

    test('Copy to project refuses a name that is taken, beside the name', async () => {
        machine.answer('artifact.copyToProject', () => {
            throw new TransportError('exists', 'That name exists in the project already. Ruimte never overwrites a file.');
        });
        await openDependencies();
        await clickOn(buttonWithText('Copy to project'));
        await until(() => document.querySelector('[role="dialog"]') !== null);
        const dialog = document.querySelector('[role="dialog"]')!;
        await act(async () => {
            dialog.querySelector('form')!.requestSubmit();
        });
        await until(() => (dialog.textContent ?? '').includes('dependency-report.md exists. Ruimte never overwrites a file.'));
        expect(machine.requests('artifact.copyToProject')[0]).toEqual({
            artifactId: 'deps',
            versionId: 'v-new',
            projectId: 'project-atlas',
            path: 'dependency-report.md'
        });
    });
});
