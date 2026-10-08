// Windows screen helper: grabs the screen and reads the text on it, from one long-lived
// PowerShell process. No native modules and no downloads.
//
// - grab: GDI's CopyFromScreen, encoded to JPEG in-process. Tens of milliseconds, where
//   Electron's desktopCapturer renders thumbnails of every screen and takes 0.7-2 s. Windows
//   excluded from capture with SetWindowDisplayAffinity (Electron's content protection) are left
//   out of the grab, so Alfred's own windows never appear in it.
// - ocr: Windows' built-in OCR engine (Windows.Media.Ocr), a few tens of milliseconds warm, so
//   the pointer can land exactly on the element the model named.
//
// One request per stdin line, one JSON answer per stdout line, strictly in order. Other
// platforms report unsupported and callers fall back to Electron's capture and the model's box.
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { OcrLine } from '../shared/snap';

const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -Namespace Alfred -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
$null = [Alfred.Dpi]::SetProcessDPIAware()
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(); $task.Result }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$quality = New-Object System.Drawing.Imaging.EncoderParameters 1
$quality.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 82L

function Grab([int]$x, [int]$y, [int]$w, [int]$h, [int]$maxEdge) {
  $shot = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($shot)
  $g.CopyFromScreen($x, $y, 0, 0, $shot.Size)
  $g.Dispose()
  $scale = [Math]::Min(1.0, $maxEdge / [double][Math]::Max($w, $h))
  if ($scale -lt 1.0) {
    $sw = [int]($w * $scale); $sh = [int]($h * $scale)
    $small = New-Object System.Drawing.Bitmap $sw, $sh
    $g = [System.Drawing.Graphics]::FromImage($small)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
    $g.DrawImage($shot, 0, 0, $sw, $sh)
    $g.Dispose(); $shot.Dispose(); $shot = $small
  }
  $ms = New-Object IO.MemoryStream
  $shot.Save($ms, $jpeg, $quality)
  # Plain text rather than JSON: escaping a few hundred KB of base64 through ConvertTo-Json is slow.
  $out = "img $($shot.Width) $($shot.Height) " + [Convert]::ToBase64String($ms.ToArray())
  $shot.Dispose()
  return $out
}

function Read-Text([string]$b64) {
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $writer = New-Object Windows.Storage.Streams.DataWriter($stream)
  $writer.WriteBytes([Convert]::FromBase64String($b64))
  $null = Await ($writer.StoreAsync()) ([UInt32])
  $null = $writer.DetachStream()
  $stream.Seek(0)
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = foreach ($l in $result.Lines) { @{ t = $l.Text; w = @($l.Words | ForEach-Object { @{ t = $_.Text; x = [int]$_.BoundingRect.X; y = [int]$_.BoundingRect.Y; w = [int]$_.BoundingRect.Width; h = [int]$_.BoundingRect.Height } }) } }
  return @{ lines = @($lines) }
}

[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $parts = $line.Split(' ')
    if ($parts[0] -eq 'grab') { [Console]::Out.WriteLine((Grab $parts[1] $parts[2] $parts[3] $parts[4] $parts[5])) }
    else { [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 5 (Read-Text $parts[1]))) }
  } catch {
    [Console]::Out.WriteLine('{"error":true}')
  }
}
`;

// Past this, the caller carries on without the answer: OCR is a refinement, and a grab that
// stalls falls back to Electron's capture.
const TIMEOUT_MS = 2500;

type Answer = Record<string, unknown> | null;

let shell: ChildProcessWithoutNullStreams | null = null;
let buffer = '';
const pending: Array<(answer: Answer) => void> = [];

export function winScreenSupported(): boolean {
  return process.platform === 'win32';
}

function ensureShell(): ChildProcessWithoutNullStreams | null {
  if (!winScreenSupported()) return null;
  if (shell && shell.exitCode === null && !shell.killed) return shell;
  buffer = '';
  const proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')],
    { windowsHide: true },
  );
  proc.on('error', () => {
    shell = null;
  });
  proc.on('exit', () => {
    shell = null;
    // Anyone still waiting gets an empty answer rather than hanging.
    for (const resolve of pending.splice(0)) resolve(null);
  });
  proc.stderr.resume();
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line || line === 'ready') continue;
      const resolve = pending.shift();
      if (!resolve) continue;
      if (line.startsWith('img ')) {
        const [, width, height, image] = line.split(' ');
        resolve({ image, width: Number(width), height: Number(height) });
        continue;
      }
      try {
        const answer = JSON.parse(line) as Record<string, unknown>;
        resolve(answer.error ? null : answer);
      } catch {
        resolve(null);
      }
    }
  });
  shell = proc;
  return proc;
}

function send(request: string): Promise<Answer> {
  const proc = ensureShell();
  if (!proc || !proc.stdin.writable) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: Answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(answer);
    };
    // Answers come back strictly in order, so a timed-out request keeps its place in the queue
    // and its late answer is simply dropped.
    pending.push(finish);
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    proc.stdin.write(request + '\n');
  });
}

export interface GrabbedScreen {
  /** Bare base64 JPEG. */
  base64: string;
  width: number;
  height: number;
}

/** A JPEG of a rectangle of the screen in physical pixels, or null when unavailable. */
export async function grabScreen(
  rect: { x: number; y: number; width: number; height: number },
  maxEdge: number,
): Promise<GrabbedScreen | null> {
  const r = [rect.x, rect.y, rect.width, rect.height].map(Math.round);
  const answer = await send(`grab ${r.join(' ')} ${Math.round(maxEdge)}`);
  if (!answer || typeof answer.image !== 'string') return null;
  return { base64: answer.image, width: Number(answer.width), height: Number(answer.height) };
}

/** Text lines and word boxes (in the image's own pixels) for a JPEG or PNG. Empty when unavailable. */
export async function recognizeText(imageBase64: string): Promise<OcrLine[]> {
  const answer = await send(`ocr ${imageBase64}`);
  return (answer?.lines as OcrLine[] | undefined) ?? [];
}

/** Starts PowerShell and loads everything early, so the first question doesn't pay for it. */
export function warmUpWinScreen() {
  ensureShell();
}

export function disposeWinScreen() {
  if (!shell) return;
  try {
    shell.stdin.end();
    shell.kill();
  } catch {
    // already gone
  }
  shell = null;
}
