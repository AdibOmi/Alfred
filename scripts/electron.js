// Runs Electron with ELECTRON_RUN_AS_NODE removed from its environment. VS Code's integrated
// terminal (and tools launched from it) set that variable, which turns the Electron binary into
// plain Node: the app then dies at startup with "Not running in an Electron environment!".
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, process.argv.slice(2), { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
