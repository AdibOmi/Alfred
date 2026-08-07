import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

export interface SearchResult {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
}

const RESULT_CAP = 50;
const PER_ROOT_TIMEOUT_MS = 5000;

function defaultRoots(): string[] {
  const home = os.homedir();
  const candidates = ['Desktop', 'Documents', 'Downloads', 'Pictures'];
  return candidates.map((dir) => path.join(home, dir)).filter((dir) => fs.existsSync(dir));
}

function runProcess(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: options.env ?? process.env, windowsHide: true });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(stdout);
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(stdout);
    });
  });
}

let everythingAvailable: boolean | null = null;

async function isEverythingAvailable(): Promise<boolean> {
  if (everythingAvailable !== null) return everythingAvailable;
  const out = await runProcess('where', ['es'], { timeoutMs: 2000 });
  everythingAvailable = out.trim().length > 0;
  return everythingAvailable;
}

async function searchWithEverything(query: string): Promise<SearchResult[]> {
  const out = await runProcess('es', ['-n', String(RESULT_CAP), query], { timeoutMs: PER_ROOT_TIMEOUT_MS });
  const paths = out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const results: SearchResult[] = [];
  for (const filePath of paths) {
    try {
      const stat = fs.statSync(filePath);
      results.push({
        name: path.basename(filePath),
        path: filePath,
        isDirectory: stat.isDirectory(),
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    } catch {
      // file may have been removed between the index result and now; skip it
    }
  }
  return results;
}

const WINDOWS_SEARCH_SCRIPT = `
$q = $env:ALFRED_QUERY
$root = $env:ALFRED_ROOT
if (Test-Path -LiteralPath $root) {
  Get-ChildItem -LiteralPath $root -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "*$q*" } |
    Select-Object -First 50 FullName, Name, PSIsContainer, Length, LastWriteTime |
    ConvertTo-Json -Compress
}
`;

async function searchRootWindows(root: string, query: string): Promise<SearchResult[]> {
  const out = await runProcess(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SEARCH_SCRIPT],
    { env: { ...process.env, ALFRED_QUERY: query, ALFRED_ROOT: root }, timeoutMs: PER_ROOT_TIMEOUT_MS },
  );
  const trimmed = out.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item) => ({
      name: item.Name,
      path: item.FullName,
      isDirectory: Boolean(item.PSIsContainer),
      size: Number(item.Length) || 0,
      modified: item.LastWriteTime ? new Date(item.LastWriteTime).toISOString() : new Date(0).toISOString(),
    }));
  } catch {
    return [];
  }
}

async function searchRootPosix(root: string, query: string): Promise<SearchResult[]> {
  const command = process.platform === 'darwin' ? 'mdfind' : 'find';
  const args =
    process.platform === 'darwin'
      ? ['-onlyin', root, `kMDItemFSName == '*${query.replace(/'/g, '')}*'c`]
      : [root, '-iname', `*${query}*`];

  const out = await runProcess(command, args, { timeoutMs: PER_ROOT_TIMEOUT_MS });
  const paths = out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, RESULT_CAP);

  const results: SearchResult[] = [];
  for (const filePath of paths) {
    try {
      const stat = fs.statSync(filePath);
      results.push({
        name: path.basename(filePath),
        path: filePath,
        isDirectory: stat.isDirectory(),
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    } catch {
      // ignore vanished entries
    }
  }
  return results;
}

export async function searchFiles(query: string): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  if (process.platform === 'win32') {
    if (await isEverythingAvailable()) {
      return (await searchWithEverything(trimmedQuery)).slice(0, RESULT_CAP);
    }
    const roots = defaultRoots();
    const perRoot = await Promise.all(roots.map((root) => searchRootWindows(root, trimmedQuery)));
    return dedupeAndCap(perRoot.flat(), trimmedQuery);
  }

  const roots = defaultRoots();
  const perRoot = await Promise.all(roots.map((root) => searchRootPosix(root, trimmedQuery)));
  return dedupeAndCap(perRoot.flat(), trimmedQuery);
}

function dedupeAndCap(results: SearchResult[], query: string): SearchResult[] {
  const seen = new Set<string>();
  const unique = results.filter((result) => {
    if (seen.has(result.path)) return false;
    seen.add(result.path);
    return true;
  });

  const lowerQuery = query.toLowerCase();
  unique.sort((a, b) => {
    const aExact = a.name.toLowerCase() === lowerQuery ? 0 : 1;
    const bExact = b.name.toLowerCase() === lowerQuery ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return new Date(b.modified).getTime() - new Date(a.modified).getTime();
  });

  return unique.slice(0, RESULT_CAP);
}
