import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';

import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import {
  deleteCredentialEntry,
  modifyCredentialEntry,
  readCredentialMap,
} from './oauth-credential-file.mjs';

const appDataRoot = process.env.DAO_APP_DATA_ROOT?.trim()
  ? path.resolve(process.env.DAO_APP_DATA_ROOT.trim())
  : process.cwd();
const oauthDir = path.resolve(appDataRoot, '.oauth');
const authStorePath = path.join(oauthDir, 'auth.json');

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const controller = new AbortController();
    const models = builtinModels({
      credentials: {
        async read(providerId) {
          return (await readCredentialMap(authStorePath))[providerId];
        },
        async list() {
          const entries = Object.entries(await readCredentialMap(authStorePath));
          const credentials = [];
          for (const [providerId, credential] of entries) {
            if (
              credential &&
              typeof credential === 'object' &&
              (credential.type === 'oauth' || credential.type === 'api_key')
            ) {
              credentials.push({ providerId, type: credential.type });
            }
          }
          return credentials;
        },
        async modify(providerId, update, options) {
          return modifyCredentialEntry(authStorePath, providerId, update, options);
        },
        async delete(providerId, options) {
          await deleteCredentialEntry(authStorePath, providerId, options);
        },
      },
    });
    await models.login('openai-codex', 'oauth', {
      signal: controller.signal,
      prompt: prompt => answerPrompt(rl, prompt),
      notify: event => notify(event),
    });

    console.log(`Saved OAuth auth map to ${authStorePath}`);
  } finally {
    rl.close();
  }
}

async function answerPrompt(rl, prompt) {
  if (prompt.type === 'select') {
    console.log(`\n${prompt.message}`);
    prompt.options.forEach((option, index) => {
      const description = option.description ? ` - ${option.description}` : '';
      console.log(`  ${index + 1}. ${option.label}${description}`);
    });
    const answer = (await rl.question('Select an option [1]: ')).trim();
    if (!answer) {
      return prompt.options[0]?.id || '';
    }
    const numericChoice = Number(answer);
    if (Number.isInteger(numericChoice) && prompt.options[numericChoice - 1]) {
      return prompt.options[numericChoice - 1].id;
    }
    return prompt.options.find(option => option.id === answer)?.id || answer;
  }

  const suffix = prompt.placeholder ? ` (${prompt.placeholder})` : '';
  return rl.question(
    `${prompt.message}${suffix}: `,
    prompt.signal ? { signal: prompt.signal } : undefined
  );
}

function notify(event) {
  if (event.type === 'auth_url') {
    console.log('\nOpen this URL in your local browser:\n');
    console.log(event.url);
    if (event.instructions) {
      console.log(`\n${event.instructions}`);
    }
    console.log(
      '\nIf the browser callback does not complete automatically, paste the redirect URL or the auth code below.\n'
    );
    return;
  }
  if (event.type === 'device_code') {
    console.log(`\nOpen ${event.verificationUri} and enter code ${event.userCode}.\n`);
    return;
  }
  if (event.type === 'info') {
    console.log(event.message);
    for (const link of event.links || []) {
      console.log(`${link.label || 'More information'}: ${link.url}`);
    }
    return;
  }
  console.log(event.message);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
