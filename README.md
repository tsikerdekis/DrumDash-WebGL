# DrumDash-WebGL

The public WebGL build and website for **DrumDash** – the ultimate customizable drumming game.

## About DrumDash

DrumDash is a rhythm game where you can import any song and practice drums at your own pace. Whether you're using a drum kit, electronic pads, or just drumsticks on a table, DrumDash adapts to your setup and skill level.

### Key Features

- **Import Your Own Songs** – Bring in MIDI files, paradiddle patterns, or audio files and start jamming instantly
- **AI-Generated Difficulties** – Automatic drum chart generation from Easy to Expert levels
- **Flexible Audio Options** – Play with drumless tracks, full audio, or AI-generated beats
- **Precision Rhythm Gameplay** – Tap, hit, and hold notes to master every beat
- **Customizable Drum Kits** – Use on-screen kits, electronic pads, or integrate with your real drum kit
- **Responsive Design** – Play on desktop, tablet, or mobile (Android app available)

## Project Structure

```
DrumDash-WebGL/
├── Build/                          # Unity WebGL build files
│   ├── DrumDashWeb.data.unityweb
│   ├── DrumDashWeb.framework.js.unityweb
│   ├── DrumDashWeb.loader.js
│   └── DrumDashWeb.wasm.unityweb
├── StreamingAssets/                # Game data files
│   └── UnityServicesProjectConfiguration.json
├── TemplateData/                   # Styling and assets
│   └── style.css
├── index.html                      # Main WebGL player page
├── privacy-policy.html
├── terms.html
├── contact.html
└── cookie-policy.html
```

## Playing the Game

Visit the live website at **https://drumdash.northshorepress.co** to play in your browser, or download the Android app from Google Play.

### Browser Compatibility

- **Chrome/Edge** – Full support including MIDI
- **Safari** – Full support including MIDI
- **Firefox** – Limited support (MIDI not available)

## Development

The WebGL build is created using Unity and deployed as a static website. The HTML template includes:

- Responsive game container with adaptive sizing
- Cookie consent management
- AdBlock detection
- Theater mode (fullscreen) support
- Footer controls (fullscreen toggle, version display)

## Features

- Mobile responsive design
- Fullscreen/Theater mode support
- GDPR cookie consent
- AdBlock detection
- Cross-browser compatible

## License

© 2026 Northshore Press LLC. All rights reserved.
