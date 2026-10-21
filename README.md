# Contao Smart Image Area

Automatically suggests Contao's **important image area** when an editor opens an image in the file manager. For Contao 5.7 (5.x), PHP 8.3+, and Symfony 7.4.

## How it works

1. **Faces first:** MediaPipe BlazeFace Sparse full-range locates faces. The selection includes all confidently detected faces, with some space around the heads.
2. **Other subjects:** if no faces are found, MediaPipe EfficientDet-Lite0 locates animals, people, vehicles and other supported objects. Large, confident subjects take priority over small incidental objects.
3. **Visual detail:** if neither model finds a subject, Smartcrop suggests a region from detail, contrast and colour. This also covers landscapes, architecture, graphics, and other subjects outside the detector's categories. It is a visual heuristic, not semantic recognition of arbitrary subjects.

The extension fills the existing draggable selection in Contao's preview. **Save** stores the selection in the original `tl_files.importantPartX/Y/Width/Height` fields. Contao's normal image processing then uses it for image sizes configured to crop using the important part. No additional tables or database migration are needed.

Saved selections are kept. Click **Detect area automatically** to explicitly replace an existing selection. Manual drawing cancels pending detection. Suggestions are not written to the database until the normal Contao form is saved. Opening and saving an image again uses the saved selection, without rerunning detection.

### What the editor sees

- **Detecting:** an orange sweep runs over the preview and the status reports the analysis.
- **Unsaved suggestion:** an orange frame labelled *Suggestion* replaces Contao's thin selection frame, and the rest of the image is dimmed. Dashed boxes mark the detected faces or subjects the area is based on. The status names the method and says whether the area is still unsaved or matches the saved one.
- **Own or saved selection:** drawing with the mouse, undoing or reopening the image returns to Contao's normal frame.

The second button appears only after a suggestion changed the selection. It reads **Discard suggestion** when there was no area before, and **Restore previous area** otherwise; both only reset the form values.

Existing and newly uploaded images both work when opened in the editor. This extension does not batch-process unopened files or perform detection during upload. Bulk edit forms without Contao's preview are left alone.

## Installation

In a standard Contao Managed Edition, install the published package from the project root:

```shell
composer require iotacb/contao-smart-image-area
```

Contao's normal Composer setup automatically discovers and registers the bundle, installs its public assets, and rebuilds the application cache. The AI models and browser runtime are included in the package. There are no additional installation commands, model downloads, npm builds, API keys, database migrations, or extension settings to configure.

Then open **Files → edit an image** with an account allowed to edit the four important-area fields. A proposed area appears automatically when there is no saved selection. Save normally to keep it. English and German labels are included.

Automatic setup uses the standard Managed Edition `post-install-cmd` / `post-update-cmd` integration with `contao-setup`; run Composer with scripts enabled. Custom applications that have removed this integration must provide their own Contao setup lifecycle.

### Working on the extension inside a Contao project

Clone the repository to `bundles/contao-smart-image-area` in the project root, add a Composer path repository for it, and require the development version:

```json
"repositories": [
    { "type": "path", "url": "bundles/*" }
]
```

```shell
composer require iotacb/contao-smart-image-area:@dev
```

The test scripts expect this location: they load the host's installed Contao, Symfony and MooTools files from two directories up.

## Local inference and size

Images are analysed from Contao's existing embedded preview, so protected originals never need a public URL. No image upload, external API, API key, external runtime CDN, or server-side AI installation is used. Inference runs in a Web Worker on the editor's computer; the original image file is never altered.

All required runtime assets are included under `public/vendor/`:

- BlazeFace Sparse full-range model: about 661 KiB.
- EfficientDet-Lite0 int8 model: about 4.4 MiB, requested only when no face is found.
- Shared MediaPipe runtime: about 13 MiB for browsers supporting SIMD; a non-SIMD runtime is also shipped. These are larger than the individual face model and are cached normally by the browser.
- Smartcrop 2.0.5: a small JavaScript fallback.

The full-range face model was chosen for general site photographs and group shots. Very small, occluded or rotated faces can still be missed. Object detection supports the model's 80 COCO classes, not every possible product or subject. Suggestions remain editable for these reasons.

Use a current browser with Web Workers, WebAssembly and OffscreenCanvas support. Serve `.wasm` files with `Content-Type: application/wasm` for streaming compilation. With a custom strict backend CSP, allow the local worker (`worker-src 'self'`), local scripts/model fetches, and WebAssembly (`script-src 'self' 'wasm-unsafe-eval'`, in addition to the backend's existing policy). Do not replace the existing backend policy wholesale. If AI cannot initialise, the worker uses Smartcrop and labels the result accordingly. If workers or image decoding themselves fail, the normal manual selection remains available.

## Development and verification

Published/local Composer installs use the included assets; Node.js is only needed to rebuild them or run the JavaScript checks:

```shell
npm ci
npm run assets
npm test
npx playwright install chromium
npm run test:browser
```

`npm run assets` copies pinned npm runtime files, downloads versioned Google models, validates the TensorFlow Lite file headers, and checks the resulting SHA-256 hashes against `public/vendor/manifest.json`. Rebuilding changed upstream assets fails until their changes are reviewed and the manifest is deliberately updated.

Browser tests use the **installed Contao 5.7 preview wizard and MooTools** from the host project, with real face/object inference, visual-detail fallback, missing models, saved selections, undo, manual drawing during inference, and submit cancellation. Test photos are downloaded from Google's MediaPipe sample assets into the ignored `tests/fixtures/` directory. Runtime requests are checked to remain on the local origin. Screenshots go to ignored `tests/artifacts/`. Set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome instead of Playwright's downloaded Chromium.

The PHP integration check uses the host's installed Contao/Symfony/Twig libraries:

```shell
php tests/integration.php
composer validate --strict
```

The following commands are optional developer verification, not installation steps. After changing the extension, run them in the actual host:

```shell
php vendor/bin/contao-console lint:container --env=prod
php vendor/bin/contao-console lint:yaml bundles/contao-smart-image-area/config bundles/contao-smart-image-area/translations
php vendor/bin/contao-console lint:twig bundles/contao-smart-image-area/contao/templates
```

Finally verify saving/reopening an image and a restricted editor account in the real backend. The browser harness checks the native form values and drawing behaviour; it does not simulate a database save or the host's authenticated backend.

## References

- [MediaPipe Solutions guide](https://developers.google.com/edge/mediapipe/solutions/guide)
- [Face detector Web API](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/web_js)
- [Object detector and supported models](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector)
- [Smartcrop](https://github.com/jwagner/smartcrop.js)

## License

This extension is licensed under the GNU Lesser General Public License v3.0 or later; see [LICENSE](LICENSE).

The bundled third-party assets keep their original licenses:

- MediaPipe runtime and models: Apache-2.0; see `public/vendor/MEDIAPIPE-LICENSE`.
- Smartcrop: MIT; see `public/vendor/SMARTCROP-LICENSE` and the source header.
