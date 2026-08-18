// Builds a static preview page of the office room from the real plugin.js CSS,
// skins, and hop math, so the floor can be eyeballed in a browser without
// Hermes Desktop. Run: node tools/preview/build.mjs && node tools/preview/serve.mjs
// then open http://localhost:4877. Fake desks, one thinking bot, one away, a
// walker at the bar, game chairs, hopscotch, per skin ambience. Buttons at the
// bottom right toggle theme, night, and more desks. window.hopDemo() runs a hop.
import { readFileSync, writeFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../plugin.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const skinStart = source.indexOf('const WALL_H = ')
const skinEnd = source.indexOf("const BOT_CHAT_TITLE = 'Bot Chat'")
const cssStart = source.indexOf('  const css = `', source.indexOf('function injectOfficeCss'))
const cssEnd = source.indexOf('`\n  let style', cssStart)
if (skinStart < 0 || skinEnd < 0 || cssStart < 0 || cssEnd < 0) throw new Error('markers missing')

const ctx = {}
vm.runInNewContext(`${source.slice(skinStart, skinEnd)}\n${source.slice(cssStart, cssEnd)}\`;\nglobalThis.__css = css;`, ctx)
const css = ctx.__css
const fnSlice = (a, b) => source.slice(source.indexOf(a), source.indexOf(b))
const HOPFN = fnSlice('function easeInOut', 'function roamMs') + fnSlice('function walkHop', 'function roamBox') + fnSlice('function hopCourse', 'function chairCountForGame')

const face = (color, mood = 'idle') => `<svg viewBox="0 0 40 44" width="42" height="42" class="office-face office-face-${mood}"><rect x="3" y="3" width="34" height="34" rx="11" fill="${color}"/><ellipse cx="15" cy="17" rx="2.4" ry="2.4" fill="rgba(0,0,0,.82)"/><ellipse cx="25" cy="17" rx="2.4" ry="2.4" fill="rgba(0,0,0,.82)"/></svg>`

const desk = ({ name, color, think, away, say, night }) => `
<div class="office-desk ${think ? 'is-think' : ''} ${away ? 'has-wander' : ''}" data-desk="${name}">
  <div class="office-stage">
    <div class="office-desk-top"></div>${say && !think ? '<button type="button" class="office-memo"><svg viewBox="0 0 22 18" width="22" height="18"><path d="M1 3 L11 10 L21 3 V16 H1 Z" fill="#fff8e6" stroke="#8a7a5a" stroke-width="1"/><path d="M1 3 H21 L11 10 Z" fill="#f4e9c8" stroke="#8a7a5a" stroke-width="1"/></svg></button>' : ''}${think ? '<div class="office-confetti">' + [0,1,2,3,4,5,6].map(i => '<i style="--i:' + i + '"></i>').join('') + '</div>' : ''}
    ${night ? '<div class="office-lamp" aria-hidden="true"><div class="office-lamp-shade"></div><div class="office-lamp-stem"></div><div class="office-lamp-base"></div></div>' : ''}
    <div class="office-monitor"><div class="office-monitor-head"><div class="office-screen ${think ? 'is-on' : ''}"><div class="office-screen-copy">${say || ''}</div></div><div class="office-monitor-cam"></div></div><div class="office-monitor-neck"></div><div class="office-monitor-base"></div></div>
    <div class="office-seat"><svg viewBox="0 0 42 46" width="42" height="46" class="office-desk-chair "><rect x="8" y="1" width="26" height="22" rx="7" fill="#3b3b43"/><rect x="11" y="4" width="20" height="16" rx="5" fill="#4c4c56"/><rect x="4" y="22" width="34" height="10" rx="4" fill="#454550"/><rect x="4" y="22" width="34" height="3" rx="1.5" fill="rgba(255,255,255,.14)"/><rect x="19.5" y="32" width="3" height="7" rx="1" fill="#8a8a94"/><path d="M21 39 L7 44 M21 39 L35 44 M21 39 L21 45" stroke="#8a8a94" stroke-width="2.4" stroke-linecap="round"/><circle cx="7" cy="44.5" r="1.6" fill="#26262c"/><circle cx="35" cy="44.5" r="1.6" fill="#26262c"/><circle cx="21" cy="45" r="1.6" fill="#26262c"/></svg>${away ? '' : `<div class="office-person is-${think ? 'think' : 'idle'}">${face(color, think ? 'think' : 'idle')}<span class="office-status ${think ? '' : 'is-idle'}">${think ? 'thinking' : 'here'}</span></div>`}</div>
  </div>
  <button type="button" class="office-plate"><div class="office-name">${name}</div><div class="office-handle">@${name.toLowerCase()}<span class="office-stars">\u2605 3</span></div></button>
  ${say ? `<button type="button" class="office-say">${say}</button>` : ''}
</div>`

const html = `<!doctype html>
<meta charset="utf-8">
<title>office preview</title>
<style>
:root { --ui-bg:#fff; --ui-text-primary:#111; --ui-text-secondary:#333; --ui-text-tertiary:#666; --ui-text-quaternary:#999; --ui-stroke-secondary:#ddd; --ui-stroke-primary:#ccc; --ui-accent:#4f7cff; --ui-accent-fg:#fff; color-scheme:light; }
html.dark { --ui-bg:#151517; --ui-text-primary:#eee; --ui-text-secondary:#ccc; --ui-text-tertiary:#999; --ui-text-quaternary:#666; --ui-stroke-secondary:#333; --ui-stroke-primary:#444; color-scheme:dark; }
html, body { margin:0; height:100%; font:13px system-ui, sans-serif; background:var(--ui-bg); color:var(--ui-text-primary); }
#app { height:100vh; }
.bar { position:fixed; right:8px; bottom:6px; display:flex; gap:6px; z-index:99; }
.bar button { font:inherit; font-size:11px; }
${css}
</style>
<div id="app">
<div class="office-root is-carpet" id="root">
  <header class="office-header">
    <div><div class="office-kicker">Office</div><h1 class="office-title">The Office</h1></div>
    <div class="office-head-right"><div class="office-tools"><button type="button" class="office-tool" id="skin">carpet</button><button type="button" class="office-tool">chairs</button></div><button type="button" class="office-news">Hermes has news</button><button type="button" class="office-count is-link"><span class="office-pulse is-live"></span>Scout thinking</button></div>
  </header>
  <div class="office-stage-wrap"><div class="office-room is-carpet" id="room">
    <div class="office-wall" aria-hidden="true"></div>
    <div class="office-plant is-lean" aria-hidden="true"></div><div id="amb"></div><div class="office-eom" title="Employee of the month"><div class="office-eom-frame"><svg viewBox="0 0 40 44" width="30" height="30" class="office-face"><rect x="3" y="3" width="34" height="34" rx="11" fill="#f0a040"/><ellipse cx="15" cy="17" rx="2.4" ry="2.4" fill="rgba(0,0,0,.82)"/><ellipse cx="25" cy="17" rx="2.4" ry="2.4" fill="rgba(0,0,0,.82)"/></svg></div><div class="office-eom-plate">employee of the month</div><div class="office-eom-name">Arke</div></div>
    <div class="office-hint is-task" role="note"><div class="office-hint-copy"><b>Give Hermes something small.</b> Type it in the bar below and press Send. Watch the desk.</div><button type="button" class="office-hint-close">×</button></div>
    <div class="office-hint" role="note" style="display:none"><div class="office-hint-copy"><b>Try petting Hermes.</b> Hover to startle, tap to pet, hold to send to sleep, drag to move. Tap a hop square, press chairs, cycle the room from the header, and give someone a task from the bar below.</div><button type="button" class="office-hint-close">×</button></div><div class="office-tally office-chip">12 done</div>
    <button type="button" class="office-clock is-digital"><div class="office-clock-lcd">06:56</div></button>
    <div class="office-floor">
      <div class="office-work"><div class="office-grid" id="grid"></div></div>
      <div class="office-aisle">
        <div class="office-hop-label">hop</div>
        <div class="office-hop-row"><button class="office-hop" data-hop="1">1</button></div>
        <div class="office-hop-row"><button class="office-hop" data-hop="2">2</button></div>
        <div class="office-hop-row"><button class="office-hop" data-hop="3">3</button><button class="office-hop" data-hop="4">4</button></div>
        <div class="office-hop-row"><button class="office-hop" data-hop="5">5</button></div>
        <div class="office-hop-row"><button class="office-hop" data-hop="6">6</button><button class="office-hop" data-hop="7">7</button></div>
        <div class="office-hop-row"><button class="office-hop" data-hop="8">8</button></div>
      </div>
      <aside class="office-bar">
        <div class="office-bar-sign">Bar</div>
        <div class="office-bar-shelf" id="shelf"></div>
        <div class="office-bar-counter" id="counter"></div>
        <div class="office-bar-stools"><div class="office-bar-stool"></div><div class="office-bar-stool"></div><div class="office-bar-stool"></div><div class="office-bar-stool"></div></div>
      </aside>
    </div>
    <div class="office-game-layer"><span class="office-note" style="left:440px;top:250px;--d:0s">\u266b</span><span class="office-note" style="left:470px;top:236px;--d:.45s">\u266a</span><span class="office-note" style="left:455px;top:222px;--d:.9s">\u266b</span><svg viewBox="0 0 30 36" width="30" height="36" class="office-game-chair" style="left:430px;top:300px"><rect x="6" y="1" width="18" height="14" rx="3" fill="#a26b3f"/><rect x="8" y="5" width="14" height="2" rx="1" fill="rgba(0,0,0,.18)"/><rect x="8" y="9" width="14" height="2" rx="1" fill="rgba(0,0,0,.18)"/><rect x="3" y="15" width="24" height="7" rx="2" fill="#b87b4a"/><rect x="3" y="15" width="24" height="2" rx="1" fill="rgba(255,255,255,.28)"/><rect x="5" y="22" width="3" height="13" rx="1" fill="#6b4425"/><rect x="22" y="22" width="3" height="13" rx="1" fill="#6b4425"/><rect x="8" y="27" width="14" height="2" rx="1" fill="#6b4425"/></svg><svg viewBox="0 0 30 36" width="30" height="36" class="office-game-chair" style="left:474px;top:300px"><rect x="6" y="1" width="18" height="14" rx="3" fill="#a26b3f"/><rect x="8" y="5" width="14" height="2" rx="1" fill="rgba(0,0,0,.18)"/><rect x="8" y="9" width="14" height="2" rx="1" fill="rgba(0,0,0,.18)"/><rect x="3" y="15" width="24" height="7" rx="2" fill="#b87b4a"/><rect x="3" y="15" width="24" height="2" rx="1" fill="rgba(255,255,255,.28)"/><rect x="5" y="22" width="3" height="13" rx="1" fill="#6b4425"/><rect x="22" y="22" width="3" height="13" rx="1" fill="#6b4425"/><rect x="8" y="27" width="14" height="2" rx="1" fill="#6b4425"/></svg></div>
    <div class="office-wander-layer">
      <div class="office-person is-wander is-idle" id="w1" style="left:calc(100% - 118px); top:200px; --lift:0"><span class="office-ground"></span>${face('#f0a040')}<span class="office-status">at the bar</span></div>
      <div class="office-person is-wander is-idle" id="w2" style="left:calc(100% - 70px); top:210px; --lift:.8"><span class="office-ground"></span>${face('#3ac0a0')}<span class="office-status">exploring</span></div>
    </div>
  </div>
  </div>
  <div class="office-taskbar"><div class="office-task-who">Task for <span class="office-pick"><button class="office-pick-btn">Arke</button></span></div><input class="office-task-input" placeholder="Tell Arke…"><button class="office-task-send">Send</button></div>
</div>
</div>
<div class="bar">
  <button id="theme">theme</button><button id="night">night</button><button id="more">more desks</button>
</div>
<script>
const skins = ['carpet','loft','garden','nightclub','pizza']
const root = document.getElementById('root'), room = document.getElementById('room'), grid = document.getElementById('grid')
const desks = [
  ${JSON.stringify(desk({ name: 'Hermes', color: '#a26bff', say: 'Good news, Adolan: nothing is ruined. I traced this end to end and the config is fine.' }))},
  ${JSON.stringify(desk({ name: 'Arke', color: '#f0a040', away: true }))},
  ${JSON.stringify(desk({ name: 'Scout', color: '#3ac0a0', think: true, say: 'reading tests…' }))}
]
const nightDesks = [
  ${JSON.stringify(desk({ name: 'Hermes', color: '#a26bff', night: true, say: 'Good news, Adolan: nothing is ruined. I traced this end to end and the config is fine.' }))},
  ${JSON.stringify(desk({ name: 'Arke', color: '#f0a040', away: true, night: true }))},
  ${JSON.stringify(desk({ name: 'Scout', color: '#3ac0a0', think: true, night: true, say: 'reading tests…' }))}
]
let more = false
function render() {
  const night = root.classList.contains('is-night')
  const list = night ? nightDesks : desks
  grid.innerHTML = (more ? list.concat(list, list) : list).join('')
}
render()
const PIE = '<svg viewBox="0 0 40 40" width="34" height="34" class="office-pie is-eaten"><circle cx="20" cy="20" r="19.5" fill="#4a4a4e"/><circle cx="20" cy="20" r="18" fill="#c9702c"/><circle cx="20" cy="20" r="15" fill="#f2b53a"/><g fill="#c9302c"><circle cx="13" cy="14" r="2.4"/><circle cx="25" cy="12" r="2.4"/><circle cx="28" cy="23" r="2.4"/><circle cx="18" cy="26" r="2.4"/><circle cx="10" cy="24" r="2.2"/><circle cx="21" cy="19" r="2"/></g><g fill="#4f8f38"><ellipse cx="16" cy="20" rx="2" ry="1.2" transform="rotate(-30 16 20)"/><ellipse cx="25" cy="28" rx="2" ry="1.2" transform="rotate(20 25 28)"/></g><path d="M20 20 L20 1.5 A18.5 18.5 0 0 1 36.7 11.2 Z" fill="#4a4a4e"/></svg>'
const SLICE = '<svg viewBox="0 0 20 20" width="18" height="18" class="office-slice"><path d="M2 3 L18 3 L10 19 Z" fill="#f2b53a"/><path d="M2 3 L18 3 L16.6 6 L3.4 6 Z" fill="#c9702c"/><circle cx="8" cy="9" r="1.6" fill="#c9302c"/><circle cx="12.5" cy="10.5" r="1.5" fill="#c9302c"/><circle cx="10" cy="14" r="1.3" fill="#c9302c"/></svg>'
const AMBIENCE = {"garden":"<svg class=\\"office-butterfly is-a\\" viewBox=\\"0 0 20 14\\" width=\\"20\\" height=\\"14\\"><g><ellipse class=\\"office-wing\\" cx=\\"6\\" cy=\\"7\\" rx=\\"6\\" ry=\\"5\\" fill=\\"#f6a5c0\\"/><ellipse class=\\"office-wing is-r\\" cx=\\"14\\" cy=\\"7\\" rx=\\"6\\" ry=\\"5\\" fill=\\"#f6a5c0\\"/><rect x=\\"9\\" y=\\"2\\" width=\\"2\\" height=\\"10\\" rx=\\"1\\" fill=\\"#4a3a3a\\"/></g></svg><svg class=\\"office-butterfly is-b\\" viewBox=\\"0 0 20 14\\" width=\\"16\\" height=\\"11\\"><g><ellipse class=\\"office-wing\\" cx=\\"6\\" cy=\\"7\\" rx=\\"6\\" ry=\\"5\\" fill=\\"#8fd0ff\\"/><ellipse class=\\"office-wing is-r\\" cx=\\"14\\" cy=\\"7\\" rx=\\"6\\" ry=\\"5\\" fill=\\"#8fd0ff\\"/><rect x=\\"9\\" y=\\"2\\" width=\\"2\\" height=\\"10\\" rx=\\"1\\" fill=\\"#4a3a3a\\"/></g></svg><svg class=\\"office-sun\\" viewBox=\\"0 0 20 20\\" width=\\"22\\" height=\\"22\\" style=\\"left:calc(8% + 42%);top:14px\\"><circle cx=\\"10\\" cy=\\"10\\" r=\\"8\\" fill=\\"#ffd44d\\"/></svg>","nightclub":"<div class=\\"office-sweep\\"></div>","pizza":"<svg class=\\"office-oven\\" viewBox=\\"0 0 44 50\\" width=\\"44\\" height=\\"50\\"><rect x=\\"2\\" y=\\"8\\" width=\\"40\\" height=\\"42\\" rx=\\"4\\" fill=\\"#8a5a3a\\"/><rect x=\\"2\\" y=\\"8\\" width=\\"40\\" height=\\"6\\" rx=\\"3\\" fill=\\"#a87048\\"/><rect x=\\"14\\" y=\\"2\\" width=\\"16\\" height=\\"8\\" rx=\\"2\\" fill=\\"#5a3a26\\"/><path d=\\"M8 42 V30 A14 12 0 0 1 36 30 V42 Z\\" fill=\\"#2a1810\\"/><path class=\\"office-oven-fire\\" d=\\"M12 42 V32 A10 9 0 0 1 32 32 V42 Z\\" fill=\\"#ff8a2a\\"/><rect x=\\"6\\" y=\\"42\\" width=\\"32\\" height=\\"4\\" rx=\\"1\\" fill=\\"#5a3a26\\"/></svg>","carpet":"<svg class=\\"office-cooler\\" viewBox=\\"0 0 22 52\\" width=\\"22\\" height=\\"52\\"><rect x=\\"4\\" y=\\"20\\" width=\\"14\\" height=\\"30\\" rx=\\"2\\" fill=\\"#e9ecf0\\"/><rect x=\\"4\\" y=\\"20\\" width=\\"14\\" height=\\"4\\" fill=\\"#c9d0da\\"/><rect x=\\"8\\" y=\\"30\\" width=\\"6\\" height=\\"4\\" rx=\\"1\\" fill=\\"#4f7cff\\"/><rect x=\\"5\\" y=\\"2\\" width=\\"12\\" height=\\"19\\" rx=\\"4\\" fill=\\"#a9d8f2\\" opacity=\\"0.9\\"/><circle class=\\"office-bubble\\" cx=\\"9\\" cy=\\"16\\" r=\\"1.3\\" fill=\\"#fff\\"/><circle class=\\"office-bubble is-2\\" cx=\\"13\\" cy=\\"18\\" r=\\"1\\" fill=\\"#fff\\"/></svg><svg class=\\"office-window\\" viewBox=\\"0 0 44 40\\" width=\\"44\\" height=\\"40\\"><rect x=\\"2\\" y=\\"2\\" width=\\"40\\" height=\\"34\\" rx=\\"3\\" fill=\\"#a9d8f2\\"/><circle cx=\\"20\\" cy=\\"12\\" r=\\"3.6\\" fill=\\"#ffd44d\\"/><rect x=\\"20.5\\" y=\\"2\\" width=\\"3\\" height=\\"34\\" fill=\\"#f4efe6\\"/><rect x=\\"2\\" y=\\"17.5\\" width=\\"40\\" height=\\"3\\" fill=\\"#f4efe6\\"/><rect x=\\"2\\" y=\\"2\\" width=\\"40\\" height=\\"34\\" rx=\\"3\\" fill=\\"none\\" stroke=\\"#f4efe6\\" stroke-width=\\"3\\"/><rect x=\\"0\\" y=\\"35\\" width=\\"44\\" height=\\"4\\" rx=\\"1\\" fill=\\"#e2d9c8\\"/></svg>","loft":"<svg class=\\"office-pendant\\" viewBox=\\"0 0 30 40\\" width=\\"30\\" height=\\"40\\"><rect x=\\"14\\" y=\\"0\\" width=\\"2\\" height=\\"18\\" fill=\\"#3a3a3a\\"/><path d=\\"M4 30 L11 18 H19 L26 30 Z\\" fill=\\"#3f3f44\\"/><ellipse cx=\\"15\\" cy=\\"30\\" rx=\\"11\\" ry=\\"2.5\\" fill=\\"#ffe4a8\\"/><circle cx=\\"15\\" cy=\\"27\\" r=\\"3\\" fill=\\"#fff2c8\\"/></svg><svg class=\\"office-window\\" viewBox=\\"0 0 44 40\\" width=\\"44\\" height=\\"40\\"><rect x=\\"2\\" y=\\"2\\" width=\\"40\\" height=\\"34\\" rx=\\"3\\" fill=\\"#a9d8f2\\"/><circle cx=\\"20\\" cy=\\"12\\" r=\\"3.6\\" fill=\\"#ffd44d\\"/><rect x=\\"20.5\\" y=\\"2\\" width=\\"3\\" height=\\"34\\" fill=\\"#f4efe6\\"/><rect x=\\"2\\" y=\\"17.5\\" width=\\"40\\" height=\\"3\\" fill=\\"#f4efe6\\"/><rect x=\\"2\\" y=\\"2\\" width=\\"40\\" height=\\"34\\" rx=\\"3\\" fill=\\"none\\" stroke=\\"#f4efe6\\" stroke-width=\\"3\\"/><rect x=\\"0\\" y=\\"35\\" width=\\"44\\" height=\\"4\\" rx=\\"1\\" fill=\\"#e2d9c8\\"/></svg>"}
function setSkin(s) {
  document.getElementById('amb').innerHTML = AMBIENCE[s] || ''
  const parlor = s === 'pizza'
  document.getElementById('counter').innerHTML = parlor ? PIE : "<svg viewBox=\\"0 0 64 30\\" width=\\"64\\" height=\\"30\\" class=\\"office-bar-taps\\"><rect x=\\"14\\" y=\\"12\\" width=\\"26\\" height=\\"18\\" rx=\\"3\\" fill=\\"#8f949c\\"/><rect x=\\"16\\" y=\\"13\\" width=\\"6\\" height=\\"16\\" rx=\\"2\\" fill=\\"rgba(255,255,255,.35)\\"/><rect x=\\"20\\" y=\\"2\\" width=\\"3\\" height=\\"12\\" rx=\\"1.5\\" fill=\\"#2b2b2f\\"/><circle cx=\\"21.5\\" cy=\\"3\\" r=\\"2.6\\" fill=\\"#c9302c\\"/><rect x=\\"31\\" y=\\"2\\" width=\\"3\\" height=\\"12\\" rx=\\"1.5\\" fill=\\"#2b2b2f\\"/><circle cx=\\"32.5\\" cy=\\"3\\" r=\\"2.6\\" fill=\\"#3d7a3a\\"/><rect x=\\"46\\" y=\\"12\\" width=\\"12\\" height=\\"18\\" rx=\\"1.5\\" fill=\\"#f2b53a\\"/><rect x=\\"46\\" y=\\"12\\" width=\\"12\\" height=\\"18\\" rx=\\"1.5\\" fill=\\"none\\" stroke=\\"rgba(255,255,255,.55)\\" stroke-width=\\"1\\"/><ellipse cx=\\"52\\" cy=\\"12\\" rx=\\"7\\" ry=\\"3.2\\" fill=\\"#fff\\"/><circle cx=\\"56.5\\" cy=\\"10\\" r=\\"1.6\\" fill=\\"#fff\\"/></svg>"
  document.getElementById('shelf').innerHTML = parlor ? '' : "<svg viewBox=\\"0 0 108 30\\" class=\\"office-bar-bottles\\" preserveAspectRatio=\\"xMidYMax meet\\"><rect x=\\"6\\" y=\\"8\\" width=\\"3\\" height=\\"6\\" rx=\\"1\\" fill=\\"#3d7a3a\\"/><rect x=\\"4\\" y=\\"13\\" width=\\"7\\" height=\\"17\\" rx=\\"1.5\\" fill=\\"#3d7a3a\\"/><rect x=\\"5.2\\" y=\\"16\\" width=\\"1.4\\" height=\\"11\\" rx=\\".7\\" fill=\\"rgba(255,255,255,.35)\\"/><rect x=\\"5\\" y=\\"19\\" width=\\"5\\" height=\\"5\\" rx=\\".5\\" fill=\\"rgba(255,255,255,.55)\\"/><rect x=\\"17\\" y=\\"4\\" width=\\"3\\" height=\\"6\\" rx=\\"1\\" fill=\\"#c98a2a\\"/><rect x=\\"15\\" y=\\"9\\" width=\\"7\\" height=\\"21\\" rx=\\"1.5\\" fill=\\"#c98a2a\\"/><rect x=\\"16.2\\" y=\\"12\\" width=\\"1.4\\" height=\\"15\\" rx=\\".7\\" fill=\\"rgba(255,255,255,.35)\\"/><rect x=\\"16\\" y=\\"15\\" width=\\"5\\" height=\\"5\\" rx=\\".5\\" fill=\\"rgba(255,255,255,.55)\\"/><rect x=\\"28.5\\" y=\\"12\\" width=\\"3\\" height=\\"6\\" rx=\\"1\\" fill=\\"#e6dcc4\\"/><rect x=\\"26\\" y=\\"17\\" width=\\"8\\" height=\\"13\\" rx=\\"1.5\\" fill=\\"#e6dcc4\\"/><rect x=\\"27.2\\" y=\\"20\\" width=\\"1.4\\" height=\\"7\\" rx=\\".7\\" fill=\\"rgba(255,255,255,.35)\\"/><rect x=\\"27\\" y=\\"23\\" width=\\"6\\" height=\\"5\\" rx=\\".5\\" fill=\\"rgba(255,255,255,.55)\\"/><rect x=\\"40\\" y=\\"6\\" width=\\"3\\" height=\\"6\\" rx=\\"1\\" fill=\\"#8a2a3a\\"/><rect x=\\"38\\" y=\\"11\\" width=\\"7\\" height=\\"19\\" rx=\\"1.5\\" fill=\\"#8a2a3a\\"/><rect x=\\"39.2\\" y=\\"14\\" width=\\"1.4\\" height=\\"13\\" rx=\\".7\\" fill=\\"rgba(255,255,255,.35)\\"/><rect x=\\"39\\" y=\\"17\\" width=\\"5\\" height=\\"5\\" rx=\\".5\\" fill=\\"rgba(255,255,255,.55)\\"/><rect x=\\"51\\" y=\\"10\\" width=\\"3\\" height=\\"6\\" rx=\\"1\\" fill=\\"#4a86c9\\"/><rect x=\\"49\\" y=\\"15\\" width=\\"7\\" height=\\"15\\" rx=\\"1.5\\" fill=\\"#4a86c9\\"/><rect x=\\"50.2\\" y=\\"18\\" width=\\"1.4\\" height=\\"9\\" rx=\\".7\\" fill=\\"rgba(255,255,255,.35)\\"/><rect x=\\"50\\" y=\\"21\\" width=\\"5\\" height=\\"5\\" rx=\\".5\\" fill=\\"rgba(255,255,255,.55)\\"/><rect x=\\"62\\" y=\\"5\\" width=\\"3\\" height=\\"6\\" rx=\\"1\\" fill=\\"#2b2b2f\\"/><rect x=\\"60\\" y=\\"10\\" width=\\"7\\" height=\\"20\\" rx=\\"1.5\\" fill=\\"#2b2b2f\\"/><rect x=\\"61.2\\" y=\\"13\\" width=\\"1.4\\" height=\\"14\\" rx=\\".7\\" fill=\\"rgba(255,255,255,.35)\\"/><rect x=\\"61\\" y=\\"16\\" width=\\"5\\" height=\\"5\\" rx=\\".5\\" fill=\\"rgba(255,255,255,.55)\\"/><rect x=\\"73.5\\" y=\\"11\\" width=\\"3\\" height=\\"6\\" rx=\\"1\\" fill=\\"#c9702c\\"/><rect x=\\"71\\" y=\\"16\\" width=\\"8\\" height=\\"14\\" rx=\\"1.5\\" fill=\\"#c9702c\\"/><rect x=\\"72.2\\" y=\\"19\\" width=\\"1.4\\" height=\\"8\\" rx=\\".7\\" fill=\\"rgba(255,255,255,.35)\\"/><rect x=\\"72\\" y=\\"22\\" width=\\"6\\" height=\\"5\\" rx=\\".5\\" fill=\\"rgba(255,255,255,.55)\\"/><rect x=\\"85\\" y=\\"7\\" width=\\"3\\" height=\\"6\\" rx=\\"1\\" fill=\\"#3d7a3a\\"/><rect x=\\"83\\" y=\\"12\\" width=\\"7\\" height=\\"18\\" rx=\\"1.5\\" fill=\\"#3d7a3a\\"/><rect x=\\"84.2\\" y=\\"15\\" width=\\"1.4\\" height=\\"12\\" rx=\\".7\\" fill=\\"rgba(255,255,255,.35)\\"/><rect x=\\"84\\" y=\\"18\\" width=\\"5\\" height=\\"5\\" rx=\\".5\\" fill=\\"rgba(255,255,255,.55)\\"/><rect x=\\"96\\" y=\\"9\\" width=\\"3\\" height=\\"6\\" rx=\\"1\\" fill=\\"#e6dcc4\\"/><rect x=\\"94\\" y=\\"14\\" width=\\"7\\" height=\\"16\\" rx=\\"1.5\\" fill=\\"#e6dcc4\\"/><rect x=\\"95.2\\" y=\\"17\\" width=\\"1.4\\" height=\\"10\\" rx=\\".7\\" fill=\\"rgba(255,255,255,.35)\\"/><rect x=\\"95\\" y=\\"20\\" width=\\"5\\" height=\\"5\\" rx=\\".5\\" fill=\\"rgba(255,255,255,.55)\\"/></svg>"
  document.querySelector('.office-bar-sign').textContent = parlor ? 'Pizza' : 'Bar'
  const w1 = document.getElementById('w1'), w2 = document.getElementById('w2')
  w1.querySelector('.office-slice')?.remove()
  if (parlor) { w1.insertAdjacentHTML('afterbegin', SLICE); w1.querySelector('.office-status').textContent = 'pizza!'; w2.querySelector('.office-status').textContent = 'no pizza'; w2.querySelector('.office-status').classList.add('is-sad') }
  else { w1.querySelector('.office-status').textContent = 'at the bar'; w2.querySelector('.office-status').textContent = 'exploring'; w2.querySelector('.office-status').classList.remove('is-sad') }
  skins.forEach(k => { root.classList.remove('is-' + k); room.classList.remove('is-' + k) })
  root.classList.add('is-' + s); room.classList.add('is-' + s)
  document.getElementById('skin').textContent = s
  location.hash = s
}
document.getElementById('skin').onclick = () => setSkin(skins[(skins.indexOf(location.hash.slice(1) || 'carpet') + 1) % skins.length])
document.getElementById('theme').onclick = () => document.documentElement.classList.toggle('dark')
document.getElementById('night').onclick = () => { root.classList.toggle('is-night'); render() }
document.getElementById('more').onclick = () => { more = !more; render() }
setSkin(location.hash.slice(1) || 'carpet')
window.setSkin = setSkin
${HOPFN}
window.hopDemo = function () {
  const rm = document.getElementById('room'), r = rm.getBoundingClientRect()
  const faceOn = el => { const b = el.getBoundingClientRect(); return { x: b.left - r.left + rm.scrollLeft + b.width/2 - 21, y: b.top - r.top + rm.scrollTop + b.height/2 - 21 } }
  const rows = [[1],[2],[3,4],[5],[6,7],[8]].map(row => { const pts = row.map(n => faceOn(document.querySelector('[data-hop="' + n + '"]'))); return { id: row.join('-'), x: pts.reduce((a,p)=>a+p.x,0)/pts.length, y: pts.reduce((a,p)=>a+p.y,0)/pts.length } })
  const course = hopCourse(rows)
  const w = document.getElementById('w2'); w.querySelector('.office-status').textContent = 'hop hop'
  let from = { x: 300, y: 260 }, i = 0, t0 = performance.now(), ms = 900
  const squares = [...document.querySelectorAll('.office-hop')]
  function frame(now) {
    const to = course[i]; const raw = Math.min(1, (now - t0) / ms)
    const t = walkEase(raw, 'hopscotch'), hop = walkHop(raw, 'hopscotch'), sq = hopSquash(raw, 'hopscotch')
    w.style.left = (from.x + (to.x - from.x) * t) + 'px'; w.style.top = (from.y + (to.y - from.y) * t - hop) + 'px'
    w.style.transform = 'scale(' + sq.sx.toFixed(3) + ',' + sq.sy.toFixed(3) + ')'
    const spot = raw < .45 ? from : raw > .8 ? to : null
    const lit = new Set(String(spot?.id || '').split('-'))
    squares.forEach(el => el.classList.toggle('is-lit', lit.has(el.dataset.hop)))
    if (raw >= 1) { from = to; i++; if (i >= course.length) return; t0 = now; ms = Math.max(360, Math.min(1400, Math.hypot(course[i].x - from.x, course[i].y - from.y) * 9)) }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
</script>
`

const out = new URL('./preview.html', import.meta.url)
writeFileSync(out, html)
console.log('wrote', out.pathname, html.length)
