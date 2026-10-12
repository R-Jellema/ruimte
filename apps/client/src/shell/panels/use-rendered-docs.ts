import { useEffect } from 'react';
import type { EditorLanguage } from '@/language/ruimte-editor-language';
import { useSettings } from '@/state/settings';

/* Hands the editor whether documentation comments are drawn formatted, as the settings say. */
export function useRenderedDocs(language: EditorLanguage | null): void {
    const renderDocComments = useSettings((s) => s.codeRenderDocs);

    useEffect(() => {
        language?.renderedDocs.configure({ renderDocComments });
    }, [language, renderDocComments]);
}
