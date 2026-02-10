<p align="center">
  <img src="icon-128.png" alt="Scribe Message Watcher" width="128" height="128">
</p>

# Scribe Message Watcher

A Chrome extension that streamlines the Doximity Scribe AI medical dictation workflow — replacing the mobile device with your desktop browser and microphone so you never leave the patient encounter.

## The Problem

AI-powered medical scribes like Doximity Scribe and Nuance DAX are transforming clinical documentation, but the current workflow has real friction points that pull providers out of the patient encounter:

- **Mobile device dependency** — Recording through a phone means worrying about battery life, keeping the app foregrounded, and having a personal device actively listening during the visit. Patients notice.
- **Waiting for results** — After stopping a recording, the provider has to switch back to the phone or check a separate tab to see if the note is ready. There's no push notification to the workstation where charting happens.
- **Manual copy/paste into the EHR** — Once the scribe result is generated, getting that text into the actual clinical note requires navigating to the result, selecting the text, copying it, switching to the EHR, and pasting it. Every extra click adds up across a full day of visits.

These interruptions break the flow of the encounter. The provider ends up juggling a phone, a browser, and an EHR — all while trying to be present with the patient.

## The Solution

Scribe Message Watcher moves the entire Doximity Scribe workflow into the Chrome browser, where you're already working. A desktop or external USB/Bluetooth microphone (such as the [Anker PowerConf](https://www.anker.com/products/a3301-anker-powerconf-bluetooth-speakerphone) or [AnkerWork S400](https://www.ankerwork.com/products/a3307-ankerwork-s400-speakerphone)) replaces the mobile device, and the extension handles the rest:

1. **Start recording from the browser** — Click the extension icon or press `Alt+M`. No phone needed. The desktop mic picks up the conversation with better audio quality than a phone across the room.
2. **Control recording without switching tabs** — Keyboard shortcuts (`Alt+M` to pause/resume, `Alt+G` to generate, `Alt+C` to cancel) work globally, so you stay in your EHR while Scribe records in the background.
3. **Get notified when the note is ready** — Chrome sends a desktop notification the moment Scribe finishes generating. No more checking back.
4. **One-click copy** — Open the extension popup, see your recent notes, and click copy. The scribe result is on your clipboard, ready to paste into the EHR.
5. **Optional EHR auto-fill** — With PracticeQ/IntakeQ integration enabled, the extension reads the currently-open patient's name, DOB, MRN, and visit date, then fills those fields into the copied note automatically. No retyping demographics.

The result: **the entire dictation-to-note workflow happens in the browser, in front of the patient, without breaking the flow of the visit.**

## Features

- **Browser-based recording** — Use any desktop, USB, or Bluetooth microphone instead of a mobile device
- **Global keyboard shortcuts** — Control recording from any tab without switching context
- **Desktop notifications** — Chrome notifies you the moment a new dictation is ready
- **One-click copy** — View recent notes in the popup and copy results instantly
- **Recording status badge** — Extension icon shows recording state at a glance
- **PracticeQ/IntakeQ integration** — Optionally pull patient demographics into the copied note
- **DotExpander integration** — Optionally send dictations to DotExpander as the `@dictation@` snippet variable
- **Debug mode** — Toggle detailed logging from the options page for troubleshooting

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+M` | Toggle microphone (Start / Pause / Resume) |
| `Alt+G` | Generate note |
| `Alt+C` | Cancel / discard recording |
| `Alt+,` | Open extension popup |

Shortcuts work globally — you don't need to be on the Doximity tab.

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the extension folder
5. Pin the extension to your toolbar for easy access

## Usage

### Recording a Visit

1. Open the extension popup (`Alt+,` or click the icon)
2. Click **Take Notes** — the extension navigates to Doximity Scribe's recording page
3. Select your microphone and note type from the dropdowns
4. Press `Alt+M` or click the mic button to start recording
5. Conduct the visit normally — the desktop mic captures the conversation
6. Press `Alt+M` to pause if needed, then `Alt+M` again to resume
7. Press `Alt+G` to generate the note when the visit is complete

### Getting the Result

- Chrome sends a **desktop notification** when the note is ready
- Click the extension icon to see your recent notes
- Click **Copy** on any note to copy it to your clipboard
- Paste into your EHR

### With PracticeQ Integration

When enabled in options, the extension reads the patient currently open in PracticeQ/IntakeQ and automatically fills in `[Name]`, `[DOB]`, `[MRN]`, `[Date]`, and `[Referring Provider Name]` placeholders in the copied note.

### Canceling a Recording

- Click **Cancel Notes** in the popup, or press `Alt+C`

## Extension Icon Badges

The extension icon shows the current state at a glance via badge overlays:

| Badge | Meaning |
|-------|---------|
| :red_circle: `●` | Recording in progress |
| :orange_circle: `❚❚` | Recording paused |
| :green_circle: `✓` | Note generated (clears after 3s) |
| :red_circle: `✕` | Recording cancelled (clears after 3s) |
| :large_blue_circle: `NEW` | New dictation available |

## Options

Right-click the extension icon and select **Options** to configure:

- **PracticeQ Integration** — Enable/disable EHR patient data auto-fill
- **DotExpander Integration** — Enable/disable sending dictations to DotExpander
- **DotExpander Extension ID** — Set the ID if using a custom DotExpander build
- **Debug Mode** — Enable detailed console logging for troubleshooting

## Recommended Microphones

Any desktop or USB microphone works, but conference speakerphones designed for room pickup work especially well in an exam room:

- **Anker PowerConf** — Bluetooth/USB speakerphone with 360-degree pickup
- **AnkerWork S400** — USB-C speakerphone with enhanced voice clarity

These sit on the desk, pick up both provider and patient clearly, and don't require a phone in the room.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration (permissions, content scripts, shortcuts) |
| `shared.js` | Shared utilities (debug logging, tab finding, badge updates) |
| `background.js` | Service worker for notifications, polling, and keyboard shortcuts |
| `content.js` | Content script for Doximity Scribe page interaction |
| `intakeq_content.js` | Content script for PracticeQ/IntakeQ patient data extraction |
| `popup.html` | Extension popup markup |
| `popup.js` | Popup initialization, state management, and event listeners |
| `popup-ui.js` | Popup rendering functions (notes list, mic controls, dialogs) |
| `popup-notes.js` | Note fetching, caching, and template logic |
| `popup-controls.js` | Microphone and recording control functions |
| `options.html` / `options.js` | Extension settings page |

## Author

James M DuRant III MD MBA
Developmental-Behavioral Pediatrician
[james@doctordurant.com](mailto:james@doctordurant.com)
[https://developmentalondemand.com](https://developmentalondemand.com)

## License

Integrates with Doximity Scribe.
