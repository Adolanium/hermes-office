# Hermes Office

A small, increasingly peculiar office for your Hermes bots. One carpeted room, real tasks, a pizza counter, and a cat with no respect for the seating plan.

## Work at the desks

Pick a bot by its nameplate, enter a task in the bottom bar, and press Send. An envelope flies to its desk. Each task goes into that bot's existing forever **Bot Chat**, keeping its history in one conversation. Double-click a nameplate or choose **open chat** to go there.

Confirmed completions earn a star, leave a parcel on the desk, and send the bot toward the pizza counter. A fresh pizza arrives whenever a task starts. The first finisher to reach the counter gets the slice. Click a parcel or the news notice to open the result.

Session-scoped questions and approval requests make the bot raise a hand. Choose **Raised hand · open question** or the header's needs-input notice to open the corresponding chat. The Office never answers approvals itself. Failed and unconfirmed tasks retain their recovery controls and never earn completion rewards.

## Life on the carpet

The room now stays compact on large screens, with a furnished coffee area, sofa, noticeboard, and manager's door. Desks have legs and keyboards.

The boss sometimes comes through the manager's door, visits two desks with a clipboard, then leaves. Idle workers head back to their desks and react according to their personalities. Busy workers keep working. You can trigger a visit with **Toy drawer → Call the boss**. A visit lasts twenty seconds and records an incident in the newspaper, without awarding task stars.

**Personalities** lets you give each bot a lasting quirk. Mug collectors accumulate mugs on their desks and visit the coffee machine. Tidiers inspect the paper bin. Victory enthusiasts celebrate loudly through movement, while quiet achievers deliver without confetti. Button investigators gravitate toward the fan. Quirks also change idle remarks and poses. Bots remember incidents they took part in and bring them up later.

**Toy drawer** starts a short scene:

- Release a wind-up mouse for the cat to chase.
- Ice the carpet and send the rolling chair sliding.
- Drop a beach ball near the fan.
- Ring the lunch bell and call idle bots to pizza.
- Switch off gravity and watch the props float.
- Provoke a paper-spewing printer.
- Order an enormous plant.
- Invite a tiny UFO to inspect the wall portrait.

Scenes unfold in three stages over twelve seconds. Idle bots investigate and exchange remarks. Working bots, held bots, and musical-chairs players are excluded from casting. A bot that starts work during a scene stops participating. **End scene** stops the scene early without recording an invented ending.

**Office energy** controls spontaneous antics. **Quiet** leaves scenes to you; **A little odd** allows occasional incidents; **Chaos** brings them closer together. The first spontaneous incident waits at least 90 seconds, then completed scenes have a three-minute or 45-second cooldown. Ordinary personality visits happen about every 24 seconds outside Quiet mode. No sounds play.

## Make it yours

**Furnish** opens the furniture list. The coffee machine, fan, rolling chair, paper bin, and cat are available immediately. Use any placed object to start its related scene. Put objects away or choose **Arrange furniture**, then drag them around the lounge below the desks. Keyboard users can focus an object and move it with the arrow keys. Positions and visibility survive plugin reloads.

Real completed tasks unlock keepsakes:

| Completed tasks | Keepsake |
| --- | --- |
| 1 | First delivery certificate |
| 5 | Fish tank |
| 10 | Suspicious button |
| 20 | Pizza hall of fame |

The **Office newspaper** opens *The Carpet Chronicle*, with the weekly task, pizza, and hopscotch recap. Its latest 60 records include completed tasks, pizza claims, and finished incidents. Select a record to see who was present and the furniture arrangement saved with it. These are miniature scene records, not screenshots or replays of your conversations. Work prompts and result text are not copied into the newspaper.

The office also keeps the original petting, dragging, blinking, sleeping, hopscotch, musical chairs, hourly breaks, day/night window, warm desk lamps, and employee-of-the-month portrait. Tap a bot to pet it; hold it still to let it sleep. With a bot selected, arrows nudge it, Shift makes larger steps, Enter opens its chat, and P pets it. **Back to desk** sends a wandering bot home.

Reduced-motion settings disable decorative bouncing, spinning, and incident animations. Task controls remain separate from the scene controls. Large rosters scroll inside the room, with furniture below the desks. Older saved background selections migrate to the carpet office; other room themes are no longer offered.

## Install

Copy this folder to the machine running Hermes Desktop:

```text
%USERPROFILE%\AppData\Local\hermes\desktop-plugins\hermes-office
```

The folder must be named `hermes-office`. Press Ctrl+K, then **Reload desktop plugins**. Open **Office** in the sidebar or use **Open office floor** in the command palette.

Use a Desktop build with owner-routed `host.requestProfile`, `host.onEvent`, and `host.openSession`. Office fails closed when it cannot establish who owns a background request. Bot Mode does not need to be on, but its saved names and avatars are reused.

The installed plugin remains a single `plugin.js` file with the SDK and React supplied by Hermes. The npm packages below are only for local preview development.

## Preview and tests

```powershell
npm ci --prefix tools/preview
node tools/preview/build.mjs
node tools/preview/serve.mjs
```

Open [the interactive preview](http://localhost:4877/preview.html). It renders the actual plugin with a local SDK stand-in and simulated six-second tasks. Its storage is isolated from Hermes. It also has a light/dark toggle.

```powershell
node --test tests/*.test.mjs
```

Tests cover task routing and lifecycle, room migration, pizza ownership, animation math, scene casting and cancellation, bounded memories, personality persistence, and input-request correlation.

## License

MIT
