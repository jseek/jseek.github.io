# Screenshot workflow

Use this to generate a deterministic screenshot of the site home page.

## One-time setup

```bash
npm install
npx playwright install chromium
```

## Capture screenshot

```bash
npm run screenshot
```

Output is written to `artifacts/home.png`.

## Optional overrides

```bash
SCREENSHOT_PORT=9000 SCREENSHOT_PATH=/late-for-the-train/ SCREENSHOT_OUT=artifacts/train.png npm run screenshot
```
