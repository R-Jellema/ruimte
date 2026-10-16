import { expect, test } from 'bun:test';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { mount } from '../../testing/dom';

test('a picked project symbol uses the project color everywhere by default', async () => {
    const page = mount();
    try {
        await page.render(<ProjectGlyph projectId="atlas" icon={{ kind: 'lucide', value: 'rocket' }} color="#e7000b" />);
        expect(page.host.querySelector('svg')?.parentElement?.style.color).toBe('#e7000b');
    } finally {
        await page.unmount();
    }
});
