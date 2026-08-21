/**
 * In-memory store when MongoDB is not available.
 * Same API as MongoDB collections so routes work unchanged.
 */

function toIdString(oid: unknown): string {
  if (oid == null) return '';
  if (typeof oid === 'string') return oid;
  if (typeof (oid as { toString?: () => string }).toString === 'function') return (oid as { toString: () => string }).toString();
  return String(oid);
}

function match(doc: Record<string, unknown>, query: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(query)) {
    if (v == null) continue;
    const docVal = doc[k];
    if (k === '_id') {
      if (toIdString(docVal) !== toIdString(v)) return false;
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Record<string, unknown>).$set === undefined) {
      if (typeof docVal !== 'object' || docVal === null || !match(docVal as Record<string, unknown>, v as Record<string, unknown>)) return false;
    } else if (docVal !== v) {
      return false;
    }
  }
  return true;
}

function createCollection<T extends Record<string, unknown>>(): {
  findOne: (query: Record<string, unknown>) => Promise<T | null>;
  find: (query: Record<string, unknown>) => { 
    sort: (s: Record<string, number>) => any;
    limit: (n: number) => any;
    project: (p: Record<string, number>) => any;
    toArray: () => Promise<T[]>;
  };
  insertOne: (doc: Omit<T, '_id'> & { _id?: unknown }) => Promise<{ insertedId: { toString: () => string } }>;
  updateOne: (query: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => Promise<{ matchedCount: number }>;
  deleteOne: (query: Record<string, unknown>) => Promise<{ deletedCount: number }>;
  deleteMany: (query: Record<string, unknown>) => Promise<{ deletedCount: number }>;
  insertMany: (docs: (Omit<T, '_id'> & { _id?: unknown })[]) => Promise<{ insertedIds: Record<number, { toString: () => string }> }>;
  updateMany: (query: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => Promise<{ matchedCount: number; modifiedCount: number }>;
  countDocuments: (query: Record<string, unknown>) => Promise<number>;
} {
  const store: (T & { _id: string })[] = [];

  const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  return {
    async findOne(query: Record<string, unknown>) {
      const found = store.find((d) => match(d as Record<string, unknown>, query));
      return found ? (found as T) : null;
    },
    find(query: Record<string, unknown>) {
      const list = store.filter((d) => match(d as Record<string, unknown>, query)) as (T & { _id: string })[];
      let sorted = list;
      let limited = list;

      const cursor = {
        sort(s: Record<string, number>) {
          const key = Object.keys(s)[0];
          const dir = (s as Record<string, number>)[key];
          sorted = [...list].sort((a, b) => {
            const av = a[key as keyof typeof a] as string | number;
            const bv = b[key as keyof typeof b] as string | number;
            if (av < bv) return dir === -1 ? 1 : -1;
            if (av > bv) return dir === -1 ? -1 : 1;
            return 0;
          });
          limited = sorted;
          return cursor;
        },
        limit(n: number) {
          limited = sorted.slice(0, n);
          return cursor;
        },
        project(p: Record<string, number>) {
          // No-op mock for project
          return cursor;
        },
        async toArray() {
          return limited as T[];
        },
      };

      return cursor;
    },
    async insertOne(doc: Omit<T, '_id'> & { _id?: unknown }) {
      const id = doc._id != null ? toIdString(doc._id) : genId();
      const entry = { ...doc, _id: id } as T & { _id: string };
      store.push(entry);
      return { insertedId: { toString: () => id } };
    },
    async updateOne(query: Record<string, unknown>, update: { $set?: Record<string, unknown> }) {
      const idx = store.findIndex((d) => match(d as Record<string, unknown>, query));
      if (idx === -1) return { matchedCount: 0 };
      if (update.$set) {
        for (const [k, v] of Object.entries(update.$set)) {
          (store[idx] as Record<string, unknown>)[k] = v;
        }
      }
      return { matchedCount: 1 };
    },
    async deleteOne(query: Record<string, unknown>) {
      const idx = store.findIndex((d) => match(d as Record<string, unknown>, query));
      if (idx === -1) return { deletedCount: 0 };
      store.splice(idx, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(query: Record<string, unknown>) {
      let count = 0;
      for (let i = store.length - 1; i >= 0; i--) {
        if (match(store[i] as Record<string, unknown>, query)) {
          store.splice(i, 1);
          count++;
        }
      }
      return { deletedCount: count };
    },
    async insertMany(docs: (Omit<T, '_id'> & { _id?: unknown })[]) {
      const insertedIds: Record<number, { toString: () => string }> = {};
      docs.forEach((doc, i) => {
        const id = doc._id != null ? toIdString(doc._id) : genId();
        const entry = { ...doc, _id: id } as T & { _id: string };
        store.push(entry);
        insertedIds[i] = { toString: () => id };
      });
      return { insertedIds };
    },
    async updateMany(query: Record<string, unknown>, update: { $set?: Record<string, unknown> }) {
      let count = 0;
      for (let i = 0; i < store.length; i++) {
        if (match(store[i] as Record<string, unknown>, query)) {
          if (update.$set) {
            for (const [k, v] of Object.entries(update.$set)) {
              (store[i] as Record<string, unknown>)[k] = v;
            }
          }
          count++;
        }
      }
      return { matchedCount: count, modifiedCount: count };
    },
    async countDocuments(query: Record<string, unknown>) {
      return store.filter((d) => match(d as Record<string, unknown>, query)).length;
    },
  };
}

export type MemoryDb = {
  collection: (name: string) => ReturnType<typeof createCollection>;
};

const collections: Record<string, ReturnType<typeof createCollection>> = {};

export function getMemoryDb(): MemoryDb {
  return {
    collection(name: string) {
      if (!collections[name]) collections[name] = createCollection();
      return collections[name];
    },
  };
}
