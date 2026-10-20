import { z } from 'zod';

/* Whether this machine holds a NanoGPT subscription key, and how many included models it offers. Never the key. */
export const NanoGptStatusSchema = z.object({
    configured: z.boolean(),
    models: z.number().int().nonnegative()
});
export type NanoGptStatus = z.infer<typeof NanoGptStatusSchema>;

export const NanoGptConfigurePayloadSchema = z.object({
    // An empty key disconnects; leaving it out fetches the included models again with the saved key.
    apiKey: z.string().trim().max(4096).optional()
});
export type NanoGptConfigurePayload = z.infer<typeof NanoGptConfigurePayloadSchema>;
