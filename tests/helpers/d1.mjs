import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export class LocalD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) this.db.exec(readFileSync(`drizzle/${file}`, 'utf8'));
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    const wrapper = (args = []) => ({
      bind: (...values) => wrapper(values),
      all: async () => ({ results: statement.all(...args) }),
      first: async () => statement.get(...args) ?? null,
      run: async () => { const result = statement.run(...args); return { ...result, meta: { changes: Number(result.changes) } }; },
    });
    return wrapper();
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
