// End-to-end smoke test: `npm run selftest` with the backend running.
// Drives the real panel (sign up, a reminder through chat, a guided session, tasks,
// history, settings) and saves screenshots to docs/screenshots.
import fs from 'fs';
import path from 'path';
import { BrowserWindow, app, desktopCapturer, screen } from 'electron';
import type { AlfredWindow } from './window';
import type { Overlay } from './overlay';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// What the guided session looks at: a stand-in spreadsheet filling the display, so the test is
// repeatable and never sends whatever happens to be on the developer's real screen to the model.
const STAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 14px "Segoe UI", sans-serif; background: #fff; color: #222; }
  .title { background: #217346; color: #fff; padding: 6px 14px; font-size: 13px; }
  .tabs { display: flex; gap: 26px; background: #217346; color: #fff; padding: 6px 18px 8px; font-size: 15px; }
  .ribbon { display: flex; gap: 18px; background: #f3f3f3; border-bottom: 1px solid #d0d0d0; padding: 14px 18px; height: 70px; }
  .ribbon div { border: 1px solid #ccc; background: #fff; padding: 10px 14px; height: 24px; }
  table { border-collapse: collapse; margin: 18px; }
  td, th { border: 1px solid #d4d4d4; padding: 6px 18px; text-align: left; min-width: 90px; }
  th { background: #f3f3f3; }
</style></head><body>
  <div class="title">Book1 - Excel</div>
  <div class="tabs"><span>File</span><span>Home</span><span>Insert</span><span>Page Layout</span><span>Formulas</span><span>Data</span><span>Review</span><span>View</span></div>
  <div class="ribbon"><div>Paste</div><div>Cut</div><div>Copy</div><div>Bold</div><div>Merge &amp; Center</div><div>Conditional Formatting</div></div>
  <table><tr><th>Month</th><th>Sales</th></tr><tr><td>January</td><td>120</td></tr><tr><td>February</td><td>95</td></tr>
  <tr><td>March</td><td>140</td></tr><tr><td>April</td><td>80</td></tr></table>
</body></html>`;

// Runs inside the page: React ignores plain `.value =`, so go through the native setter.
const HELPERS = `
  window.__q = (sel) => document.querySelector(sel);
  window.__btn = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
  window.__type = (sel, value) => {
    const el = document.querySelector(sel);
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  true;
`;

export async function runSelftest(alfred: AlfredWindow, overlay: Overlay) {
  const out = process.env.ALFRED_SELFTEST_OUT || path.join(__dirname, '..', '..', 'docs', 'screenshots');
  fs.mkdirSync(out, { recursive: true });
  const page = alfred.window.webContents;
  const js = <T = unknown>(code: string): Promise<T> => page.executeJavaScript(code);
  const log = (...args: unknown[]) => console.log('[selftest]', ...args);

  const waitFor = async (code: string, label: string, timeout = 60_000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await js<boolean>(`!!(${code})`)) return;
      await wait(200);
    }
    throw new Error(`Timed out waiting for: ${label}`);
  };
  const open = async () => {
    alfred.window.show();
    alfred.expand();
    await waitFor("__q('.panel-shell')", 'panel to open');
  };
  const shoot = async (name: string) => {
    await wait(400);
    fs.writeFileSync(path.join(out, name), (await alfred.window.capturePage()).toPNG());
  };
  const ask = async (text: string) => {
    await js(`__type('.chat-input-row input', ${JSON.stringify(text)}); __q('.chat-input-row').requestSubmit(); true`);
  };
  // The page can be fine while the window is invisible or off-screen, so check real
  // screen pixels where a known element should be drawn.
  const assertOnScreen = async (selector: string, label: string) => {
    await wait(500);
    const rect = await js<{ x: number; y: number } | null>(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`,
    );
    if (!rect) throw new Error(`${label}: ${selector} not in the page`);
    const bounds = alfred.window.getBounds();
    const point = { x: bounds.x + rect.x, y: bounds.y + rect.y };
    const display = screen.getDisplayNearestPoint(point);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: display.size });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    const bitmap = source.thumbnail.toBitmap();
    const width = source.thumbnail.getSize().width;
    const i = (Math.round(point.y - display.bounds.y) * width + Math.round(point.x - display.bounds.x)) * 4;
    const [blue, green, red] = [bitmap[i], bitmap[i + 1], bitmap[i + 2]];
    const brightness = (red + green + blue) / 3;
    if (red > 180 && green < 80 && blue < 80) throw new Error(`${label}: another app is covering the panel`);
    const info = `window ${JSON.stringify(bounds)} visible=${alfred.window.isVisible()} opacity=${alfred.window.getOpacity()} pixel=${brightness.toFixed(0)}`;
    log(`${label}: ${info}`);
    if (brightness < 90) throw new Error(`${label}: panel is not visible on screen (${info})`);
  };

  const failIfError = async () => {
    const error = await js<string | null>("__q('.chat-entry.error p')?.textContent ?? null");
    if (error) throw new Error(`UI error: ${error}`);
  };

  try {
    if (page.isLoading()) await new Promise<void>((resolve) => page.once('did-finish-load', () => resolve()));
    await js(HELPERS);
    await wait(500);
    fs.writeFileSync(path.join(out, '00-icon.png'), (await alfred.window.capturePage()).toPNG());
    await open();
    await waitFor("__btn('Create account')", 'sign-in panel');
    await shoot('01-sign-in.png');

    const email = `selftest-${Date.now()}@example.com`;
    if (process.env.ALFRED_SELFTEST_API) {
      await js(`__q('.link-button').click(); true`);
      await waitFor("__q('input[placeholder^=\"http\"]')", 'server field');
      await js(`__type('input[placeholder^="http"]', ${JSON.stringify(process.env.ALFRED_SELFTEST_API)}); true`);
    }
    await js(`__btn('Create account').click(); true`);
    await waitFor("__q('input[autocomplete=name]')", 'sign-up form');
    await js(`
      __type('input[autocomplete=name]', 'Adib');
      __type('input[type=email]', '${email}');
      __type('input[type=password]', 'password123');
      __q('form.settings-form').requestSubmit(); true`);
    await waitFor("__q('.view-tabs')", 'signed-in tabs');
    log('signed up as', email);

    await ask('Remind me to submit the form at 4pm');
    await waitFor("[...document.querySelectorAll('.chat-entry.assistant p')].some(p => p.textContent.includes('Reminder set'))", 'reminder reply');
    await failIfError();
    log('reminder created through chat');

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const stage = new BrowserWindow({ ...display.bounds, show: false, frame: false, skipTaskbar: true });
    await stage.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(STAGE_HTML)}`);
    // Above ordinary apps (an editor that grabs focus would otherwise cover it), below Alfred.
    stage.setAlwaysOnTop(true, 'floating');
    stage.show();
    await wait(500);
    alfred.keepOnTop();
    await open();

    const started = Date.now();
    await ask('How do I make a pie chart from my table?');
    await waitFor("__q('.step-card') || __q('.chat-entry.error')", 'first guided step');
    await failIfError();
    log(`step 1 in ${Date.now() - started} ms:`, await js("__q('.step-text').textContent"));
    await wait(1800); // let the ghost cursor glide in
    await shoot('02-guided-step.png');
    await assertOnScreen('.step-actions .action-button', 'after step 1');
    fs.writeFileSync(path.join(out, '03-overlay.png'), (await overlay.window.capturePage()).toPNG());

    // The user clicks into their own app to do the step. Stand in for it with a red
    // window right over the panel: if Alfred drops out of the top-most band, it shows.
    const otherApp = new BrowserWindow({ ...alfred.window.getBounds(), show: false, frame: false, skipTaskbar: true });
    await otherApp.loadURL('data:text/html,<body style="margin:0;background:%23ff0000"></body>');
    otherApp.setAlwaysOnTop(true, 'floating');
    otherApp.show();
    otherApp.focus();
    await wait(800);
    await assertOnScreen('.step-actions .action-button', 'after clicking away');
    await js("__btn('Done, next step').click(); true");
    await waitFor("__q('.step-meta span')?.textContent.startsWith('Step 2') || __q('.chat-entry.error')", 'second step');
    await failIfError();
    log('step 2:', await js("__q('.step-text').textContent"));
    otherApp.focus();
    await assertOnScreen('.step-actions .action-button', 'after step 2');
    otherApp.destroy();
    stage.destroy();

    await js("__btn('✓ It worked').click(); true");
    await waitFor("!__q('.step-card')", 'session to finish');
    log('session marked solved');

    await open();
    await js("__btn('Tasks').click(); true");
    await waitFor("__q('.task-row')", 'task list');
    await shoot('04-tasks.png');

    await js("__btn('History').click(); true");
    await waitFor("__q('.session-row')", 'history list');
    await js("__q('.session-row').click(); true");
    await waitFor("__q('.session-steps li')", 'session steps');
    await shoot('05-history.png');

    await js("__q('[aria-label=Settings]').click(); true");
    await waitFor("__q('.settings-toggle-row')", 'settings');
    await shoot('06-settings.png');

    log('PASS, screenshots in', out);
    app.exit(0);
  } catch (error) {
    console.error('[selftest] FAIL', (error as Error).message);
    app.exit(1);
  }
}
