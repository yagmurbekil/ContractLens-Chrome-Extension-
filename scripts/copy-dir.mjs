// Plain-JS recursive copy. Used instead of fs.cpSync, whose native implementation in
// recent Node versions fails on Windows when the path contains non-ASCII characters
// (e.g. C:\Users\MEHMETBEKİL\...).
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}
