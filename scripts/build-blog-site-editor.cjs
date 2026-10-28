#!/usr/bin/env node
// Packages Pyr's blog editor (components/BlogEditor.vue) for the blog itself,
// connectome.quest/blog (Ames 2026-10-28). One editor, two places: change the
// editor here, run this, and copy the two files into the site repository:
//   node scripts/build-blog-site-editor.cjs [out-dir]
//   (default out-dir: dist/blog-site) -> blog-editor.js, blog-editor.css
// then put them in seunglabdata/assets/ and push that repository.
const path = require('path');
const esbuild = require('esbuild');
const alias = require('esbuild-plugin-alias');
const vuePlugin = require('esbuild-plugin-vue3');

const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist/blog-site'));
const vue = require.resolve('vue/dist/vue.esm-bundler.js', { paths: [root, path.join(root, '..')] });

esbuild.build({
  entryPoints: { 'blog-editor': path.join(root, 'src/blog_site/editor.ts') },
  outdir: out,
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  sourcemap: false,
  legalComments: 'none',
  define: { __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  plugins: [alias({ vue }), vuePlugin()],
  logLevel: 'info',
}).catch(() => process.exit(1));
