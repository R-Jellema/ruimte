/*
 * Whether this app runs a machine of its own. `ask` is a new install that has not been told yet and
 * runs no machine either.
 */
export type MachineMode = 'local' | 'none' | 'ask';

export interface MachineModeBridge {
    mode: MachineMode;
}
