import { Router } from 'express';
import { getConfig } from '../config';

export function settingsRouter() {
  const router = Router();

  router.get('/', (_req, res) => {
    const config = getConfig();
    res.json({
      anthropicConfigured: Boolean(config.anthropicApiKey),
      githubConfigured: Boolean(config.githubUsername),
      githubAuthenticated: Boolean(config.githubToken),
      leetcodeConfigured: Boolean(config.leetcodeUsername),
      githubUsername: config.githubUsername ?? null,
      leetcodeUsername: config.leetcodeUsername ?? null,
    });
  });

  return router;
}
