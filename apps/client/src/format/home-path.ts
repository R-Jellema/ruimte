import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useServers } from '@/state/server';

/* The home folder at the start of a path written as `~`, which is how a person knows the path. */
export function withTilde(path: string, home: string | null | undefined): string {
    if (!home) {
        return path;
    }
    const base = home.replace(/[\\/]+$/, '');
    if (path === base) {
        return '~';
    }
    return path.startsWith(`${base}/`) || path.startsWith(`${base}\\`) ? `~${path.slice(base.length)}` : path;
}

/* Paths of this computer, whose home is the local machine's. */
export function useLocalTilde(): (path: string) => string {
    const home = useServers((state) => state.byEndpoint[LOCAL_ENDPOINT_ID]?.home);
    return (path) => withTilde(path, home);
}
