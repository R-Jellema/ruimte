/*
 * A service made after the one that uses it, handed over once the daemon made it. Using it before
 * then is a wiring mistake, so it throws instead of doing nothing.
 */
export class Binding<T> {
    private readonly what: string;
    private value: T | null = null;

    constructor(what: string) {
        this.what = what;
    }

    bind(value: T): void {
        this.value = value;
    }

    get(): T {
        if (this.value === null) {
            throw new Error(`${this.what} was used before the daemon handed it over`);
        }
        return this.value;
    }
}
