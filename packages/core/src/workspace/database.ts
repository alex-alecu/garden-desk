import { DatabaseSync, type SQLInputValue } from "node:sqlite";

interface PragmaOptions {
  simple?: boolean;
}

interface StatementChanges {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

interface GardenDeskStatement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): StatementChanges;
}

export class GardenDeskDatabase {
  private readonly database: DatabaseSync;
  private savepointSequence = 0;

  constructor(path: string) {
    this.database = new DatabaseSync(path, { allowExtension: false, defensive: true });
  }

  close(): void {
    this.database.close();
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  prepare(sql: string): GardenDeskStatement {
    const statement = this.database.prepare(sql);
    const parameters = (values: unknown[]) => values as SQLInputValue[];
    return {
      all: (...values) => statement.all(...parameters(values)),
      get: (...values) => statement.get(...parameters(values)),
      run: (...values) => statement.run(...parameters(values)),
    };
  }

  pragma(statement: string, options: PragmaOptions = {}): unknown {
    const rows = this.prepare(`PRAGMA ${statement}`).all();
    if (options.simple !== true) return rows;
    const row = rows[0];
    return row === undefined ? undefined : Object.values(row as Record<string, unknown>)[0];
  }

  private beginTransaction(): string | undefined {
    const savepoint = this.database.isTransaction
      ? `garden_desk_nested_${this.savepointSequence++}`
      : undefined;
    this.exec(savepoint === undefined ? "BEGIN" : `SAVEPOINT ${savepoint}`);
    return savepoint;
  }

  private commitTransaction(savepoint: string | undefined): void {
    this.exec(savepoint === undefined ? "COMMIT" : `RELEASE ${savepoint}`);
  }

  private rollbackTransaction(savepoint: string | undefined): void {
    if (!this.database.isTransaction) return;
    if (savepoint === undefined) this.exec("ROLLBACK");
    else {
      this.exec(`ROLLBACK TO ${savepoint}`);
      this.exec(`RELEASE ${savepoint}`);
    }
  }

  transaction<T>(operation: () => T): () => T {
    return () => {
      const savepoint = this.beginTransaction();
      try {
        const result = operation();
        this.commitTransaction(savepoint);
        return result;
      } catch (error) {
        this.rollbackTransaction(savepoint);
        throw error;
      }
    };
  }
}

export type DatabasePort = Pick<
  GardenDeskDatabase,
  "close" | "exec" | "pragma" | "prepare" | "transaction"
>;
