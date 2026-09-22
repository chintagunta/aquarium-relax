/**
 * Lets `node --experimental-strip-types` run the test suite directly, with no
 * bundler and no test framework.
 *
 * The app's source uses extensionless relative imports because that is what
 * Vite wants; Node's ESM resolver requires a real filename. Rather than litter
 * the source with `.ts` extensions just to satisfy the test runner, this hook
 * resolves an extensionless relative specifier to the `.ts` file beside it.
 *
 * Usage: node --experimental-strip-types --import ./src/test-setup.mjs <file>
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!specifier.startsWith('.') || !context.parentURL) throw err;
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        const candidate = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
      throw err;
    }
  },
});
