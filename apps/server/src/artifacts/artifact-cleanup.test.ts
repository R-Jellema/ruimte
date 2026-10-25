import { describe, expect, test } from 'bun:test';
import type { Artifact, ArtifactKind, ArtifactVersion, ProjectNode, ProjectView } from '@ruimte/contracts';
import { ProjectIndex } from '../projects/project-index.ts';
import { cleanupProposals, pinKey, pinnedVersionsOf } from './artifact-cleanup.ts';

function artifactOf(kind: ArtifactKind, count: number, artifactId = 'art-00000001'): { artifact: Artifact; versions: ArtifactVersion[] } {
    return {
        artifact: { artifactId, projectId: 'project-1', projectName: 'Ruimte', title: 'Nightly', kind, createdAt: 0 },
        versions: Array.from({ length: count }, (_unused, i) => ({
            versionId: `ver-${String(i + 1).padStart(8, '0')}`,
            number: i + 1,
            createdAt: i,
            files: [{ name: 'app.zip', mime: 'application/zip', size: 100, sha256: '0'.repeat(64) }],
            bytes: 100,
            provenance: { maker: 'agent', machineId: 'machine-1' },
            copiedTo: []
        }))
    };
}

describe('cleanupProposals', () => {
    test('proposes all but the latest seven builds and all but the latest thirty of anything else', () => {
        const proposals = cleanupProposals(
            [artifactOf('build', 10), artifactOf('report', 32, 'art-00000002'), artifactOf('report', 30, 'art-00000003')],
            new Set()
        );
        expect(proposals.map((proposal) => [proposal.artifactId, proposal.versions.map((version) => version.number), proposal.bytes])).toEqual([
            ['art-00000001', [1, 2, 3], 300],
            ['art-00000002', [1, 2], 200]
        ]);
    });

    test('never proposes a version copied into a project or one a node is pinned to', () => {
        const build = artifactOf('build', 9);
        build.versions[0] = { ...build.versions[0]!, copiedTo: ['dist/app.zip'] };
        const proposals = cleanupProposals([build], new Set([pinKey('art-00000001', 'ver-00000002')]));
        expect(proposals).toEqual([]);
    });
});

describe('the pins of the projects', () => {
    const node = (id: string, artifact?: { id: string; version?: string }): ProjectNode =>
        ({ id, kind: 'artifact', title: 'Nightly', x: 0, y: 0, w: 440, h: 520, ...(artifact === undefined ? {} : { artifact }) }) as ProjectNode;
    const canvas = (nodes: ProjectNode[]): ProjectView => ({ kind: 'canvas', id: 'main', name: 'Main', nodes, texts: [], edges: [], layouts: [] });

    test('come from every artifact node pinned to a version, and keep that version out of a cleanup', () => {
        const index = new ProjectIndex();
        index.set('project-1', '/work/one', {
            views: [canvas([node('a', { id: 'art-00000001', version: 'ver-00000002' }), node('b', { id: 'art-00000001' })])]
        });
        index.set('project-2', '/work/two', { views: [canvas([node('c', { id: 'art-00000001', version: 'ver-00000003' }), node('d')])] });
        const pinned = pinnedVersionsOf(index.pinnedArtifactVersions());
        expect([...pinned].sort()).toEqual([pinKey('art-00000001', 'ver-00000002'), pinKey('art-00000001', 'ver-00000003')]);

        const proposals = cleanupProposals([artifactOf('build', 10)], pinned);
        expect(proposals[0]!.versions.map((version) => version.number)).toEqual([1]);
    });
});
