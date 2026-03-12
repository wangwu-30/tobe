import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';

import { loginOpenAICodex } from '@mariozechner/pi-ai/oauth';

const appDataRoot = process.env.DAO_APP_DATA_ROOT?.trim()
  ? path.resolve(process.env.DAO_APP_DATA_ROOT.trim())
  : process.cwd();
const oauthDir = path.resolve(appDataRoot, '.oauth');
const outputPath = path.join(oauthDir, 'openai-codex.json');
const authStorePath = path.join(oauthDir, 'auth.json');

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const credentials = await loginOpenAICodex({
      onAuth: ({ url, instructions }) => {
        console.log('\nOpen this URL in your local browser:\n');
        console.log(url);
        if (instructions) {
          console.log(`\n${instructions}\n`);
        }
        console.log(
          'If the browser callback does not complete automatically, paste the redirect URL or the auth code below.\n'
        );
      },
      onPrompt: async ({ message, placeholder }) => {
        const suffix = placeholder ? ` (${placeholder})` : '';
        return rl.question(`${message}${suffix}: `);
      },
      onProgress: (message) => {
        console.log(message);
      },
      originator: 'chengxing',
    });

    const payload = {
      ...credentials,
      accessToken: credentials.accessToken || credentials.access,
      refreshToken: credentials.refreshToken || credentials.refresh,
      expiresAt: credentials.expiresAt || credentials.expires,
      savedAt: new Date().toISOString(),
    };

    await fs.mkdir(oauthDir, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));
    const authStore = await readAuthStore();
    authStore['openai-codex'] = {
      type: 'oauth',
      ...payload,
    };
    await fs.writeFile(authStorePath, JSON.stringify(authStore, null, 2));

    console.log(`\nSaved OpenAI OAuth credentials to ${outputPath}`);
    console.log(`Saved OAuth auth map to ${authStorePath}`);
  } finally {
    rl.close();
  }
}

async function readAuthStore() {
  try {
    const raw = await fs.readFile(authStorePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
