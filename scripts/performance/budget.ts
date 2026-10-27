/* Fails a benchmark whose median passes the budget in `variable`; with no budget set, it only measures. */
export function assertMedianWithin(samples: number[], variable: string, failure: string): void {
    const median = samples.toSorted((left, right) => left - right)[Math.floor(samples.length / 2)]!;
    if (median > Number(process.env[variable] ?? Infinity)) {
        throw new Error(failure);
    }
}
