import { create } from 'zustand';
import { deviceMatches, type DeviceInfo, type DeviceReference, type DeviceUnavailable } from '@ruimte/contracts';
import { z } from 'zod';
import { storedJson } from '@/state/stored-json';

export interface DeviceListState {
    devices: DeviceInfo[];
    unavailable: DeviceUnavailable[];
    loaded: boolean;
    loading: boolean;
    error: string | null;
}

export const EMPTY_DEVICE_LIST: DeviceListState = { devices: [], unavailable: [], loaded: false, loading: false, error: null };

const storedCollapsedGroups = storedJson<string[], readonly string[]>(
    'ruimte.devices.collapsed',
    z.array(z.unknown()).transform((items) => items.filter((item): item is string => typeof item === 'string'))
);

function readCollapsedGroups(): readonly string[] {
    return storedCollapsedGroups.read() ?? [];
}

function persistCollapsedGroups(keys: readonly string[]): void {
    storedCollapsedGroups.write(keys);
}

export interface EraseRequest {
    endpointId: string;
    device: DeviceInfo;
}

interface DevicesState {
    byEndpoint: Record<string, DeviceListState>;
    /* When a person's recording of a device began, by `recordingKey`, so a node shows it with its panel closed. */
    recordings: Record<string, number>;
    markRecording(key: string, startedAt: number | null): void;
    /* The device a person asked to erase, while the question is up. */
    erasing: EraseRequest | null;
    askErase(request: EraseRequest | null): void;
    /* The groups of the devices panel a person folded away, on every machine alike. */
    collapsedGroups: readonly string[];
    collapseGroup(key: string, collapsed: boolean): void;
    setLoading(endpointId: string): void;
    receive(endpointId: string, devices: DeviceInfo[], unavailable: DeviceUnavailable[]): void;
    fail(endpointId: string, error: string): void;
    patch(endpointId: string, device: DeviceInfo): void;
    forget(endpointId: string): void;
}

export const useDevices = create<DevicesState>((set, get) => ({
    byEndpoint: {},
    recordings: {},
    erasing: null,
    askErase(request) {
        set({ erasing: request });
    },
    markRecording(key, startedAt) {
        const { [key]: _removed, ...others } = get().recordings;
        set({ recordings: startedAt === null ? others : { ...others, [key]: startedAt } });
    },
    collapsedGroups: readCollapsedGroups(),
    collapseGroup(key, collapsed) {
        const others = get().collapsedGroups.filter((candidate) => candidate !== key);
        const collapsedGroups = collapsed ? [...others, key] : others;
        persistCollapsedGroups(collapsedGroups);
        set({ collapsedGroups });
    },
    setLoading(endpointId) {
        const current = get().byEndpoint[endpointId] ?? EMPTY_DEVICE_LIST;
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...current, loading: true, error: null } } });
    },
    receive(endpointId, devices, unavailable) {
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { devices, unavailable, loaded: true, loading: false, error: null } } });
    },
    fail(endpointId, error) {
        const current = get().byEndpoint[endpointId] ?? EMPTY_DEVICE_LIST;
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...current, loaded: true, loading: false, error } } });
    },
    patch(endpointId, device) {
        const current = get().byEndpoint[endpointId] ?? EMPTY_DEVICE_LIST;
        const devices = current.devices.some((candidate) => sameDevice(candidate, device))
            ? current.devices.map((candidate) => (sameDevice(candidate, device) ? device : candidate))
            : [...current.devices, device];
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...current, devices, error: null } } });
    },
    forget(endpointId) {
        const { [endpointId]: _removed, ...byEndpoint } = get().byEndpoint;
        set({ byEndpoint });
    }
}));

export function sameDevice(left: Pick<DeviceInfo, 'backendId' | 'deviceId'>, right: Pick<DeviceInfo, 'backendId' | 'deviceId'>): boolean {
    return left.backendId === right.backendId && left.deviceId === right.deviceId;
}

export function recordingKey(endpointId: string, device: Pick<DeviceInfo, 'backendId' | 'deviceId'>): string {
    return `${endpointId}|${device.backendId}:${device.deviceId}`;
}

/* When the recording of this device began, or null while none runs. */
export function useRecordingSince(endpointId: string, device: Pick<DeviceInfo, 'backendId' | 'deviceId'>): number | null {
    return useDevices((state) => state.recordings[recordingKey(endpointId, device)] ?? null);
}

export function useDeviceList(endpointId: string): DeviceListState {
    return useDevices((state) => state.byEndpoint[endpointId] ?? EMPTY_DEVICE_LIST);
}

export function useResolvedDevice(endpointId: string, reference: DeviceReference | undefined): DeviceInfo | null {
    return useDevices((state) => (reference ? (state.byEndpoint[endpointId]?.devices.find((device) => deviceMatches(device, reference)) ?? null) : null));
}
