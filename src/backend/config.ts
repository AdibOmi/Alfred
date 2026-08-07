import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

export function loadEnv(userDataPath: string) {
  const userEnvPath = path.join(userDataPath, '.env');
  if (fs.existsSync(userEnvPath)) {
    dotenv.config({ path: userEnvPath });
  }
  // Also load a project-root .env for `npm run dev`, without overriding values
  // already set from the user-data one above.
  dotenv.config();
}

export function getConfig() {
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    githubToken: process.env.GITHUB_TOKEN?.trim() || undefined,
    githubUsername: process.env.GITHUB_USERNAME?.trim() || undefined,
    leetcodeUsername: process.env.LEETCODE_USERNAME?.trim() || undefined,
  };
}
