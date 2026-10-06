// Moves the real mouse pointer on Windows without native modules: one long-lived PowerShell
// process that P/Invokes user32!SetCursorPos. Other platforms keep the on-screen guide only.
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { Point } from './geometry';

const SETUP = `
Add-Type -Namespace Alfred -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'@
[Alfred.Native]::SetProcessDPIAware() | Out-Null
`;

let shell: ChildProcessWithoutNullStreams | null = null;

export function cursorMoveSupported(): boolean {
  return process.platform === 'win32';
}

function ensureShell(): ChildProcessWithoutNullStreams {
  if (shell && shell.exitCode === null && !shell.killed) return shell;
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
    windowsHide: true,
  });
  proc.on('error', () => {
    shell = null;
  });
  proc.stdout.resume();
  proc.stderr.resume();
  proc.stdin.write(SETUP + '\n');
  shell = proc;
  return proc;
}

/** Glides the pointer between two points given in physical screen pixels. */
export function glideCursor(from: Point, to: Point, durationMs = 450) {
  if (!cursorMoveSupported()) return;
  const proc = ensureShell();
  const frames = 18;
  for (let i = 1; i <= frames; i += 1) {
    const ease = 1 - Math.pow(1 - i / frames, 3);
    const x = Math.round(from.x + (to.x - from.x) * ease);
    const y = Math.round(from.y + (to.y - from.y) * ease);
    setTimeout(() => {
      if (proc.stdin.writable) proc.stdin.write(`[Alfred.Native]::SetCursorPos(${x}, ${y}) | Out-Null\n`);
    }, (durationMs / frames) * i);
  }
}

/** Starts PowerShell early so the first glide isn't delayed by Add-Type compiling. */
export function warmUpCursor() {
  if (cursorMoveSupported()) ensureShell();
}

export function disposeCursor() {
  if (!shell) return;
  try {
    shell.stdin.end();
    shell.kill();
  } catch {
    // already gone
  }
  shell = null;
}
