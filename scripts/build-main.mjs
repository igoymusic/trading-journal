// Bundles the Electron main and preload scripts into dist/main.
import { build } from 'esbuild';

await build({
  entryPoints: { main: 'src/main/main.ts', preload: 'src/main/preload.ts' },
  outdir: 'dist/main',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  logLevel: 'warning',
});
