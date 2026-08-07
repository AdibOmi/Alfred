import { _electron as electron } from 'playwright-core';
import path from 'path';
import fs from 'fs';

const APP_DIR = 'D:\\Coding\\Projects\\Alfred';
const SHOT_DIR = 'C:\\Users\\USER\\AppData\\Local\\Temp\\claude\\d--Coding-Projects-Alfred\\b2b95f63-b120-42c4-9110-8b8c713076f2\\scratchpad';
const electronBin = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');

const consoleLogs = [];
const pageErrors = [];

console.log('Launching Electron from', APP_DIR, 'using binary', electronBin);

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_DIR],
  env: { ...process.env, ELECTRON_IS_DEV: '0' },
  timeout: 30000,
});

app.on('window', async (window) => {
  console.log('new window:', window.url());
});

await new Promise((resolve) => setTimeout(resolve, 4000));

const windows = app.windows();
console.log('windows count:', windows.length);
for (const w of windows) console.log(' -', w.url());

const page = windows.find((w) => !w.url().startsWith('devtools://')) ?? (await app.firstWindow());

page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => pageErrors.push(err.message));

// give the renderer a moment to finish its initial data fetches
await page.waitForTimeout(3000);

const shotPath = path.join(SHOT_DIR, 'alfred-screenshot.png');
await page.screenshot({ path: shotPath });
console.log('Screenshot saved to', shotPath);

const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '(failed to read body text)');
console.log('--- page innerText (first 1200 chars) ---');
console.log(bodyText.slice(0, 1200));

console.log('--- console messages ---');
consoleLogs.forEach((l) => console.log(l));
console.log('--- page errors ---');
pageErrors.forEach((e) => console.log(e));

await app.close();
console.log('done');
