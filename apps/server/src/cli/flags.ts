/* What follows `--name` or `--name=`: null when the flag is not there, empty when it has no value. */
export function flagValue(argv: readonly string[], name: string): string | null {
    const index = argv.findIndex((word) => word === `--${name}` || word.startsWith(`--${name}=`));
    if (index === -1) {
        return null;
    }
    const word = argv[index]!;
    return (word === `--${name}` ? argv[index + 1] : word.slice(`--${name}=`.length)) ?? '';
}

/* Every value of a flag that may come more than once, and the words without it. */
export function takeAll(argv: readonly string[], name: string): { values: string[]; rest: string[] } {
    const values: string[] = [];
    const rest: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const word = argv[i]!;
        if (word === `--${name}`) {
            values.push(argv[i + 1] ?? '');
            i++;
        } else if (word.startsWith(`--${name}=`)) {
            values.push(word.slice(name.length + 3));
        } else {
            rest.push(word);
        }
    }
    return { values, rest };
}

/* How many words at `i` say that `flag` reads stdin: 2 for `--flag -`, 1 for `--flag=-`, 0 otherwise. */
export function stdinWords(argv: readonly string[], i: number, flag: string): number {
    if (argv[i] === `${flag}=-`) {
        return 1;
    }
    return argv[i] === flag && argv[i + 1] === '-' ? 2 : 0;
}
