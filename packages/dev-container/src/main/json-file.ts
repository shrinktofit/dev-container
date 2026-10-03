import { mkdir, rename, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {
    });
    throw error;
  }
}
