# Conversion Studio

Conversion Studio is a static app for audio and image conversion.

- Audio conversion supports MP3, WAV, OGG, M4A, and FLAC output.
- Image conversion supports PNG, JPG, and WEBP output with optional resize and effects.
- No build step is required, so the repo can be deployed directly to GitHub Pages.

## Run

Serve the repository root as static files, then open `index.html`.

Example:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## GitHub Pages

This repo includes [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml),
so pushing to `main` will deploy the site through GitHub Actions.

## Notes

- FFmpeg is fully vendored in this repo under `vendor/ffmpeg/` and `vendor/ffmpeg-core/`, so local runs and GitHub Pages do not depend on a CDN.
- The first conversion can still take a moment because the browser has to initialize the bundled WebAssembly runtime.
- Image conversion works best with common browser and FFmpeg-supported formats.
