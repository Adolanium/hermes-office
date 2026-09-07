// Compatibility entry point. The preview now renders the actual React plugin.
import './live-build.mjs'
import { copyFileSync } from 'node:fs'
copyFileSync(new URL('live.html', import.meta.url), new URL('preview.html', import.meta.url))
