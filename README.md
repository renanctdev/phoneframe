# PhoneFrame

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.pt-BR.md">Português (Brasil)</a>
</p>

---

**Preview your site inside a real phone or tablet frame, then record and polish a studio-quality demo, all in one desktop app.**

PhoneFrame opens any web page in a window shaped like the device you pick: bezel, side buttons, Dynamic Island or punch-hole camera, status bar, address bar. The page sees the real viewport width, User-Agent and touch support of that device. Press record and PhoneFrame captures the device window (already cropped to the phone's shape), tracks your taps, and opens an editor that adds smooth auto-zoom, backgrounds and text, then exports an MP4.

> Status: early release (`0.1.0`), Windows only.

## Quick start

Requirements: Windows 10/11 (x64), [Node.js](https://nodejs.org/) and npm.

```powershell
git clone https://github.com/renanctdev/phoneframe.git
cd phoneframe/app

npm install
npm start        # run the app in development
npm run dist     # build the NSIS installer and a portable .exe into ./dist
```

The build produces `PhoneFrame.exe` (inside `dist/win-unpacked`), an installer and a portable version. Builds are not code-signed, so Windows SmartScreen may show a warning.

Recordings are saved to `Videos\PhoneFrame\<date and time>\`. Use **Open recording…** on the start screen to reopen one.

## Features

**Device simulation**
- Catalog of 25 devices (iPhone, Samsung Galaxy, Google Pixel, Xiaomi, iPad, Galaxy Tab) plus a custom width and height.
- Real CSS viewport size, device User-Agent, matching Client Hints and touch events.
- Frame drawn in CSS: bezel, rounded screen, side buttons, Dynamic Island, notch, punch-hole camera, status bar and bottom bar.
- The window shrinks to fit your screen while the site keeps seeing the device's real width.
- The page runs in an isolated, sandboxed `<webview>`; links that would open a new window open inside the phone.

**Recording**
- Captures the device window itself (no manual cropping) with the site's audio.
- H.264 video and AAC audio in MP4 at up to 60 fps.
- Records every tap and the cursor path, with a visible touch indicator while you record and a hidden system cursor in the video.

**Editor**
- Timeline with **Zoom**, **Cut**, **Speed** and **Text** tracks and an audio waveform.
- Auto-zoom generated from your taps, with a camera that follows the touch; zooms can also be pinned to a fixed point.
- Backgrounds: gradients, solid color or your own image, plus padding and shadow.
- Output: 16:9 or 9:16, 720p or 1080p, 30 or 60 fps. Export to H.264/AAC MP4.
- Undo/redo, autosave and keyboard shortcuts.

## Known limitations

- Windows x64 only for now.
- Export is MP4 only (no GIF).
- iPhone and iPad modes emulate width, User-Agent and touch on Chromium; pages are not rendered by Safari's engine.
- Device pixel ratio is not emulated, and devices are portrait only.

Architecture notes (in Portuguese) are in [`app/README.md`](app/README.md).

## License

PhoneFrame is licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). If you distribute PhoneFrame or a modified version, you must make the corresponding source code available under the same license. Third-party notices are in [`NOTICE.md`](NOTICE.md).

## Credits and acknowledgements

- [**Recordly**](https://github.com/webadderallorg/Recordly) by @webadderall (AGPL-3.0): the auto-zoom, cursor-following camera and zoom animations were ported from it. This is why PhoneFrame is AGPL-3.0. PhoneFrame is an independent project and does not use the Recordly name or branding as its own.
- [**OpenScreen**](https://github.com/siddharthvaddem/openscreen) by Siddharth Vaddem (MIT): the project Recordly started from.
- [**Mediabunny**](https://mediabunny.dev) by Vanilagy (MPL-2.0): MP4 reading, encoding and muxing.
- [**Electron**](https://www.electronjs.org/) and Chromium.

---

iPhone, Android, Galaxy, and Pixel are trademarks of their respective owners. PhoneFrame is an independent open-source project and is not affiliated with or endorsed by them.
