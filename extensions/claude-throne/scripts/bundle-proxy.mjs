import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { build } from 'esbuild'
import { existsSync, mkdirSync } from 'fs'

async function main() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

  const extDir = resolve(__dirname, '..')
  const repoRoot = resolve(extDir, '..', '..')
  const entry = resolve(repoRoot, 'index.js')
  const outdir = resolve(extDir, 'bundled', 'proxy')
  if (!existsSync(outdir)) mkdirSync(outdir, { recursive: true })

  console.log(`[bundle-proxy] bundling ${entry} -> ${outdir}/index.cjs`)

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: ['node18'],
    format: 'cjs',
    outfile: resolve(outdir, 'index.cjs'),
    sourcemap: false,
    logLevel: 'info',
  })

  console.log('[bundle-proxy] done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

