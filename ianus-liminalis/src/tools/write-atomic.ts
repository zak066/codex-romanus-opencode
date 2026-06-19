import { open, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Write content to a file atomically:
 * 1. Ensure parent directory exists
 * 2. Write to a temp file
 * 3. fsync to guarantee data flush
 * 4. Atomic rename over the target
 */
export async function writeFileAtomically(filePath: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  const tempPath = filePath + '.tmp';
  const handle = await open(tempPath, 'w');
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, filePath);
}
