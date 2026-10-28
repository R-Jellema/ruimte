import {
    TEMPLATE_LANGUAGES,
    TEMPLATE_PLACES,
    POSTFIX_TEMPLATE_LANGUAGES,
    type LiveTemplate as StoredLiveTemplate,
    type PersonalTemplates,
    type PostfixTemplate as StoredPostfixTemplate,
    type ProjectTemplates
} from '@ruimte/contracts';
import type { LiveTemplate, PostfixTemplate, TemplateLanguage, TemplatePlace, TemplateRegistry } from '@adecore/editor-react';
import { machineAnswers } from '@/transport/features';
import type { Transport } from '@/transport/transport';
import { SnapshotTracker } from './snapshot-tracker';

/*
 * What the machine holds of the editor's templates for one project: a person's own, and the project's
 * shared ones. `null` until the machine has answered, and for a machine that does not know templates.
 * `project` is null when the project has none to read, `projectTooNew` when its file is from a newer Ruimte.
 */
export interface TemplatesSnapshot {
    readonly personal: PersonalTemplates;
    readonly project: ProjectTemplates | null;
    readonly projectTooNew: boolean;
}

function isFamily(value: string): value is TemplateLanguage {
    return (TEMPLATE_LANGUAGES as readonly string[]).includes(value);
}

function isPlace(value: string): value is TemplatePlace {
    return (TEMPLATE_PLACES as readonly string[]).includes(value);
}

function isPostfixFamily(value: string): value is PostfixTemplate['languages'][number] {
    return (POSTFIX_TEMPLATE_LANGUAGES as readonly string[]).includes(value);
}

/* A family or place a newer Ruimte added is left out, and a template that names no family at all is dropped by the registry. */
export function liveTemplateOf(stored: StoredLiveTemplate): LiveTemplate {
    return {
        id: stored.id,
        key: stored.key,
        body: stored.body,
        ...(stored.description === undefined ? {} : { description: stored.description }),
        languages: stored.languages.filter(isFamily),
        ...(stored.places === undefined ? {} : { places: stored.places.filter(isPlace) })
    };
}

export function postfixTemplateOf(stored: StoredPostfixTemplate): PostfixTemplate {
    return {
        id: stored.id,
        key: stored.key,
        body: stored.body,
        ...(stored.description === undefined ? {} : { description: stored.description }),
        ...(stored.example === undefined ? {} : { example: stored.example }),
        languages: stored.languages.filter(isPostfixFamily),
        ...(stored.expression === undefined ? {} : { expression: stored.expression })
    };
}

export class TemplatesTracker extends SnapshotTracker<TemplatesSnapshot | null> {
    private readonly projectId: string;
    private readonly registry: TemplateRegistry;

    constructor(transport: Transport, projectId: string, registry: TemplateRegistry) {
        super(transport, null);
        this.projectId = projectId;
        this.registry = registry;
        this.subscriptions.push(
            transport.on('template.changed', (event) => {
                if (this.snapshot === null) {
                    return;
                }

                if (event.scope === 'personal') {
                    this.replace({ ...this.snapshot, personal: event.snapshot });
                } else if (event.projectId === projectId) {
                    this.replace({ ...this.snapshot, project: event.snapshot, projectTooNew: false });
                }
            })
        );
    }

    async refresh(): Promise<void> {
        if (!machineAnswers(this.transport.connection, 'template.list')) {
            return;
        }

        const { personal, project, projectTooNew } = await this.transport.request('template.list', { projectId: this.projectId });
        this.replace({ personal, project, projectTooNew: projectTooNew === true });
    }

    /* The registry is fed on every change, so an editor expands what a person just saved without a reload. */
    protected override replace(next: TemplatesSnapshot | null): void {
        super.replace(next);

        if (next !== null) {
            this.registry.set({
                live: [...next.personal.live, ...(next.project?.live ?? [])].map(liveTemplateOf),
                postfix: [...next.personal.postfix, ...(next.project?.postfix ?? [])].map(postfixTemplateOf),
                disabled: next.personal.disabled,
                settings: next.personal.settings
            });
        }
    }
}
