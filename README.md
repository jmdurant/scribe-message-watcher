# Scribe Message Watcher

A Chrome extension to monitor and interact with Doximity Scribe for medical dictation workflows.

## Features

- **New Dictation Notifications**: Get notified when new dictations are available
- **Popup Controls**: Quick access to notes list and recording controls
- **Keyboard Shortcuts**: Control recording without switching tabs
- **Recording Status Badge**: Extension icon shows recording state (red dot = recording, orange pause = paused)
- **DotExpander Integration**: Optionally send dictations to DotExpander as the `@dictation@` variable
- **PracticeQ/IntakeQ Integration**: Optional EHR integration support

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+M` | Toggle microphone (Start/Pause/Resume) |
| `Alt+G` | Generate Note |
| `Alt+C` | Cancel/Discard recording |
| `Alt+,` | Open extension popup |

Shortcuts work globally - you don't need to be on the Doximity tab.

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the extension folder
5. Pin the extension to your toolbar for easy access

## Usage

### Recording Notes
1. Click the extension icon or press `Alt+,` to open the popup
2. Click "Take Notes" to navigate to the recording page
3. Select your microphone and note type
4. Use the mic button or `Alt+M` to start/pause recording
5. Press `Alt+G` to generate the note when done

### Viewing Notes
- The popup shows your recent notes
- Click on a note to view it in Doximity
- Use "Extract All" to extract note content

### Canceling a Recording
- Click "Cancel Notes" in the popup, or
- Press `Alt+C` to discard the current recording

## Options

Access extension options to configure:
- **PracticeQ Integration**: Enable/disable EHR integration
- **DotExpander Integration**: Enable/disable sending dictations to DotExpander

## Extension Icon Badges

| Badge | Meaning |
|-------|---------|
| Red dot (●) | Recording in progress |
| Orange pause (❚❚) | Recording paused |
| Green check (✓) | Note generated (clears after 3s) |
| Red X (✕) | Recording cancelled (clears after 3s) |
| Blue "NEW" | New dictation available |

## Files

- `manifest.json` - Extension configuration
- `background.js` - Service worker for notifications and shortcuts
- `content.js` - Content script for Doximity page interaction
- `popup.html/js` - Extension popup UI
- `options.html/js` - Extension settings page

## Author

James M DuRant III MD MBA
Developmental-Behavioral Pediatrician
[james@doctordurant.com](mailto:james@doctordurant.com)
[https://developmentalondemand.com](https://developmentalondemand.com)

## License

Copyright Doximity, Inc.
