import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  resolve: {
    // 2026-08-27: pnpm 的 peer 解析给 @uiw/react-codemirror 生成了 3 个实例,
    // 其中一个内嵌 @codemirror/state@6.7.0, 而顶层/其余实例是 6.7.1 —
    // Extension instanceof 跨实例失效, "Unrecognized extension value" 白屏
    // (保存接口用例后 navigate 重挂编辑器即复现)。optimizeDeps.include 只能
    // 合并预打包图, 治不了版本分叉; resolve.dedupe 把所有嵌套引用强制解析到
    // 顶层同一份, dev/build 双侧生效。
    dedupe: [
      '@uiw/react-codemirror',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/autocomplete',
      '@codemirror/search',
      '@codemirror/lint',
      '@codemirror/lang-json',
      '@codemirror/lang-javascript',
      '@codemirror/lang-xml',
      '@codemirror/theme-one-dark',
    ],
  },
  optimizeDeps: {
    // 2026-08-24: CodeMirror 在 dev 模式报 "multiple instances of
    // @codemirror/state" - 源码直接 import 的 @codemirror/* 与
    // @uiw/react-codemirror 预打包内嵌的副本被拆成两个 chunk,
    // Extension 的 instanceof 检查跨实例失效 -> EditorState.create 崩溃,
    // React 树卸载后整页空白。显式 include 让 Vite 把这组包预打包进
    // 同一个共享依赖图, 保证单实例。
    include: [
      '@uiw/react-codemirror',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/autocomplete',
      '@codemirror/search',
      '@codemirror/lint',
      '@codemirror/lang-json',
      '@codemirror/lang-javascript',
      '@codemirror/lang-xml',
      '@codemirror/theme-one-dark',
    ],
  },
  server: {
    watch: {
      // Midscene writes intermediate report output to <cwd>/midscene_run/
      // and report screenshots to data/midscene-reports/ on every case.
      // Without this ignore list, Vite picks up the writes and forces the
      // dev page to reload mid-execution, which is harmless for the case
      // itself but pollutes the log with [vite] page reload noise. We
      // also exclude the vite.config.ts.timestamp-*.mjs files that Vite
      // creates internally — tsx watch restarts on those otherwise.
      ignored: [
        '**/midscene_run/**',
        '**/midscene-reports/**',
        '**/vite.config.ts.timestamp-*.mjs',
      ],
    },
  },
});
