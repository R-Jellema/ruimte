import { create } from 'zustand';
import { storedText } from '@/state/stored-json';

const storedScale = storedText('ruimte.browser-stream-scale');
const MAX_STREAM_SCALE = 2;

function normalizedScale(value: number): number {
    return Math.round(Math.min(MAX_STREAM_SCALE, Math.max(1, Number.isFinite(value) ? value : 1)) * 100) / 100;
}

export function browserStreamScaleLimit(): number {
    return normalizedScale(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
}

export function clampBrowserStreamScale(scale: number, limit: number): number {
    return Math.min(normalizedScale(scale), normalizedScale(limit));
}

export function browserStreamScaleOptions(limit: number): number[] {
    const maximum = normalizedScale(limit);
    const options = [1];
    for (let scale = 1.5; scale < maximum; scale += 0.5) {
        options.push(scale);
    }
    if (maximum > 1 && options.at(-1) !== maximum) {
        options.push(maximum);
    }
    return options;
}

function readScale(): number {
    return normalizedScale(Number(storedScale.read() ?? 1));
}

function persistScale(scale: number): void {
    storedScale.write(String(scale));
}

interface BrowserStreamQualityStore {
    scale: number;
    setScale(scale: number): void;
}

export const useBrowserStreamQuality = create<BrowserStreamQualityStore>((set) => ({
    scale: readScale(),
    setScale(scale) {
        const next = normalizedScale(scale);
        persistScale(next);
        set({ scale: next });
    }
}));
