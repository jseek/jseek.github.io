#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.SCREENSHOT_PORT || 8000);
const host = process.env.SCREENSHOT_HOST || '127.0.0.1';
const path = process.env.SCREENSHOT_PATH || '/';
const output = process.env.SCREENSHOT_OUT || 'artifacts/home.png';
const viewport = {
  width: Number(process.env.SCREENSHOT_WIDTH || 1280),
  height: Number(process.env.SCREENSHOT_HEIGHT || 720),
};

const loadChromium = async () => {
  try {
    const playwright = await import('playwright');
    return playwright.chromium;
  } catch {
    console.error('Missing dependency: playwright.');
    console.error('Run: npm install && npx playwright install chromium');
    process.exit(1);
  }
};

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', host], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverReady = false;
let serverLog = '';

const markReady = (chunk) => {
  const text = chunk.toString();
  serverLog += text;
  if (text.includes('Serving HTTP on')) serverReady = true;
};

server.stdout.on('data', markReady);
server.stderr.on('data', markReady);

const cleanup = () => {
  if (!server.killed) server.kill('SIGINT');
};

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

const waitForServer = async (timeoutMs = 10_000) => {
  const start = Date.now();
  while (!serverReady) {
    if (server.exitCode !== null) {
      throw new Error(`http.server exited early with code ${server.exitCode}\n${serverLog}`);
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for http.server\n${serverLog}`);
    }
    await delay(100);
  }
};

const ensureDir = async (targetPath) => {
  const { dirname } = await import('node:path');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dirname(targetPath), { recursive: true });
};

(async () => {
  try {
    const chromium = await loadChromium();
    await waitForServer();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport });
    const url = `http://${host}:${port}${path}`;

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    await ensureDir(output);
    await page.screenshot({ path: output, fullPage: true });

    console.log(`Saved screenshot to ${output}`);
    console.log(`URL: ${url}`);
    console.log(`Title: ${await page.title()}`);

    await browser.close();
    cleanup();
  } catch (error) {
    cleanup();
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
