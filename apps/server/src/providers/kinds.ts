/*
 * The agent CLIs this daemon offers, the local model last, in the order every menu lists them. Apart from
 * the providers so a note or a verb can name them at load without importing every backend.
 */
export const BUILT_IN_KINDS = ['claude', 'codex', 'antigravity', 'copilot', 'grok', 'apple'] as const;
