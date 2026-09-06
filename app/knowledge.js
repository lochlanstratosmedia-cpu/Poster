// The playbook is a markdown file so it can be read on GitHub and edited
// without touching code. The server loads it once at startup and feeds it to
// the scoring and coaching prompts as a cached system prompt.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, 'playbook.md');

export const PLAYBOOK = fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8')
  : 'Playbook not found. Add app/playbook.md.';
