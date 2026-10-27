import { createToastStore, type Toast as UiToast } from '@adecore/ui';

export interface Toast extends UiToast {
    /* Everything the command wrote, behind the copy button of a failure. */
    output?: string;
}

/* The one place the app says how something went. A git action keeps one toast from progress to its end, so a push never shows two cards. */
export const useToasts = createToastStore<Toast>();
