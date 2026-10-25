import type { Artifact, ArtifactCleanupProposal, ArtifactVersion } from '@ruimte/contracts';

// Asked at the moment a person looks, and stored nowhere: no rule on disk removes anything.
const KEEP_VERSIONS = 30;
const KEEP_BUILDS = 7;

/* Versions a canvas node is pinned to, as `<artifactId>/<versionId>`. */
export type PinnedVersions = () => ReadonlySet<string>;

export const NO_PINS: PinnedVersions = () => new Set();

export function pinKey(artifactId: string, versionId: string): string {
    return `${artifactId}/${versionId}`;
}

/* The pins the nodes of every project hold, read at the moment a cleanup is asked for or confirmed. */
export function pinnedVersionsOf(pins: ReadonlyArray<{ artifactId: string; versionId: string }>): ReadonlySet<string> {
    return new Set(pins.map((pin) => pinKey(pin.artifactId, pin.versionId)));
}

/* Whether a version may ever be proposed or removed: never one copied into a project, nor one a node is pinned to. */
export function removable(artifact: Artifact, version: ArtifactVersion, pinned: ReadonlySet<string>): boolean {
    return version.copiedTo.length === 0 && !pinned.has(pinKey(artifact.artifactId, version.versionId));
}

/*
 * What a person may want to let go of: past the latest 30 versions of any artifact, and past the
 * latest 7 of a build. The latest version is never in it. `versions` run oldest first.
 */
export function cleanupProposals(
    artifacts: ReadonlyArray<{ artifact: Artifact; versions: readonly ArtifactVersion[] }>,
    pinned: ReadonlySet<string>
): ArtifactCleanupProposal[] {
    const proposals: ArtifactCleanupProposal[] = [];
    for (const { artifact, versions } of artifacts) {
        const keep = Math.max(1, artifact.kind === 'build' ? KEEP_BUILDS : KEEP_VERSIONS);
        const candidates = versions.slice(0, Math.max(0, versions.length - keep)).filter((version) => removable(artifact, version, pinned));
        if (candidates.length === 0) {
            continue;
        }
        proposals.push({
            id: artifact.artifactId,
            artifactId: artifact.artifactId,
            title: artifact.title,
            versions: candidates.map((version) => ({
                versionId: version.versionId,
                number: version.number,
                createdAt: version.createdAt,
                bytes: version.bytes
            })),
            bytes: candidates.reduce((sum, version) => sum + version.bytes, 0)
        });
    }
    return proposals.sort((a, b) => b.bytes - a.bytes);
}
