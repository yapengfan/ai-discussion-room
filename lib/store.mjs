import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export class Store {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); }
  async load() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error(`本地记录读取失败，请先保留 data 目录备份：${error.message}`); }
  }
  save(state) {
    const snapshot = JSON.stringify(state, null, 2);
    const task = async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, snapshot, 'utf8');
      await rename(`${this.file}.tmp`, this.file);
    };
    this.queue = this.queue.then(task, task);
    return this.queue;
  }
}
