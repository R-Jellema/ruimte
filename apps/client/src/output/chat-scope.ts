import { createContext, useContext } from 'react';

/* The chat a thread on screen belongs to, for what draws inside it and is handed only a path, such as the image a tool read. */
export const OutputChatContext = createContext<string | null>(null);

/* An artifact a surface already shows beside the thread, whose saved rows then go without a preview under them. */
export const OutputShownBesideContext = createContext<string | null>(null);

export function useOutputChat(): string | null {
    return useContext(OutputChatContext);
}
