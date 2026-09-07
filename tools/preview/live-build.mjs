import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
const dir = fileURLToPath(new URL('.', import.meta.url))
await build({ entryPoints: [dir + 'live.js'], bundle: true, outfile: dir + 'live-bundle.js', format: 'esm', nodePaths: [dir + 'node_modules'], alias: { '@hermes/plugin-sdk': dir + 'live-sdk.js' } })
writeFileSync(dir + 'live.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hermes Office · interactive preview</title><style>
:root{--ui-bg:#fbfaf6;--ui-text-primary:#302d28;--ui-text-secondary:#534e43;--ui-text-tertiary:#746954;--ui-text-quaternary:#928875;--ui-stroke-secondary:#d5cbbb;--ui-accent:#994830;--ui-accent-fg:#fff8ee;color-scheme:light}
html.dark{--ui-bg:#211f1d;--ui-text-primary:#f5eddc;--ui-text-secondary:#d6ccba;--ui-text-tertiary:#b5ab97;--ui-text-quaternary:#928875;--ui-stroke-secondary:#514b40;--ui-accent:#edb888;color-scheme:dark}
html,body{margin:0;height:100%;font:13px system-ui;background:var(--ui-bg);color:var(--ui-text-primary)}#app{height:calc(100% - 30px)}.preview-bar{height:30px;display:flex;align-items:center;gap:12px;padding:0 20px;box-sizing:border-box;font-size:11px}button{font:inherit}.preview-bar button{margin-left:auto}
</style></head><body><div class="preview-bar"><span id="preview-note">Interactive preview · tasks are simulated, no requests leave this page.</span><button id="preview-theme">Light / dark</button></div><div id="app"></div><script type="module" src="live-bundle.js"></script></body></html>`)
console.log('Built live.html from the real plugin components.')
