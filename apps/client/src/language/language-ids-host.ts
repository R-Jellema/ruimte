import { lspLanguageIdOf } from '@adecore/editor-react';
import { matchesFilePattern, type LanguageServerStatus } from '@ruimte/contracts';

// Catalog languages the shared table does not know yet (basmilius/adecore#86); drop a row once it does.
const MISSING_LSP_IDS: Record<string, string> = { rust: 'rust' };

/* The LSP language id of a file a catalog server serves, by its highlighter id, or null when none does. */
export function catalogLanguageIdOf(language: string | undefined): string | null {
    return lspLanguageIdOf(language) ?? (language === undefined ? null : (MISSING_LSP_IDS[language] ?? null));
}

export function customLanguageIdOf(statuses: readonly LanguageServerStatus[], language: string | undefined, storedPath: string): string | null {
    for (const status of statuses) {
        if (status.languages === undefined || status.patterns === undefined) {
            continue;
        }
        if (language !== undefined && status.languages.includes(language.toLowerCase())) {
            return language.toLowerCase();
        }
        if (status.patterns.some((pattern) => matchesFilePattern(pattern, storedPath))) {
            return language?.toLowerCase() ?? 'plaintext';
        }
    }
    return null;
}
