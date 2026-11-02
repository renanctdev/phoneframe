# Notices and attributions

PhoneFrame is free software distributed under the **GNU Affero General Public
License, version 3 only** (see [`LICENSE`](LICENSE)). It includes code derived
from third-party projects and bundles a third-party library. Their copyright
notices and licenses are reproduced or referenced below.

| Component | License | Copyright | Used for |
|---|---|---|---|
| PhoneFrame | AGPL-3.0-only | Copyright © 2026 Renan Cassiano Teixeira and PhoneFrame contributors | This application |
| Recordly | AGPL-3.0 | Copyright (C) 2026 webadderall | Ported zoom and camera-motion code |
| OpenScreen | MIT | Copyright (c) 2025 Siddharth Vaddem | Origin of Recordly |
| Mediabunny | MPL-2.0 | Copyright (c) 2026-present Vanilagy and contributors | MP4 reading, encoding and muxing |

## PhoneFrame

Copyright © 2026 Renan Cassiano Teixeira and PhoneFrame contributors.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, version 3 of the License.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

## Recordly

- Project: https://github.com/webadderallorg/Recordly
- Author: @webadderall
- License: GNU AGPL-3.0, Copyright (C) 2026 webadderall

Parts of Recordly were ported from TypeScript to JavaScript, with changes. This
is the reason PhoneFrame is distributed under the AGPL-3.0.

| PhoneFrame file | Recordly origin |
|---|---|
| `app/src/renderer/editor/motion/recordly.js` | `src/components/video-editor/videoPlayback/{mathUtils,motionSmoothing,zoomRegionUtils,cursorFollowCamera,focusUtils,cursorPosition,sceneMotion,zoomTransform}.ts` |
| `app/src/renderer/editor/motion/zoomSuggestions.js` | `src/components/video-editor/timeline/zoomSuggestionUtils.ts` |

The cursor telemetry format (`telemetry.json`, version 2) follows the one used by
Recordly.

"Recordly" is the name and brand of its author. PhoneFrame is an independent
project: it does not use the Recordly name or branding as its own, and it is not
affiliated with or endorsed by Recordly or its author. The name appears only to
credit the origin of the ported code, as the Recordly license requires.

## OpenScreen

- Project: https://github.com/siddharthvaddem/openscreen
- License: MIT, Copyright (c) 2025 Siddharth Vaddem

Recordly started as a fork of OpenScreen, and its license file carries the
OpenScreen notice. The files ported from Recordly may contain code that
originates in OpenScreen, so the notice is reproduced here:

```
Copyright (c) 2025 Siddharth Vaddem

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Mediabunny

- Project: https://mediabunny.dev (source: https://github.com/Vanilagy/mediabunny)
- License: Mozilla Public License 2.0, Copyright (c) 2026-present Vanilagy and
  contributors. The full text is in `app/src/renderer/vendor/mediabunny.LICENSE.txt`.
- File included **without modifications**: `app/src/renderer/vendor/mediabunny.mjs`
  (version 1.65.0, the `mediabunny.min.mjs` bundle of the npm package
  `mediabunny@1.65.0`). The Source Code Form of that version is available from
  the project links above.

This file is covered by the MPL-2.0 on its own terms. It does not carry the
"Incompatible With Secondary Licenses" notice, so the MPL-2.0 allows it to be
combined with the AGPL-3.0 code of PhoneFrame in a larger work.

## Electron and Chromium

The packaged application runs on [Electron](https://www.electronjs.org/)
(MIT) and Chromium. Their license files ship with every build as
`LICENSE.electron.txt` and `LICENSES.chromium.html` next to `PhoneFrame.exe`.

Development tools such as `electron-builder` and `rcedit` are used to build the
installer and are not part of the distributed application.
