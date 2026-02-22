import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/catalog/index.ts',
    'src/auth/index.ts',
    'src/storage/index.ts',
    'src/plugin/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  outDir: 'dist',
  shims: true,
})
