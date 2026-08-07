import { Router } from 'express';
import { searchFiles } from '../fileSearch';

// Required lazily (not at module load) so the backend can also run standalone
// under plain Node for local dev/testing without pulling in the Electron runtime.
function getShell(): typeof import('electron').shell {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('electron').shell;
}

export function searchRouter() {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    if (!query.trim()) return res.json({ results: [] });

    try {
      const results = await searchFiles(query);
      res.json({ results });
    } catch (error) {
      res.status(500).json({ error: 'search failed', detail: (error as Error).message });
    }
  });

  router.post('/open', (req, res) => {
    const { path: targetPath, reveal } = req.body ?? {};
    if (typeof targetPath !== 'string' || !targetPath) {
      return res.status(400).json({ error: 'path is required' });
    }
    const shell = getShell();
    if (reveal) {
      shell.showItemInFolder(targetPath);
    } else {
      shell.openPath(targetPath).then((errorMessage) => {
        if (errorMessage) console.error('shell.openPath failed:', errorMessage);
      });
    }
    res.status(204).end();
  });

  return router;
}
