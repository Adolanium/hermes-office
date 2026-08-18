# Hermes Office

<img width="877" height="686" alt="Hermes_2WQOW5UiOI" src="https://github.com/user-attachments/assets/183421d0-9c23-4e9e-abc8-9390601ceea3" />



A Desktop plugin. One floor of desks, one desk per Bot Mode agent.

Uses the same live data Bot Mode already uses:

- `profiles.list` for the roster
- `ui_meta.hermes-bots` for names and avatars
- `host.state.busy` for a real live turn
- `host.state.profile` so only the focused bot thinks
- `host.openSession` / `prompt.submit` into that bot's Bot Chat session

While a bot is working, their monitor lights up and their face rocks.

Give them a task from the bar at the bottom. It goes into the same forever **Bot Chat** Bot Mode already uses, so the history stays one conversation. Click a nameplate to pick who gets it. Double-click, or hit **open chat**, to jump into that same session.

Cute bits on the floor:

- First open shows one hint bubble that says what the toy does. Close it or just start playing and it never comes back. Faces and hop squares have tooltips too.
- They blink, breathe, and their eyes follow your mouse when it comes close. Hover a face and they flinch. Tap to pet. Hold still and they fall asleep in your hand.
- Drag them around. They land with a squash and a puff of dust, then keep wandering. Drop two close together and they whisper. Two bots crossing paths say hi.
- **Back to desk** is the only thing that sends them home. Every desk has an office chair. It wobbles while they are away.
- Click the carpet and everyone peeks.
- The garden sky has a sun by day and a moon by night that cross the wall through the day. The office and loft have a window that shows the same sky. After 7pm the room goes night and desk lamps warm up. Bots left alone at their desks start to yawn, and after a few quiet minutes they nod off. A task or a pet wakes them.
- The plant leans when someone thinks. The clock ticks in 24 hour time. Click it to flip digital and analog. Drag it to move.
- Cycle the room from the header: carpet, loft, garden, nightclub, or pizza parlor. Each one is a flat wall band and a tiled floor (tiny SVGs, no perspective) so the paper dolls and desks actually stand on it. Night still dims whatever is on.
- Sending a task pops a "?" over the bot, flies a paper plane to the desk, and the monitor boots up. Finishing pops a "!". The screen types out while they think. When they finish, confetti pops over the desk, they earn a star on their nameplate (stars are also written to the bot profile, so they follow the bot, not the machine), and they walk to the bar. Two at the bar high five.
- Desks sit across from a bar with bottles, taps and a pint. Finish a task and they walk over, sit on a stool, linger, and cheer.
- In the pizza parlor the bar is a pizza counter with one pie per round. A round starts whenever anyone gets a task. First bot to finish and reach the counter takes a slice and carries it around for a bit. Everyone after that gets "no pizza".
- Hopscotch is chalked on the floor in the aisle. Tap a square and an idle bot hops the course out and back, landing on both squares of a pair, with the chalk lighting up under them.
- **chairs** in the header starts musical chairs. Wooden chairs appear in the middle of the floor, music notes float up, and idle bots circle them. When the music stops everyone freezes for a beat, then races in. One is left standing. Bots at their desks watch and clap. Thinking bots keep working.
- Each room has one small living thing: butterflies in the garden, a light sweep in the nightclub, a wood oven in the parlor, a bubbling water cooler in the office, a swaying pendant lamp in the loft. A tally board on the wall counts tasks finished.
- A bot with no task for two days gets bored: chin on the desk, half closed eyes, doodling on the screen. A task fixes it.
- The header shows a weekly recap once anything has happened: tasks done, who ate the most pizza, hops taken. Resets on Monday.
- Keyboard: with a bot picked, arrows nudge it around the floor (Shift for bigger steps), Enter opens its chat, P pets it.
- The room is a centred diorama with a fixed play height. It scrolls only when there are more desks than fit.
- If your OS asks for reduced motion, the bobbing and bouncing turn off. Walks stay.

## Install

This is a desktop plugin. Put it on the machine that runs Hermes Desktop.

```
copy this folder to:

  %USERPROFILE%\AppData\Local\hermes\desktop-plugins\hermes-office
```

The folder name must be `hermes-office`. Then Ctrl+K → Reload desktop plugins.

You need a Desktop build that has `host.state.busy` (the SDK change on main). Older builds still load. Faces just stay idle.

Bot Mode does not have to be on, but avatars look right when Bot Mode has already saved looks on the profile.

## Open it

Sidebar → Office, or ⌘K / Ctrl+K → Open office floor.

## License

MIT
