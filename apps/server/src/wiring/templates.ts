import { join } from 'node:path';
import { PERSONAL_TEMPLATES_FILE, TemplateStore } from '../templates/template-store.ts';
import type { ProjectsBundle } from './projects.ts';

/* A person's editor templates and the shared ones of each project. */
export interface TemplatesBundle {
    store: TemplateStore;
}

export function wireTemplates(home: string, projects: ProjectsBundle): TemplatesBundle {
    const store = new TemplateStore({
        path: join(home, PERSONAL_TEMPLATES_FILE),
        projects: { folderOf: (projectId) => projects.store.index.folderOf(projectId), holdersOf: (projectId) => projects.store.holdersOf(projectId) }
    });

    return { store };
}
