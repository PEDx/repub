import html from '@rollup/plugin-html';
import typescript from '@rollup/plugin-typescript';
import serve from 'rollup-plugin-serve';
export default {
  input: './src/index.ts',
  plugins: [
    typescript(),
    html({
      title: 'rEPUB',
    }),
    serve({
      port: 3000,
      contentBase: './dist',
    }),
  ],
  output: {
    file: './dist/index.js',
    format: 'esm',
  },
};
