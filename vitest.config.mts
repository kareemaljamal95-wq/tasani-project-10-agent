import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The suite exercises real Prisma against a real database rather than
    // mocking it: the behaviour under test here is ownership scoping and
    // state-machine enforcement, and a mocked client would happily confirm
    // whatever the mock was told to return.
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
