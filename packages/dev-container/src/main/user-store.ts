import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GameUser } from '@bsgames/dev-container-api/game-config';
import { writeJsonFile } from './json-file.js';
export class UserStore {
  static async open(stateDirectory: string): Promise<UserStore> {
    const store = new UserStore(join(stateDirectory, 'users.json'));
    try {
      const file = JSON.parse(await readFile(store._path, 'utf8'));
      if (file.version !== 1 || !Array.isArray(file.users)
        || file.users.some((user: GameUser) => !user || typeof user.id !== 'string' || !/^[0-9a-f-]{36}$/.test(user.id) || typeof user.name !== 'string' || !user.name.trim())
        || new Set(file.users.map((user: GameUser) => user.id)).size !== file.users.length) {
        throw new Error('Invalid users file: ' + store._path);
      }
      store._users = file.users.map((user: GameUser) => ({ id: user.id, name: user.name }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    if (!store._users.length) {
      await store.create('Client 1');
    }
    return store;
  }

  async list(): Promise<GameUser[]> {
    await this._queue;
    return this._users.map((user) => ({
      ...user,
    }));
  }

  async get(id: string): Promise<GameUser> {
    const user = (await this.list()).find((item) => item.id === id);
    if (!user) {
      throw new Error('Unknown user: ' + id);
    }
    return user;
  }

  create(name: string): Promise<GameUser> {
    const user = {
      id: randomUUID(),
      name: this._checkName(name),
    };
    return this._change((users) => {
      users.push(user);
      return user;
    });
  }

  rename(id: string, name: string): Promise<GameUser> {
    const checked = this._checkName(name);
    return this._change((users) => {
      const index = users.findIndex((user) => user.id === id);
      if (index < 0) {
        throw new Error('Unknown user: ' + id);
      }
      return users[index] = {
        ...users[index],
        name: checked,
      };
    });
  }

  private constructor(private readonly _path: string) {
  }

  private _users: GameUser[] = [];
  private _queue: Promise<unknown> = Promise.resolve();
  private _checkName(name: string): string {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('User name is required.');
    }
    return name.trim();
  }

  private _change(action: (users: GameUser[]) => GameUser): Promise<GameUser> {
    const result = this._queue.then(async () => {
      const next = this._users.map((user) => ({
        ...user,
      }));
      const user = action(next);
      await writeJsonFile(this._path, {
        version: 1,
        users: next,
      });
      this._users = next;
      return {
        ...user,
      };
    });
    this._queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
