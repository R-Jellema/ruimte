import { sep } from 'node:path';

/* Whether `path` is `ancestor` or lies below it, for paths that are already absolute and normalized. */
export function isUnder(path: string, ancestor: string): boolean {
    return path === ancestor || path.startsWith(ancestor.endsWith(sep) ? ancestor : `${ancestor}${sep}`);
}

/* Whether a value can be one name in a path: an id from the wire that becomes a folder or file name must pass this first. */
export function isPathSegment(value: string): boolean {
    return value !== '' && value !== '.' && value !== '..' && !/[/\\\0]/.test(value) && !value.includes('..');
}
