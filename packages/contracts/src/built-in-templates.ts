/*
 * The id, key and languages of the templates that ship with the editor. The daemon cannot load the editor,
 * and an agent's new key must not shadow one of these, so it keeps this list; a test in the client holds it
 * against `BUILT_IN_LIVE_TEMPLATES` and `BUILT_IN_POSTFIX_TEMPLATES` of ADE CORE.
 */
export interface BuiltInTemplateKey {
    readonly id: string;
    readonly key: string;
    readonly languages: readonly string[];
}

function builtIn(id: string, key: string, languages: readonly string[]): BuiltInTemplateKey {
    return { id, key, languages };
}

const SCRIPT = ['javascript', 'typescript'];

export const BUILT_IN_LIVE_TEMPLATE_KEYS: readonly BuiltInTemplateKey[] = [
    builtIn('builtin.javascript.log', 'log', ['javascript']),
    builtIn('builtin.javascript.itar', 'itar', ['javascript']),
    builtIn('builtin.javascript.ritar', 'ritar', ['javascript']),
    builtIn('builtin.javascript.iter', 'iter', ['javascript']),
    builtIn('builtin.javascript.itin', 'itin', ['javascript']),
    builtIn('builtin.php.fore', 'fore', ['php']),
    builtIn('builtin.php.forek', 'forek', ['php']),
    builtIn('builtin.php.pubf', 'pubf', ['php']),
    builtIn('builtin.php.prif', 'prif', ['php']),
    builtIn('builtin.php.prof', 'prof', ['php']),
    builtIn('builtin.php.pubsf', 'pubsf', ['php']),
    builtIn('builtin.php.thr', 'thr', ['php']),
    builtIn('builtin.html.T', 'T', ['html', 'xml']),
    builtIn('builtin.xml.CD', 'CD', ['xml'])
];

export const BUILT_IN_POSTFIX_TEMPLATE_KEYS: readonly BuiltInTemplateKey[] = [
    ...['if', 'else', 'null', 'notnull', 'return', 'throw', 'const', 'let', 'forof', 'forin', 'log', 'not', 'par', 'arg', 'await', 'typeof'].map((key) =>
        builtIn(`builtin.postfix.javascript.${key}`, key, SCRIPT)
    ),
    ...['if', 'isset', 'empty', 'null', 'notnull', 'return', 'throw', 'var', 'foreach', 'not', 'par'].map((key) =>
        builtIn(`builtin.postfix.php.${key}`, key, ['php'])
    )
];
