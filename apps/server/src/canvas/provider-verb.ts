import { z } from 'zod';
import { defineActionVerb, runAction } from './action-verb.ts';
import { field, orNote } from './verb.ts';

const JSON_PARAM = { syntax: '--json', need: 'no value', text: 'Prints the answer as one JSON object instead of lines' } as const;
const REFRESH_PARAM = { syntax: '--refresh', need: 'no value', text: 'Asks again now instead of answering from the last hour' } as const;

const PERSON_INSTALLS =
    "person\tInstalling, updating and removing stay a person's, in Settings, Providers: no verb downloads or runs an installer. Name what you would install or update and why, and ask the person";

function json(value: unknown): string[] {
    return [JSON.stringify(value, null, 2)];
}

function when(at: number | null): string {
    return at === null ? '-' : new Date(at).toISOString();
}

const catalogAction = defineActionVerb('provider', {
    name: 'catalog',
    action: 'provider.catalog',
    usage: '[--search S] [--refresh] [--json]',
    params: [{ syntax: '--search S', need: 'optional', field: 'search' }, REFRESH_PARAM, JSON_PARAM],
    detail: [
        'prints\tregistry\tsource\tread at\tlive, cached or unavailable, when the registry was read, and why the last read failed when it did',
        'prints\tagent\tkind\tname\tversion\tdistribution\tinstalled\tstate\tdescription\tone line per agent with a build or package for this machine; distribution is binary, npm or uv, installed a version or -',
        'chat\tAn installed agent is a chat on this machine; ruimte-context agent <kind> opens one',
        PERSON_INSTALLS,
        'refusals\tno-providers\tthe codes this action refuses with'
    ],
    positionals: z.tuple([]),
    flags: z.object({ search: z.string().min(1, '--search needs words to look for').optional() }),
    switches: ['refresh', 'json'],
    async run({ flags, switches }, call) {
        const catalog = await runAction(call, 'provider.catalog', { search: flags.search ?? null, refresh: switches.has('refresh') });
        if (switches.has('json')) {
            return json(catalog);
        }
        return [
            `registry\t${catalog.source}\t${when(catalog.fetchedAt)}${catalog.error === undefined ? '' : `\t${field(catalog.error)}`}`,
            ...orNote(
                catalog.agents.map((agent) =>
                    [
                        'agent',
                        agent.kind,
                        field(agent.name),
                        field(agent.version),
                        agent.distribution,
                        agent.installed === null ? '-' : field(agent.installed),
                        agent.state,
                        field(agent.description)
                    ].join('\t')
                ),
                flags.search === undefined ? 'The registry lists no agent this machine can run' : 'No agent of the registry matches that search'
            ),
            PERSON_INSTALLS
        ];
    }
});

const versionsAction = defineActionVerb('provider', {
    name: 'versions',
    action: 'provider.versions',
    usage: '[--refresh] [--json]',
    params: [REFRESH_PARAM, JSON_PARAM],
    detail: [
        'prints\tcli\tkind\tversion\tmethod\tpackage\tlatest\tupdate\tone line per CLI; method is homebrew, homebrew-cask, npm, pnpm, bun, ruimte or unknown, update is yes or no, a dash where nothing is known',
        'unknown\tA CLI installed some other way shows its version and never an update: its own installer keeps it current',
        PERSON_INSTALLS,
        'refusals\tno-providers\tthe codes this action refuses with'
    ],
    positionals: z.tuple([]),
    flags: z.object({}),
    switches: ['refresh', 'json'],
    async run({ switches }, call) {
        const { versions } = await runAction(call, 'provider.versions', { refresh: switches.has('refresh') });
        if (switches.has('json')) {
            return json({ versions });
        }
        return [
            ...versions.map((version) =>
                [
                    'cli',
                    version.provider,
                    version.version === null ? '-' : field(version.version),
                    version.method,
                    version.package === null ? '-' : field(version.package),
                    version.latest === null ? '-' : field(version.latest),
                    version.updatable ? 'yes' : 'no',
                    ...(version.error === undefined ? [] : [field(version.error)])
                ].join('\t')
            ),
            PERSON_INSTALLS
        ];
    }
});

export const PROVIDER_SUMMARY =
    "Reads the agents of the public ACP registry this machine can run and the versions of its agent CLIs; installing and updating stay a person's";

export const PROVIDER_DETAIL: readonly string[] = [
    'when\tBefore you suggest another agent or an update to the person: catalog lists what the registry offers here, versions what is installed and whether its route has a newer one',
    PERSON_INSTALLS
];

export const PROVIDER_ACTIONS = [catalogAction, versionsAction] as const;
