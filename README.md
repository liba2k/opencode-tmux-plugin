# OpenCode Tmux Plugin

An OpenCode plugin that automatically updates your tmux window name based on the current OpenCode session.

## Features

- Automatically renames tmux window when a new OpenCode session starts
- Updates window name when you switch between sessions
- Updates window name when session title changes
- Resets the window name when the session ends or OpenCode closes
- Tracks all main sessions (ignores subagent sessions)
- Safe: only runs if you're inside a tmux session

## Installation

1. **Build the plugin:**
   ```bash
   cd opencode-tmux-plugin
   npm install
   npm run build
   ```

2. **Register the plugin:**
   
   Add the plugin to your OpenCode config at `~/.config/opencode/opencode.json`:
   
   ```json
   {
     "plugin": [
       "/absolute/path/to/opencode-tmux-plugin"
     ]
   }
   ```
   
   Or if you have other plugins:
   
   ```json
   {
     "plugin": [
       "oh-my-opencode",
       "/absolute/path/to/opencode-tmux-plugin"
     ]
   }
   ```

3. **Restart OpenCode** or start a new session to activate the plugin.

## How It Works

The plugin listens to OpenCode session events and chat messages:

- **session.created**: When a main session (non-subagent) is created, it stores the session
- **session.updated**: When the session title changes, it updates the window name
- **chat.message**: When you send a message in a different session, it detects the switch and updates the window name
- **session.deleted**: When a session ends, it removes it from tracking
- **server.instance.disposed**: When OpenCode shuts down, it resets the window name to `oc`

**Note**: The window name updates when you **send a message** in a session, not immediately when you switch using `/sessions`. This means the window reflects the session you're actively working in.

## Development

- **Watch mode**: `npm run watch` - automatically rebuilds on file changes
- **Manual build**: `npm run build`

## Configuration

Currently, the plugin uses the session ID (first 8 characters) as the window name. You can modify `src/index.ts` to customize the naming scheme.

## Requirements

- tmux must be installed
- OpenCode must be running inside a tmux session
- The `TMUX` environment variable must be set (automatic when inside tmux)

## Troubleshooting

- Check that you're running OpenCode inside a tmux session: `echo $TMUX`
- Look for plugin logs in OpenCode's output (they start with `[tmux-plugin]`)
- Verify the plugin is registered in `~/.config/opencode/opencode.json`
- Make sure the plugin is built: check that `dist/index.js` exists
