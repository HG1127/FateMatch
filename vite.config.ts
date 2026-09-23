// Bake 的 vite.config.ts (0.0.7+ runtime). 已经 inline 了 rh-visual-edit 的
// rhSourcePlugin —— 模型不需要再调 rh-visual-edit skill 装它.
//
// ⚠️ 整体 Write 覆盖本文件是禁忌. 改时用 Read + Edit 局部改:
//   - 加 alias / 改 server 配置: 修对应字段
//   - 加别的 plugin: 在 plugins 数组里追加, 但 rhSourcePlugin() 必须在第 0 位 (enforce: 'pre' 保证它在 react/oxc 之前跑)
//   - 不要删 rhSourcePlugin 那段函数定义, 也不要删 @babel/parser / @babel/traverse / magic-string 这三个 import
import path from 'node:path'
import fs from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { parse as babelParse } from '@babel/parser'
import _traverse from '@babel/traverse'
import MagicString from 'magic-string'

// @babel/traverse 在不同 bundler 下 ESM/CJS interop 形态不一致, 兜底取 default.
const traverse = ((_traverse as any).default ?? _traverse) as typeof _traverse

// rh-visual-edit: 独立 Vite plugin, 给每个 JSX 元素加 data-rh-src="<rel>:<line>:<col>".
// 不依赖 @vitejs/plugin-react 的 babel hook (plugin-react v6+ 已切到 oxc, 不再接受 babel 选项).
function rhSourcePlugin() {
  return {
    name: 'rh-source',
    enforce: 'pre' as const,
    apply: 'serve' as const,
    transform(code: string, id: string) {
      const cleanId = id.split('?')[0]
      if (!/\.(jsx|tsx)$/.test(cleanId)) return null
      if (cleanId.includes('/node_modules/')) return null
      let ast: any
      try {
        ast = babelParse(code, {
          sourceType: 'module',
          allowReturnOutsideFunction: true,
          plugins: ['jsx', 'typescript'],
        })
      } catch {
        return null
      }
      const cwd = process.cwd()
      const rel = cleanId.startsWith(cwd + '/') ? cleanId.slice(cwd.length + 1) : cleanId
      const filename = rel.replace(/\\/g, '/')
      const ms = new MagicString(code)
      traverse(ast, {
        JSXOpeningElement(p: any) {
          const node = p.node
          const loc = node.loc
          if (!loc) return
          const exists = node.attributes.some(
            (a: any) => a.type === 'JSXAttribute' && a.name && a.name.name === 'data-rh-src',
          )
          if (exists) return
          const nameNode = node.name
          if (!nameNode || nameNode.end == null) return
          // TSX 里 <Foo<T> /> 合法; 必须插在 typeArguments 之后, 否则会变成
          // <Foo data-rh-src="..."<T> /> 导致 oxc/babel 解析失败.
          const insertEnd =
            (node.typeArguments && node.typeArguments.end) ??
            (node.typeParameters && node.typeParameters.end) ??
            nameNode.end
          ms.appendRight(
            insertEnd,
            ` data-rh-src="${filename}:${loc.start.line}:${loc.start.column}"`,
          )
        },
      })
      if (!ms.hasChanged()) return null
      return {
        code: ms.toString(),
        map: ms.generateMap({ hires: true, source: id }),
      }
    },
  }
}

// 预览页白屏排查: 前端把运行时错误打到 /__err, 落到 logs/client-errors.log
function errLogPlugin() {
  return {
    name: 'err-log',
    configureServer(server: any) {
      server.middlewares.use('/__err', (req: any, res: any) => {
        try {
          const m = decodeURIComponent((req.url || '').replace(/^\?m=/, '').replace(/^\//, ''))
          fs.appendFileSync(path.resolve(__dirname, 'logs/client-errors.log'), `${new Date().toISOString()} ${m}\n`)
        } catch {
          /* ignore */
        }
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.end('ok')
      })
    },
  }
}

export default defineConfig({
  // 预览可能挂在任意路径前缀下, 资源一律走相对路径
  base: './',
  plugins: [rhSourcePlugin(), errLogPlugin(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    allowedHosts: ['.runninghub.cn', '.vibex.cn'],
    host: '0.0.0.0',
    port: 8000,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 8000,
  },
  // vitest: e2e/ 是 Playwright 发布冒烟的地盘(由 pnpm e2e 单独跑), 单测只扫 src
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
})
