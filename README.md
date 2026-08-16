# Hermes Office

A Desktop plugin. One floor of desks, one desk per Bot Mode agent.

Uses the same live data Bot Mode already uses:

- `profiles.list` for the roster
- `ui_meta.hermes-bots` for names and avatars
- `host.state.busy` for a real live turn
- `host.state.profile` so only the focused bot thinks
- `host.openSession` / `host.newChat` to open a chat

While a bot is working, their monitor lights up and their face rocks. Click a desk to jump into that chat.

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
