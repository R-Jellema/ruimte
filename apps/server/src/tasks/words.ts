import type { TaskWords } from '@adecore/agents/coordination';
import { taskBrief } from '../canvas/task-verbs.ts';

/* What Ruimte's tasks say in a parent's and a child's thread, in the verbs of `ruimte-context`. */
export const TASK_WORDS: TaskWords = {
    app: 'Ruimte',
    cli: 'ruimte-context',
    // The assignment plus the line a child opened with --task also gets.
    assignment: (task) => `${task.prompt}${taskBrief(true)}`,
    restOf: (childId) =>
        `ruimte-context read ${childId} shows the rest once a line runs from that node into you; ruimte-context link new --to ${childId} draws it.`
};
