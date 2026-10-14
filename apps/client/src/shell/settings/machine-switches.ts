/*
 * A switch about agents that lives in the machine's own `endpoint.json`, since the daemon is what acts
 * on it and a client-side switch would hold nothing back: what an agent may take away, whether a chat
 * on a limit is taken up again on a clock, and whether an agent may show a page above its reply.
 */
export type MachineSwitch = 'agentsDeleteAnyView' | 'resumeAtReset' | 'visualReplies';

/* The switches in the order the section lists them. */
export const MACHINE_SWITCHES: readonly MachineSwitch[] = ['resumeAtReset', 'visualReplies', 'agentsDeleteAnyView'];
