// `npm run setup`: creates backend/.venv and installs the backend's packages into it. The desktop
// app starts the backend from that venv on its own, so this is the only Python step.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const backend = path.join(__dirname, '..', 'backend');
const venv = path.join(backend, '.venv');
const venvPython =
  process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');

function run(command, args) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: backend, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(result.error ? result.error.message : `exited with code ${result.status}`);
    process.exit(1);
  }
}

if (!fs.existsSync(venvPython)) {
  const candidates = process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python'];
  const python = candidates.find((cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0);
  if (!python) {
    console.error('Python 3.11+ is needed for the backend: https://www.python.org/downloads/');
    process.exit(1);
  }
  run(python, ['-m', 'venv', '.venv']);
}
run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', 'requirements.txt']);

const hasKey = ['.env', path.join('..', '.env')].some((file) => {
  try {
    return /^(GEMINI|GROQ)_API_KEY=\S+/m.test(fs.readFileSync(path.join(backend, file), 'utf8'));
  } catch {
    return false;
  }
});
console.log('\nBackend ready. Run `npm start`; the app starts the backend itself.');
if (!hasKey) {
  console.log(
    'No AI key found, so Alfred will run in demo mode. Put a free key in .env:\n' +
      '  GROQ_API_KEY=...    fastest  (https://console.groq.com/keys)\n' +
      '  GEMINI_API_KEY=...  most precise pointing  (https://aistudio.google.com/apikey)',
  );
}
