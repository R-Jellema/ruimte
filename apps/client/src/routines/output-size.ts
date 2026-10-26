import { z } from 'zod';
import { storedJson } from '@/state/stored-json';

export interface CardSize {
    w: number;
    h: number;
}

export const OUTPUT_MIN: CardSize = { w: 280, h: 200 };

const CardSizeSchema = z.object({ w: z.number().min(OUTPUT_MIN.w), h: z.number().min(OUTPUT_MIN.h) });

/* The size a person gave the Output card beside a routine node: this client's, per view and node, never in the project. */
export function storedOutputSize(viewId: string, nodeId: string) {
    return storedJson<CardSize>(`ruimte.routineOutput.${viewId}.${nodeId}`, CardSizeSchema);
}
