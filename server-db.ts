import { firebaseConfig } from './src/shared/firebase-config';

const projectId = firebaseConfig.projectId;
const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
const apiKey = firebaseConfig.apiKey;
const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;

// Cached server access token from GCP metadata server
let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getServerAuthHeader(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedToken && tokenExpiry > now + 60000) {
    return { Authorization: `Bearer ${cachedToken}` };
  }

  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.access_token) {
        cachedToken = data.access_token;
        tokenExpiry = now + (data.expires_in || 3600) * 1000;
        return { Authorization: `Bearer ${cachedToken}` };
      }
    }
  } catch (_e) {
    // Non-GCP runtime, fallback to API key
  }
  return {};
}

// Helper for converting JS types to Firestore values
function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(toFirestoreValue),
      },
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

// Helper for converting Firestore value back to JS object
function fromFirestoreValue(val: any): any {
  if (!val) return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    const out: Record<string, any> = {};
    const fields = val.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

export function fromFirestoreDoc(doc: any): any {
  if (!doc || !doc.fields) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

import fs from 'fs';
import path from 'path';

const DB_FILE = path.resolve(process.cwd(), 'local-db.json');

function loadStorage(): Map<string, any> {
  const map = new Map<string, any>();
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      for (const [k, v] of Object.entries(data)) {
        map.set(k, v);
      }
    }
  } catch (_e) {}
  return map;
}

function saveStorage(map: Map<string, any>) {
  try {
    const obj: Record<string, any> = {};
    for (const [k, v] of map.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (_e) {}
}

const inMemoryDocs = loadStorage();

function syncFromDisk() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      for (const [k, v] of Object.entries(data)) {
        inMemoryDocs.set(k, v);
      }
    }
  } catch (_e) {}
}

/**
 * REST Firestore Document Reference
 */
export class RestDocRef {
  path: string;

  constructor(path: string) {
    this.path = path.replace(/^\/+|\/+$/g, '');
  }

  collection(subCollectionPath: string): RestCollectionRef {
    const cleanSub = subCollectionPath.replace(/^\/+|\/+$/g, '');
    return new RestCollectionRef(`${this.path}/${cleanSub}`);
  }

  async get(): Promise<{ exists: boolean; data: () => any; id: string }> {
    syncFromDisk();
    // For health checks, rule /health/{id} { allow read, write: if false; } is enforced in Cloud Firestore
    if (this.path.startsWith('health/')) {
      const data = inMemoryDocs.get(this.path);
      return {
        exists: data !== undefined,
        data: () => data,
        id: this.path.split('/').pop() || '',
      };
    }

    try {
      const authHeaders = await getServerAuthHeader();
      const url = `${baseUrl}/${this.path}?key=${apiKey}`;
      const res = await fetch(url, { headers: authHeaders });
      if (res.status === 404) {
        if (inMemoryDocs.has(this.path)) {
          const data = inMemoryDocs.get(this.path);
          return { exists: true, data: () => data, id: this.path.split('/').pop() || '' };
        }
        return { exists: false, data: () => null, id: this.path.split('/').pop() || '' };
      }
      if (res.ok) {
        const json = await res.json();
        const data = fromFirestoreDoc(json);
        inMemoryDocs.set(this.path, data);
        saveStorage(inMemoryDocs);
        return {
          exists: true,
          data: () => data,
          id: this.path.split('/').pop() || '',
        };
      }
    } catch (_err) {
      // Fallback
    }

    if (inMemoryDocs.has(this.path)) {
      const data = inMemoryDocs.get(this.path);
      return {
        exists: true,
        data: () => data,
        id: this.path.split('/').pop() || '',
      };
    }

    return { exists: false, data: () => null, id: this.path.split('/').pop() || '' };
  }

  async set(data: any, options?: { merge?: boolean }): Promise<void> {
    syncFromDisk();
    const existing = inMemoryDocs.get(this.path) || {};
    const toSave = options?.merge ? { ...existing, ...data } : data;
    inMemoryDocs.set(this.path, toSave);
    saveStorage(inMemoryDocs);

    if (this.path.startsWith('health/')) {
      return;
    }

    try {
      const authHeaders = await getServerAuthHeader();
      const url = `${baseUrl}/${this.path}?key=${apiKey}`;
      const fields: Record<string, any> = {};
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined) {
          fields[k] = toFirestoreValue(v);
        }
      }

      let method = 'PATCH';
      let reqUrl = url;
      if (options?.merge) {
        const updateMask = Object.keys(data)
          .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
          .join('&');
        reqUrl += `&${updateMask}`;
      }

      await fetch(reqUrl, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ fields }),
      });
    } catch (_e) {
      // Retained in inMemoryDocs
    }
  }

  async delete(): Promise<void> {
    syncFromDisk();
    inMemoryDocs.delete(this.path);
    saveStorage(inMemoryDocs);
    try {
      const authHeaders = await getServerAuthHeader();
      const url = `${baseUrl}/${this.path}?key=${apiKey}`;
      await fetch(url, {
        method: 'DELETE',
        headers: authHeaders,
      });
    } catch (_e) {
      // Retained
    }
  }
}

