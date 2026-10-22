import { reactCompilerPlugin } from './react-compiler-transform';

/*
 * A test runs the client and ADE CORE's React sources the way the app ships them: through the React
 * Compiler (`react-compiler.ts`), with the runtime behind the client's own. It goes before every
 * preload that loads a component.
 */

Bun.plugin(reactCompilerPlugin);
