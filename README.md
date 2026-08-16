# Hermes Office

<img width="1132" height="697" alt="chrome_oBdOUrOaEx" src="https://github.com/user-attachments/assets/cc239719-4039-4590-bd51-1c4f4640d192" />


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

- Hover a face and they flinch. Tap to pet. Hold still and they fall asleep in your hand.
- Drag them around. After you put them down they keep wandering. Drop two close together and they whisper.
- **Back to desk** is the only thing that sends them home. The empty chair wobbles.
- Click the carpet and everyone peeks.
- After 7pm the room goes night and desk lamps warm up.
- The plant leans when someone thinks. The clock ticks in 24 hour time. Click it to flip digital and analog. Drag it to move.

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
