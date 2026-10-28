import {
    BUILT_IN_TEMPLATE_PREFIX,
    POSTFIX_TEMPLATE_LANGUAGES,
    TEMPLATE_LANGUAGES,
    TEMPLATE_LIMITS,
    TEMPLATE_PLACES,
    type LiveTemplateInput,
    type PostfixTemplateInput
} from '@ruimte/contracts';

const WHITESPACE = /\s/u;

const IDENTIFIER_CHARACTERS = /^[\p{L}\p{N}_$]+$/u;

function problemInLanguages(languages: readonly string[], known: readonly string[]): string | null {
    if (languages.length === 0) {
        return 'A template names at least one language';
    }

    const unknown = languages.find((language) => !known.includes(language));

    return unknown === undefined ? null : `${unknown} is not a language a template can name`;
}

function problemInShared(template: LiveTemplateInput | PostfixTemplateInput): string | null {
    if (template.id?.startsWith(BUILT_IN_TEMPLATE_PREFIX) === true) {
        return `An id starting with ${BUILT_IN_TEMPLATE_PREFIX} names a built-in template`;
    }

    if (template.key.length === 0 || template.key.length > TEMPLATE_LIMITS.key) {
        return `A key is 1 to ${TEMPLATE_LIMITS.key} characters`;
    }

    if (template.body.length === 0 || template.body.length > TEMPLATE_LIMITS.body) {
        return `The text of a template is 1 to ${TEMPLATE_LIMITS.body} characters`;
    }

    if (template.description !== undefined && template.description.length > TEMPLATE_LIMITS.description) {
        return `A description is at most ${TEMPLATE_LIMITS.description} characters`;
    }

    return null;
}

/* Why a live template cannot be saved, or null. The key has no whitespace, since it ends where the person typed it. */
export function problemInLiveTemplate(template: LiveTemplateInput): string | null {
    const problem = problemInShared(template);

    if (problem !== null) {
        return problem;
    }

    if (WHITESPACE.test(template.key)) {
        return 'A key has no whitespace';
    }

    const unknownPlace = template.places?.find((place) => !(TEMPLATE_PLACES as readonly string[]).includes(place));

    if (unknownPlace !== undefined) {
        return `${unknownPlace} is not a place a template can apply in`;
    }

    return problemInLanguages(template.languages, TEMPLATE_LANGUAGES);
}

/* A postfix key follows the dot, so it holds identifier characters only. */
export function problemInPostfixTemplate(template: PostfixTemplateInput): string | null {
    const problem = problemInShared(template);

    if (problem !== null) {
        return problem;
    }

    if (!IDENTIFIER_CHARACTERS.test(template.key)) {
        return 'A postfix key holds letters, digits, _ and $ only';
    }

    if (template.example !== undefined && template.example.length > TEMPLATE_LIMITS.example) {
        return `An example is at most ${TEMPLATE_LIMITS.example} characters`;
    }

    return problemInLanguages(template.languages, POSTFIX_TEMPLATE_LANGUAGES);
}
