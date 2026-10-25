/* The folder a path sits in, which is what `fs.changed` names when something in it moves. */
export function dirnameOf(path: string): string {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return cut > 0 ? path.slice(0, cut) : path.slice(0, cut + 1);
}
