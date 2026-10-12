import { useEffect } from 'react';
import { RENDERED_DOC_COMMENTS } from '@/features';
import type { EditorLanguage } from '@/language/ruimte-editor-language';
import { useSettings } from '@/state/settings';

export function docCommentsRendered(setting: boolean, feature: boolean = RENDERED_DOC_COMMENTS): boolean {
    return feature && setting;
}

export function renderedDocsSettings(setting: boolean, feature: boolean = RENDERED_DOC_COMMENTS): { readonly renderDocComments: boolean, readonly enabled: boolean } {
    return { renderDocComments: docCommentsRendered(setting, feature), enabled: feature };
}

/* Hands the editor whether documentation comments are drawn formatted, as the settings say while the feature is on. */
export function useRenderedDocs(language: EditorLanguage | null): void {
    const setting = useSettings((s) => s.codeRenderDocs);
    const renderDocComments = docCommentsRendered(setting);

    useEffect(() => {
        language?.renderedDocs.configure(renderedDocsSettings(renderDocComments));
    }, [language, renderDocComments]);
}
