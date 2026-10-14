import { expect, test } from 'bun:test';
import { compileUiBlock } from '@adecore/intelligent-ui';
import { evaluateNativeUi, nativeUiJson } from './native-ui';

test('the native bridge refuses deeply nested wire data before schema recursion', () => {
    let value: unknown = {};
    for (let i = 0; i < 200; i++) {
        value = { child: value };
    }
    expect(() => evaluateNativeUi({ block: value })).toThrow('structure budget');
    expect(() => nativeUiJson(' '.repeat(1024 * 1024 + 1))).toThrow('too large');
});

test('the native bridge keeps a good sibling when another node has an unsupported expression', () => {
    const block = compileUiBlock('<Summary>Kept</Summary><Summary>{1}</Summary>', { id: 'a', final: true, now: () => 0 });
    expect(block.diagnostics).toEqual([]);
    block.nodes[1].children[0].expressions.text = { kind: 'future' } as never;
    const result = evaluateNativeUi({ block });
    const nodes = result.nodes as { children: { props: { text?: string }; error?: string }[] }[];
    expect(nodes[0].children[0].props.text).toBe('Kept');
    expect(nodes[1].children[0].error).toBeDefined();
    expect(result.diagnostics).toHaveLength(1);
});

test('the native bridge keeps the compiled fallback of a component beside a known one', () => {
    const source = '<Summary>Kept</Summary><FutureWidget>Future fallback</FutureWidget>';
    const block = compileUiBlock(source, { id: 'a', final: true, now: () => 0 });
    const result = evaluateNativeUi({ block });
    const nodes = result.nodes as { type: string; fallback: string; error?: string }[];
    expect(nodes.map((node) => node.type)).toEqual(['Summary', 'FutureWidget']);
    expect(nodes[0].error).toBeUndefined();
    expect(nodes[1].error).toBe('unknown_component');
    expect(nodes[1].fallback).toBe(block.nodes[1].fallback);
    expect(nodes[1].fallback).toContain('Future fallback');
});
