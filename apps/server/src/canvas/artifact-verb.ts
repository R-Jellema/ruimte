import { ARTIFACT_KINDS, ARTIFACT_LIMITS, type Artifact, type ArtifactSummary, type ArtifactVersion } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_READ_BYTES } from '../artifacts/artifacts.ts';
import { defineActionVerb, runAction } from './action-verb.ts';
import { field, orNote, VerbRefusal } from './verb.ts';

export const ARTIFACT_SUMMARY = "Publishes results that should stay to this project's Output, and lists and reads what is there";

const GIB = 1024 * 1024 * 1024;

const HELP_LINE = 'detail\truimte-context help artifact publish';

function versionLine(artifact: Artifact, version: ArtifactVersion): string {
    return `artifact\t${artifact.artifactId}\t${version.versionId}\t${version.number}\t${artifact.kind}\t${field(artifact.title)}\t${version.files.length}\t${version.bytes}`;
}

function summaryLine(summary: ArtifactSummary): string {
    return `artifact\t${summary.artifactId}\t${summary.latest.versionId}\t${summary.latest.number}\t${summary.kind}\t${field(summary.title)}\t${summary.key ?? '-'}\t${new Date(summary.latest.createdAt).toISOString()}`;
}

const FilesSchema = z
    .string()
    .transform((text, context) => {
        try {
            return JSON.parse(text) as unknown;
        } catch {
            context.addIssue({ code: 'custom', message: '--files is JSON, which ruimte-context writes' });
            return z.NEVER;
        }
    })
    .pipe(z.array(z.object({ name: z.string(), size: z.number() })));

const publish = defineActionVerb('artifact', {
    name: 'publish',
    action: 'artifact.publish',
    usage: '--file <path> [--file <path> ...] [--title T] [--kind K] [--key K] [--request-id R]',
    params: [
        {
            syntax: '--file <path>',
            need: 'required',
            text: `A file in your own sandbox, once per file, at most ${ARTIFACT_LIMITS.filesPerVersion} and ${ARTIFACT_LIMITS.versionBytes / GIB} GiB together; ruimte-context reads them and sends their bytes, so the daemon never opens a path`
        },
        { syntax: '--title T', need: 'optional', field: 'title', more: 'the name of the first file without its extension when omitted' },
        {
            syntax: '--kind K',
            need: 'optional',
            field: 'kind',
            more: 'read off the first file when omitted: an image is image, Markdown or text is report, HTML is page, a video is recording, CSV or JSON is export, anything else build'
        },
        {
            syntax: '--key K',
            need: 'optional',
            field: 'key',
            more: 'lowercase letters, digits and dashes; the same key again adds a version to the same artifact'
        },
        { syntax: '--request-id R', need: 'optional', field: 'requestId', more: 'ruimte-context makes one per call when omitted' },
        { syntax: '--upload U', need: 'optional', field: 'upload', more: 'ruimte-context fills this; there is no reason to write it yourself' },
        { syntax: '--files F', need: 'optional', field: 'files', more: 'ruimte-context fills this from --file' }
    ],
    detail: [
        'prints\tartifact\tid\tversion\tnumber\tkind\ttitle\tfiles\tbytes\tthe version this call saved, or the one an earlier call with the same request id saved',
        'when\tPublish a result the person should keep beyond this conversation: a report, a build, an export, a recording, a page. An answer for now goes in your reply or in visual show',
        'provenance\tThe machine records which chat, turn, task and node made the version from the call itself; nothing you pass sets or changes it',
        'resume\tAn interrupted publish goes on where it stopped when you run the same command with the same --request-id',
        'refusals\ttoo-large\tdisk-full\tupload-incomplete\tupload-mismatch\ttoo-many-uploads\tbad-name\tbad-key\tkey-reserved\tthe codes this action refuses with',
        'see\truimte-context artifact list\twhat this project keeps'
    ],
    positionals: z.tuple([], { error: 'artifact publish takes no arguments; name each file with --file' }),
    flags: z.object({
        // Read by ruimte-context, which sends the bytes and leaves the flag out.
        file: z.string().optional(),
        upload: z.string().optional(),
        files: FilesSchema.optional(),
        title: z.string().optional(),
        kind: z.enum(ARTIFACT_KINDS, { error: `--kind is one of ${ARTIFACT_KINDS.join(', ')}` }).optional(),
        key: z.string().optional(),
        'request-id': z.string().optional()
    }),
    async run({ flags }, call) {
        if (flags.upload === undefined || flags.files === undefined || flags['request-id'] === undefined) {
            // Only ruimte-context reads the files; a call that skipped it has no bytes to publish.
            throw new VerbRefusal('bad-arguments', 'artifact publish needs --file <path>, which ruimte-context reads and sends before it asks the daemon', [
                HELP_LINE
            ]);
        }
        const { artifact, version, existing } = await runAction(call, 'artifact.publish', {
            upload: flags.upload,
            files: flags.files,
            requestId: flags['request-id'],
            ...(flags.title === undefined ? {} : { title: flags.title }),
            ...(flags.kind === undefined ? {} : { kind: flags.kind }),
            ...(flags.key === undefined ? {} : { key: flags.key })
        });
        return [
            versionLine(artifact, version),
            ...(existing ? ['note\tAn earlier call with this request id saved this version; nothing new was saved'] : []),
            'next\tThe person finds it in the Output panel of this project'
        ];
    }
});

