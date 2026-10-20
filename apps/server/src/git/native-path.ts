/* A path git printed, in the form node:path speaks: git on Windows writes `C:/x/y` where node writes `C:\x\y`. */
export function nativePath(path: string, platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? path.replaceAll('/', '\\') : path;
}
