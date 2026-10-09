import { rmSync } from 'node:fs';
for (const target of ['dist', 'out', 'codeneat.vsix']) {
  rmSync(target, { recursive: true, force: true });
}
