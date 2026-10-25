/* An id made of a name: lowercase letters, digits and dashes, starting with a letter or a digit, with room left for a number. */
export function slugOf(name: string, fallback: string): string {
    const slug = name
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48)
        .replace(/-+$/, '');
    return slug === '' ? fallback : slug;
}

/* The slug of a name, or that slug with the first number after it that no id in `taken` has. */
export function freeSlug(name: string, fallback: string, taken: ReadonlySet<string>): string {
    const base = slugOf(name, fallback);
    if (!taken.has(base)) {
        return base;
    }
    for (let i = 2; ; i++) {
        const candidate = `${base}-${i}`;
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
}