const list = defineActionVerb('artifact', {
    name: 'list',
    action: 'artifact.list',
    usage: '',
    params: [],
    detail: [
        'prints\tartifact\tid\tlatest version\tnumber\tkind\ttitle\tkey\tsaved\tone line per artifact of this project, newest first, saved as an ISO time in UTC; a note when there is none'
    ],
    positionals: z.tuple([], { error: 'artifact list takes no arguments' }),
    flags: z.object({}),
    async run(_input, call) {
        const { artifacts } = await runAction(call, 'artifact.list', {});
        return orNote(artifacts.map(summaryLine), "This project's Output is empty");
    }
});

const read = defineActionVerb('artifact', {
    name: 'read',
    action: 'artifact.read',
    usage: '<artifactId> [--version V] [--file N]',
    params: [
        { syntax: '<artifactId>', need: 'required', field: 'artifactId' },
        { syntax: '--version V', need: 'optional', field: 'versionId' },
        { syntax: '--file N', need: 'optional', field: 'file' }
    ],
    detail: [
        'prints\tartifact\tid\tversion\tnumber\tkind\ttitle\tfiles\tbytes, then file\tplace\tname\tmime\tsize for every file, then the text of the file read',
        `text\tA text file prints whole up to ${MAX_READ_BYTES / 1024} KiB, then a truncated line; any other file prints what it is and no bytes`,
        'refusals\tnot-found\tthe code this action refuses with; an artifact of another project is not found'
    ],
    positionals: z.tuple([z.string().min(1, 'artifact read needs the id of an artifact; ruimte-context artifact list lists them')], {
        error: (issue) =>
            issue.code === 'too_big'
                ? 'artifact read takes one id and nothing else'
                : 'artifact read needs the id of an artifact; ruimte-context artifact list lists them'
    }),
    flags: z.object({
        version: z.string().min(1, '--version needs a version id').optional(),
        file: z.coerce
            .number({ error: '--file takes the place of a file, from 0' })
            .int('--file takes a whole number')
            .min(0, '--file counts from 0')
            .optional()
    }),
    async run({ positionals: [artifactId], flags }, call) {
        const reading = await runAction(call, 'artifact.read', {
            artifactId,
            ...(flags.version === undefined ? {} : { versionId: flags.version }),
            ...(flags.file === undefined ? {} : { file: flags.file })
        });
        const { artifact, version, file, text, truncated } = reading;
        const files = version.files.map((entry, index) => `file\t${index}\t${field(entry.name)}\t${entry.mime}\t${entry.size}`);
        const body =
            text === null
                ? [`note\t${field(file.name)} is ${file.mime}, which prints no text`]
                : ['', text, ...(truncated ? ['', `truncated\tThe first ${MAX_READ_BYTES / 1024} KiB of ${file.size} bytes; the rest is not printed`] : [])];
        return [versionLine(artifact, version), ...files, ...body];
    }
});

export const ARTIFACT_DETAIL: readonly string[] = [
    "scope\tOutput is this project's, kept on this machine outside the project folder; nothing you publish lands in the project's files"
];

export const ARTIFACT_ACTIONS = [publish, list, read] as const;
