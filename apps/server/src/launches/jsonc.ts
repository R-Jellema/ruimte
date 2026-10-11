/* A `launch.json` is JSON with comments and trailing commas; null is anything that does not parse. */
export function parseJsonc(text: string): unknown | null {
    try {
        return Bun.JSONC.parse(text);
    } catch {
        return null;
    }
}