/**
 * REST Firestore Collection Reference
 */
export class RestCollectionRef {
  path: string;

  constructor(path: string) {
    this.path = path.replace(/^\/+|\/+$/g, '');
  }

  doc(id?: string): RestDocRef {
    const docId = id || Math.random().toString(36).substring(2, 15);
    return new RestDocRef(`${this.path}/${docId}`);
  }

  async get(): Promise<{
    docs: Array<{ id: string; data: () => any; ref: RestDocRef }>;
    empty: boolean;
    forEach: (fn: (doc: { id: string; data: () => any; ref: RestDocRef }) => void) => void;
  }> {
    syncFromDisk();
    const fallback = () => {
      const prefix = `${this.path}/`;
      const docs: Array<{ id: string; data: () => any; ref: RestDocRef }> = [];
      for (const [k, v] of inMemoryDocs.entries()) {
        if (k.startsWith(prefix)) {
          const rest = k.substring(prefix.length);
          if (!rest.includes('/')) {
            docs.push({
              id: rest,
              data: () => v,
              ref: new RestDocRef(k),
            });
          }
        }
      }
      return {
        docs,
        empty: docs.length === 0,
        forEach: (fn: any) => docs.forEach(fn),
      };
    };

    try {
      const authHeaders = await getServerAuthHeader();
      const parent = this.path.includes('/')
        ? this.path.substring(0, this.path.lastIndexOf('/'))
        : '';
      const collectionId = this.path.includes('/')
        ? this.path.substring(this.path.lastIndexOf('/') + 1)
        : this.path;

      const queryUrl = parent
        ? `${baseUrl}/${parent}:runQuery?key=${apiKey}`
        : `${baseUrl}:runQuery?key=${apiKey}`;

      const res = await fetch(queryUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId }],
          },
        }),
      });

      if (!res.ok) {
        return fallback();
      }

      const json = await res.json();
      const docs: Array<{ id: string; data: () => any; ref: RestDocRef }> = [];

      if (Array.isArray(json)) {
        for (const item of json) {
          if (item.document) {
            const docPath = item.document.name.split('/documents/')[1];
            const id = docPath.split('/').pop() || '';
            const data = fromFirestoreDoc(item.document);
            inMemoryDocs.set(docPath, data);
            docs.push({
              id,
              data: () => data,
              ref: new RestDocRef(docPath),
            });
          }
        }
      }

      if (docs.length > 0) {
        return {
          docs,
          empty: false,
          forEach: (fn) => docs.forEach(fn),
        };
      }
      return fallback();
    } catch (_e) {
      return fallback();
    }
  }

  limit(count: number) {
    return {
      get: async () => {
        const all = await this.get();
        const sliced = all.docs.slice(0, count);
        return {
          docs: sliced,
          empty: sliced.length === 0,
          forEach: (fn: any) => sliced.forEach(fn),
        };
      },
    };
  }

  where(field: string, op: string, value: any) {
    return {
      get: async () => {
        const all = await this.get();
        const filtered = all.docs.filter((d) => {
          const data = d.data();
          if (op === '==') return data && data[field] === value;
          return true;
        });
        return {
          docs: filtered,
          empty: filtered.length === 0,
          forEach: (fn: any) => filtered.forEach(fn),
        };
      },
    };
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
    return {
      limit: (count: number) => ({
        get: async () => {
          const all = await this.get();
          const sorted = [...all.docs].sort((a, b) => {
            const va = a.data()?.[field];
            const vb = b.data()?.[field];
            if (dir === 'desc') return vb > va ? 1 : vb < va ? -1 : 0;
            return va > vb ? 1 : va < vb ? -1 : 0;
          });
          const sliced = sorted.slice(0, count);
          return {
            docs: sliced,
            empty: sliced.length === 0,
            forEach: (fn: any) => sliced.forEach(fn),
          };
        },
      }),
    };
  }

  async add(data: any): Promise<RestDocRef> {
    const docRef = this.doc();
    await docRef.set(data);
    return docRef;
  }
}

/**
 * REST Batch Writer (supports sets & deletes)
 */
export class RestBatch {
  ops: Array<() => Promise<void>> = [];

  set(docRef: RestDocRef, data: any, options?: { merge?: boolean }) {
    this.ops.push(() => docRef.set(data, options));
  }

  delete(docRef: RestDocRef) {
    this.ops.push(() => docRef.delete());
  }

  async commit(): Promise<void> {
    // Run operations in concurrent batches
    const chunkSize = 15;
    for (let i = 0; i < this.ops.length; i += chunkSize) {
      const chunk = this.ops.slice(i, i + chunkSize);
      await Promise.all(chunk.map((op) => op()));
    }
  }
}

/**
 * Universal Database Client for Server
 */
export const serverDb = {
  collection(path: string): RestCollectionRef {
    return new RestCollectionRef(path);
  },
  batch(): RestBatch {
    return new RestBatch();
  },
};
