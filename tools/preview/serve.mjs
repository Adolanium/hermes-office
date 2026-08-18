// Tiny static server for the preview page. No deps.
// Run: node tools/preview/build.mjs && node tools/preview/serve.mjs
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT || 4877)

createServer((req, res) => {
  const name = req.url.split('?')[0].replace(/^\//, '') || 'preview.html'
  try {
    const body = readFileSync(join(dir, name))
    res.writeHead(200, {
      'content-type': name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream',
      'cache-control': 'no-store'
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('nope')
  }
}).listen(port, () => console.log(`preview on http://localhost:${port}/preview.html`))
