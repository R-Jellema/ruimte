// Tests execute the imported handlers in Bun without replacing Bun's fetch globals.
declare global {
    type HeadersInit = Bun.HeadersInit;
    type BodyInit = Bun.BodyInit;
}
export {};
