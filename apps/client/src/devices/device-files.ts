import { deviceTools, type DeviceInfo } from '@ruimte/contracts';

const MEDIA = ['.png', '.jpg', '.jpeg', '.heic', '.gif', '.mp4', '.mov'];

type Device = Pick<DeviceInfo, 'platform' | 'kind' | 'capabilities'>;

function extensionOf(path: string): string {
    const name = path.replace(/\/+$/, '').split('/').pop() ?? '';
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/* The app bundles a device installs: a simulator an .app, an iPhone an .app or an .ipa, Android an .apk. */
function appExtensions(device: Pick<DeviceInfo, 'platform' | 'kind'>): readonly string[] {
    if (device.platform === 'android') {
        return ['.apk'];
    }
    return device.kind === 'simulator' ? ['.app'] : ['.app', '.ipa'];
}

export function isInstallable(device: Pick<DeviceInfo, 'platform' | 'kind'>, path: string): boolean {
    return appExtensions(device).includes(extensionOf(path));
}

export function isMedia(path: string): boolean {
    return MEDIA.includes(extensionOf(path));
}

/* What a drop of these machine paths on a device asks of it, or null when the device takes none of them that way. */
export function dropAction(device: Device, paths: readonly string[]): DropAction | null {
    const tools = deviceTools(device);
    if (paths.length === 1 && tools.includes('installApp') && isInstallable(device, paths[0]!)) {
        return { action: 'installApp', path: paths[0]! };
    }
    if (paths.length > 0 && paths.length <= 20 && tools.includes('addMedia') && paths.every(isMedia)) {
        return { action: 'addMedia', paths: [...paths] };
    }
    return null;
}

type DropAction = { action: 'installApp'; path: string } | { action: 'addMedia'; paths: string[] };
