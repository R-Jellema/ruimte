import { afterEach, expect, test } from 'bun:test';
import { EMPTY_TOTALS, UsageProviderSchema } from '@ruimte/contracts';
import { UsageSummary } from '@adecore/agents-react/usage';
import { mount, type Mounted } from '../../testing/dom';

let page: Mounted | undefined;
afterEach(async () => {
    await page?.unmount();
    page = undefined;
});

test('Claude API usage has a named row, an Anthropic mark and its own chart color', async () => {
    const provider = UsageProviderSchema.parse('anthropic-claude-api');
    const totals = { ...EMPTY_TOTALS, calls: 1, input: 120, cacheRead: 9000, cacheWrite: 400, output: 250 };
    page = mount();
    await page.render(<UsageSummary metric="tokens" totals={totals} costUsd={0.25} sessions={1} providers={[{ provider, costUsd: 0.25, totals }]} />);

    expect(page.host.textContent).toContain('Claude API');
    const mark = page.host.querySelector('svg path');
    expect(mark?.getAttribute('d')?.length).toBeGreaterThan(100);
    expect(mark?.parentElement?.parentElement?.getAttribute('style')).toContain('--chart-claude-api');
});
