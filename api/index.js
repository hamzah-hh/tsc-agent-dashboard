// api/_source.ts
import express2 from "express";

// server-routes.ts
import express from "express";
import crypto2 from "crypto";

// server-firebase-admin.ts
import { applicationDefault, cert, deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import crypto from "crypto";
import fs2 from "fs";
import path2 from "path";
import { AsyncLocalStorage } from "async_hooks";

// firebase-applet-config.json
var firebase_applet_config_default = {
  projectId: "gen-lang-client-0478467927",
  appId: "1:932367651273:web:0fc6ae7cbf666fc22d1818",
  apiKey: "AIzaSyCRekiwg7u6Z-POxjKqCeaYHikz7wrDuGI",
  authDomain: "gen-lang-client-0478467927.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-tscagentdashboar-4a25c7aa-a6fe-4950-9680-a3794ae11803",
  storageBucket: "gen-lang-client-0478467927.firebasestorage.app",
  messagingSenderId: "932367651273",
  measurementId: "",
  oAuthClientId: "932367651273-2nk1eauq7oo73e9osrvbe3p185i99c4e.apps.googleusercontent.com",
  recaptchaSiteKey: ""
};

// src/shared/firebase-config.ts
var firebaseConfig = {
  projectId: firebase_applet_config_default.projectId || "",
  appId: firebase_applet_config_default.appId || "",
  apiKey: firebase_applet_config_default.apiKey || "",
  authDomain: firebase_applet_config_default.authDomain || "",
  firestoreDatabaseId: firebase_applet_config_default.firestoreDatabaseId || "(default)",
  storageBucket: firebase_applet_config_default.storageBucket || "",
  messagingSenderId: firebase_applet_config_default.messagingSenderId || "",
  measurementId: firebase_applet_config_default.measurementId || "",
  oAuthClientId: firebase_applet_config_default.oAuthClientId || "",
  recaptchaSiteKey: firebase_applet_config_default.recaptchaSiteKey || ""
};

// server-db.ts
import fs from "fs";
import path from "path";
function toFirestoreValue(val) {
  if (val === null || val === void 0) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return { nullValue: null };
    if (Number.isInteger(val) && Math.abs(val) <= Number.MAX_SAFE_INTEGER) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== void 0) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}
function fromFirestoreValue(val) {
  if (!val || typeof val !== "object") return null;
  if ("nullValue" in val) return null;
  if ("booleanValue" in val) return val.booleanValue;
  if ("integerValue" in val) return Number(val.integerValue);
  if ("doubleValue" in val) return Number(val.doubleValue);
  if ("stringValue" in val) return val.stringValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("referenceValue" in val) return val.referenceValue;
  if ("arrayValue" in val) return (val.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in val) {
    const out = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) out[k] = fromFirestoreValue(v);
    return out;
  }
  return null;
}
function fromFirestoreDoc(doc) {
  if (!doc) return null;
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fromFirestoreValue(v);
  return out;
}
var MAX_WRITES_PER_COMMIT = 400;
function cleanPath(p) {
  return p.replace(/^\/+|\/+$/g, "");
}
function clone(v) {
  return v === void 0 ? v : JSON.parse(JSON.stringify(v));
}
var FirestoreError = class extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "FirestoreError";
    this.status = status;
  }
};
var RETRYABLE = /* @__PURE__ */ new Set([408, 429, 500, 502, 503, 504]);
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function urlPath(p) {
  return p.split("/").map((s) => encodeURIComponent(s).replace(/%40/g, "@")).join("/");
}
function fieldPathToken(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : "`" + key.replace(/[\\`]/g, "\\$&") + "`";
}
var FirestoreRestBackend = class {
  constructor(opts) {
    this.kind = "firestore";
    this.opts = opts;
  }
  get base() {
    if (this.opts.restBase) return this.opts.restBase.replace(/\/+$/, "");
    if (this.opts.emulatorHost) return `http://${this.opts.emulatorHost}/v1`;
    return "https://firestore.googleapis.com/v1";
  }
  get root() {
    if (!this.opts.projectId) {
      throw new FirestoreError(
        "The Firebase project id is empty. Put the live project's settings in firebase-applet-config.json (see firebase-config.example.json)."
      );
    }
    return `projects/${this.opts.projectId}/databases/${this.opts.databaseId || "(default)"}/documents`;
  }
  async prepare(url) {
    const headers = {};
    if (this.opts.emulatorHost) {
      headers.Authorization = "Bearer owner";
      return { url, headers, authed: true };
    }
    let token = null;
    try {
      token = this.opts.tokenProvider ? await this.opts.tokenProvider() : null;
    } catch (_e) {
      token = null;
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      return { url, headers, authed: true };
    }
    if (this.opts.apiKey) url += (url.includes("?") ? "&" : "?") + `key=${encodeURIComponent(this.opts.apiKey)}`;
    return { url, headers, authed: false };
  }
  explain(status, payload, what, authed) {
    const err = Array.isArray(payload) ? payload[0]?.error : payload?.error;
    const code = err?.status ? ` ${err.status}` : "";
    const detail = err?.message ? `: ${err.message}` : "";
    let hint = "";
    if (status === 401 || status === 403) {
      hint = authed ? ` The server's service account may lack access: give it the "Cloud Datastore User" role on the Firebase project, and check that the project id in firebase-applet-config.json is the live project.` : " The server has no Google credentials, so it called Firestore anonymously and the security rules refused it. On Cloud Run this is automatic (service account); on a PC set GOOGLE_APPLICATION_CREDENTIALS.";
    } else if (status === 404) {
      hint = " The Firestore database was not found: create it in the Firebase console (Build > Firestore Database > Create database) and check firestoreDatabaseId in firebase-applet-config.json.";
    }
    return `Firestore ${what} failed: HTTP ${status}${code}${detail}.${hint}`;
  }
  /** One JSON request with a timeout and up to 3 tries on network errors / 5xx / 429. All calls are idempotent. */
  async call(method, urlPath2, body, what, allow404 = false) {
    const prepared = await this.prepare(`${this.base}/${urlPath2}`);
    let lastNetworkError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(prepared.url, {
          method,
          headers: body !== void 0 ? { ...prepared.headers, "Content-Type": "application/json" } : prepared.headers,
          body: body !== void 0 ? JSON.stringify(body) : void 0,
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 2e4)
        });
        const text = await res.text();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (_e) {
          json = null;
        }
        if (res.ok) return { status: res.status, json };
        if (res.status === 404 && allow404) return { status: 404, json };
        if ((res.status === 401 || res.status === 403) && this.opts.contextTokenProvider) {
          const userToken = this.opts.contextTokenProvider();
          if (userToken && prepared.headers.Authorization !== `Bearer ${userToken}`) {
            try {
              const fallbackHeaders = {
                ...prepared.headers,
                Authorization: `Bearer ${userToken}`,
                ...body !== void 0 ? { "Content-Type": "application/json" } : {}
              };
              const fbRes = await fetch(prepared.url, {
                method,
                headers: fallbackHeaders,
                body: body !== void 0 ? JSON.stringify(body) : void 0,
                signal: AbortSignal.timeout(this.opts.timeoutMs ?? 2e4)
              });
              const fbText = await fbRes.text();
              let fbJson = null;
              try {
                fbJson = fbText ? JSON.parse(fbText) : null;
              } catch (_e) {
                fbJson = null;
              }
              if (fbRes.ok) return { status: fbRes.status, json: fbJson };
              if (fbRes.status === 404 && allow404) return { status: 404, json: fbJson };
            } catch (_fallbackErr) {
            }
          }
        }
        if (RETRYABLE.has(res.status) && attempt < 2) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        throw new FirestoreError(this.explain(res.status, json, what, prepared.authed), res.status);
      } catch (err) {
        if (err instanceof FirestoreError) throw err;
        lastNetworkError = err;
        if (attempt < 2) await sleep(300 * (attempt + 1));
      }
    }
    throw new FirestoreError(
      `Firestore ${what} failed: cannot reach the database (${lastNetworkError?.message || "network error"}).`
    );
  }
  async getDoc(docPath) {
    const p = cleanPath(docPath);
    const { status, json } = await this.call("GET", `${this.root}/${urlPath(p)}`, void 0, `read of ${p}`, true);
    if (status === 404) return null;
    return fromFirestoreDoc(json);
  }
  async listDocs(collectionPath, query = {}) {
    const p = cleanPath(collectionPath);
    const parts = p.split("/");
    const collectionId = parts[parts.length - 1];
    const parent = parts.slice(0, -1).join("/");
    const structuredQuery = { from: [{ collectionId }] };
    const filters = (query.where || []).map((w) => ({
      fieldFilter: { field: { fieldPath: fieldPathToken(w.field) }, op: "EQUAL", value: toFirestoreValue(w.value) }
    }));
    if (filters.length === 1) structuredQuery.where = filters[0];
    else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: "AND", filters } };
    if (query.orderBy) {
      structuredQuery.orderBy = [
        {
          field: { fieldPath: fieldPathToken(query.orderBy.field) },
          direction: query.orderBy.dir === "desc" ? "DESCENDING" : "ASCENDING"
        }
      ];
    }
    if (query.limit !== void 0) structuredQuery.limit = query.limit;
    const { json } = await this.call(
      "POST",
      `${this.root}${parent ? "/" + urlPath(parent) : ""}:runQuery`,
      { structuredQuery },
      `query of ${p}`
    );
    const docs = [];
    for (const item of Array.isArray(json) ? json : []) {
      if (!item?.document) continue;
      const docPath = String(item.document.name).split("/documents/")[1];
      docs.push({ id: docPath.split("/").pop() || "", path: docPath, data: fromFirestoreDoc(item.document) });
    }
    return docs;
  }
  async commit(writes) {
    if (writes.length === 0) return;
    if (writes.length > MAX_WRITES_PER_COMMIT) {
      throw new Error(`commit() takes at most ${MAX_WRITES_PER_COMMIT} writes, got ${writes.length}`);
    }
    const root = this.root;
    const body = {
      writes: writes.map((w) => {
        const p = cleanPath(w.path);
        if (w.op === "delete") return { delete: `${root}/${p}` };
        const fields = {};
        for (const [k, v] of Object.entries(w.data || {})) if (v !== void 0) fields[k] = toFirestoreValue(v);
        return {
          update: { name: `${root}/${p}`, fields },
          // merge = only the listed top-level fields change; without a mask the document is replaced
          ...w.merge ? { updateMask: { fieldPaths: Object.keys(fields).map(fieldPathToken) } } : {}
        };
      })
    };
    await this.call("POST", `${root}:commit`, body, `write of ${writes.length} document(s) (${writes[0].path}${writes.length > 1 ? ", ..." : ""})`);
  }
};
var LocalBackend = class {
  constructor(file) {
    this.kind = "local";
    this.docs = /* @__PURE__ */ new Map();
    this.file = file ? path.resolve(process.cwd(), file) : null;
    if (this.file && fs.existsSync(this.file)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
        for (const [k, v] of Object.entries(data)) this.docs.set(k, v);
      } catch (_e) {
      }
    }
  }
  persist() {
    if (!this.file) return;
    fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.docs), null, 2), "utf8");
  }
  async getDoc(docPath) {
    const v = this.docs.get(cleanPath(docPath));
    return v === void 0 ? null : clone(v);
  }
  async listDocs(collectionPath, query = {}) {
    const prefix = cleanPath(collectionPath) + "/";
    let out = [];
    for (const [k, v] of this.docs.entries()) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      if (rest.includes("/")) continue;
      out.push({ id: rest, path: k, data: clone(v) });
    }
    for (const w of query.where || []) out = out.filter((d) => d.data && d.data[w.field] === w.value);
    if (query.orderBy) {
      const { field, dir } = query.orderBy;
      out.sort((a, b) => {
        const va = a.data?.[field];
        const vb = b.data?.[field];
        const c = va > vb ? 1 : va < vb ? -1 : 0;
        return dir === "desc" ? -c : c;
      });
    }
    if (query.limit !== void 0) out = out.slice(0, query.limit);
    return out;
  }
  async commit(writes) {
    for (const w of writes) {
      const p = cleanPath(w.path);
      if (w.op === "delete") {
        this.docs.delete(p);
      } else if (w.merge) {
        this.docs.set(p, { ...this.docs.get(p) || {}, ...clone(w.data) });
      } else {
        this.docs.set(p, clone(w.data));
      }
    }
    this.persist();
  }
};
function querySnap(docs) {
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}
var DocRef = class {
  constructor(db, docPath) {
    this.db = db;
    this.path = cleanPath(docPath);
  }
  get id() {
    return this.path.split("/").pop() || "";
  }
  collection(sub) {
    return new CollectionRef(this.db, `${this.path}/${cleanPath(sub)}`);
  }
  async get() {
    const data = await this.db.backend().getDoc(this.path);
    return { id: this.id, exists: data !== null, data: () => data === null ? void 0 : data, ref: this };
  }
  async set(data, options) {
    await this.db.backend().commit([{ op: "set", path: this.path, data, merge: options?.merge }]);
  }
  async delete() {
    await this.db.backend().commit([{ op: "delete", path: this.path }]);
  }
};
var Query = class _Query {
  constructor(db, collectionPath, opts = {}) {
    this.db = db;
    this.collectionPath = collectionPath;
    this.opts = opts;
  }
  where(field, op, value) {
    if (op !== "==") throw new Error(`Only "==" filters are supported (got "${op}")`);
    return new _Query(this.db, this.collectionPath, {
      ...this.opts,
      where: [...this.opts.where || [], { field, value }]
    });
  }
  orderBy(field, dir = "asc") {
    return new _Query(this.db, this.collectionPath, { ...this.opts, orderBy: { field, dir } });
  }
  limit(count) {
    return new _Query(this.db, this.collectionPath, { ...this.opts, limit: count });
  }
  async get() {
    const found = await this.db.backend().listDocs(this.collectionPath, this.opts);
    return querySnap(
      found.map((d) => ({
        id: d.id,
        exists: true,
        data: () => d.data,
        ref: new DocRef(this.db, d.path)
      }))
    );
  }
};
var CollectionRef = class extends Query {
  constructor(db, collectionPath) {
    super(db, cleanPath(collectionPath));
  }
  get path() {
    return this.collectionPath;
  }
  doc(id) {
    const docId = id || Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    return new DocRef(this.db, `${this.collectionPath}/${docId}`);
  }
  async add(data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
};
var Batch = class {
  constructor(db) {
    this.db = db;
    this.writes = [];
  }
  set(ref, data, options) {
    this.writes.push({ op: "set", path: ref.path, data, merge: options?.merge });
    return this;
  }
  delete(ref) {
    this.writes.push({ op: "delete", path: ref.path });
    return this;
  }
  get size() {
    return this.writes.length;
  }
  /** Saves everything, in commits of at most 400 writes. Throws on the first failed commit. */
  async commit() {
    for (let i = 0; i < this.writes.length; i += MAX_WRITES_PER_COMMIT) {
      await this.db.backend().commit(this.writes.slice(i, i + MAX_WRITES_PER_COMMIT));
    }
    this.writes = [];
  }
};
var Db = class {
  constructor(getBackend) {
    this.getBackend = getBackend;
  }
  backend() {
    return this.getBackend();
  }
  get kind() {
    return this.getBackend().kind;
  }
  collection(collectionPath) {
    return new CollectionRef(this, collectionPath);
  }
  batch() {
    return new Batch(this);
  }
  /** Writes health/ping and reads it back. Throws with the reason when the database is not usable. */
  async healthCheck() {
    const time = (/* @__PURE__ */ new Date()).toISOString();
    await this.backend().commit([{ op: "set", path: "health/ping", data: { time } }]);
    const back = await this.backend().getDoc("health/ping");
    if (!back || back.time !== time) {
      throw new Error("Health ping verify failed: the value read back does not match the value written.");
    }
  }
};
function createDb(getBackend) {
  return new Db(getBackend);
}
function createFirestoreBackend(opts) {
  return new FirestoreRestBackend(opts);
}
function createLocalBackend(file) {
  return new LocalBackend(file);
}

// server-env.ts
import dotenv from "dotenv";
var loaded = false;
function loadEnv() {
  if (loaded) return;
  loaded = true;
  dotenv.config({ path: [".env.local", ".env"], quiet: true });
}

// server-service-account.ts
var fallbackServiceAccount = {
  type: "service_account",
  project_id: "tsc-data-506812",
  private_key_id: "",
  private_key: "",
  client_email: "firebase-adminsdk-fbsvc@tsc-data-506812.iam.gserviceaccount.com",
  client_id: "",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40tsc-data-506812.iam.gserviceaccount.com",
  universe_domain: "googleapis.com"
};

// server-firebase-admin.ts
loadEnv();
var requestContext = new AsyncLocalStorage();
function getServiceAccountCredential() {
  let saRaw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GCP_SERVICE_ACCOUNT;
  if (!saRaw) {
    const candidatePaths = [
      path2.resolve(process.cwd(), "service-account.json"),
      path2.resolve(process.cwd(), "..", "service-account.json"),
      path2.resolve("/app/applet", "service-account.json"),
      path2.resolve("/app", "service-account.json")
    ];
    for (const p of candidatePaths) {
      if (fs2.existsSync(p)) {
        try {
          saRaw = fs2.readFileSync(p, "utf8");
          if (saRaw) break;
        } catch (_e) {
        }
      }
    }
  }
  if (saRaw) {
    try {
      const parsed = JSON.parse(saRaw.startsWith("{") ? saRaw : Buffer.from(saRaw, "base64").toString("utf8"));
      return cert(parsed);
    } catch (_e) {
    }
  }
  if (fallbackServiceAccount && fallbackServiceAccount.private_key) {
    try {
      return cert(fallbackServiceAccount);
    } catch (_e) {
    }
  }
  return null;
}
var explicitCredential = getServiceAccountCredential();
function projectId() {
  if (fallbackServiceAccount && fallbackServiceAccount.project_id) {
    return fallbackServiceAccount.project_id;
  }
  return process.env.FIRESTORE_PROJECT_ID || firebaseConfig.projectId || process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
}
var targetProjectId = projectId();
var defaultApp = getApps().find((a) => a.name === "[DEFAULT]");
if (defaultApp && defaultApp.options?.projectId !== targetProjectId) {
  try {
    deleteApp(defaultApp);
  } catch (_e) {
  }
}
var app = getApps().find((a) => a.name === "tsc-admin-app" || a.options?.projectId === targetProjectId);
if (!app) {
  app = initializeApp(
    explicitCredential ? { credential: explicitCredential, projectId: targetProjectId } : { projectId: targetProjectId },
    "tsc-admin-app"
  );
}
var adminAuth = getAuth(app);
var allowedProjectIds = Array.from(
  new Set(
    [
      targetProjectId,
      firebaseConfig.projectId,
      fallbackServiceAccount?.project_id,
      "ai-studio-tscagentdashboar-4a25c7aa-a6fe-4950-9680-a3794ae11803",
      process.env.FIRESTORE_PROJECT_ID,
      process.env.GCP_PROJECT
    ].filter((p) => Boolean(p))
  )
);
var clientAuth = null;
if (firebaseConfig.projectId && firebaseConfig.projectId !== targetProjectId) {
  try {
    const existing = getApps().find((a) => a.name === "client-auth-app");
    const clientApp = existing || initializeApp({ projectId: firebaseConfig.projectId }, "client-auth-app");
    clientAuth = getAuth(clientApp);
  } catch (e) {
  }
}
var cachedPublicKeys = {};
var keysExpireAt = 0;
async function getGooglePublicKeys() {
  if (Date.now() < keysExpireAt && Object.keys(cachedPublicKeys).length > 0) {
    return cachedPublicKeys;
  }
  const res = await fetch("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com");
  const cacheControl = res.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  keysExpireAt = Date.now() + maxAge * 1e3;
  cachedPublicKeys = await res.json();
  return cachedPublicKeys;
}
async function verifyFirebaseIdToken(token) {
  try {
    return await adminAuth.verifyIdToken(token);
  } catch (err) {
    if (clientAuth) {
      try {
        return await clientAuth.verifyIdToken(token);
      } catch (_e) {
      }
    }
    const parts = token.split(".");
    if (parts.length !== 3) throw err;
    let header;
    let payload;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw err;
    }
    if (!allowedProjectIds.includes(payload.aud)) {
      throw new Error(
        `Firebase ID token has incorrect "aud" claim. Expected one of [${allowedProjectIds.join(", ")}] but got "${payload.aud}".`
      );
    }
    if (payload.iss !== `https://securetoken.google.com/${payload.aud}`) {
      throw new Error(`Firebase ID token has incorrect "iss" claim: "${payload.iss}".`);
    }
    const now = Math.floor(Date.now() / 1e3);
    if (payload.exp && payload.exp < now) {
      throw new Error("Firebase ID token has expired.");
    }
    const keys = await getGooglePublicKeys();
    const certStr = keys[header.kid];
    if (!certStr) {
      throw new Error(`Firebase ID token has "kid" claim which does not correspond to a known public key.`);
    }
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(`${parts[0]}.${parts[1]}`);
    const valid = verifier.verify(certStr, parts[2], "base64url");
    if (!valid) {
      throw new Error("Firebase ID token signature verification failed.");
    }
    return payload;
  }
}
var credential = explicitCredential;
var tokenRetryAt = 0;
async function serviceAccountToken() {
  if (Date.now() < tokenRetryAt) return null;
  try {
    if (credential === null) {
      credential = getServiceAccountCredential() || applicationDefault();
    }
    const t = await credential.getAccessToken();
    return t?.access_token || null;
  } catch (_e) {
    credential = null;
    tokenRetryAt = Date.now() + 15e3;
    return null;
  }
}
function buildBackend() {
  loadEnv();
  const mode = (process.env.DB_MODE || "firestore").toLowerCase();
  if (mode === "local") {
    const file = process.env.DB_LOCAL_FILE;
    console.warn("[db] DB_MODE=local: using a local store, NOT Firestore. Never use this for the live app.");
    return createLocalBackend(file === "none" ? null : file || "local-db.json");
  }
  if (mode !== "firestore") {
    throw new Error(`Unknown DB_MODE "${mode}". Use "firestore" (default) or "local".`);
  }
  return createFirestoreBackend({
    projectId: projectId(),
    databaseId: firebaseConfig.firestoreDatabaseId || "(default)",
    apiKey: firebaseConfig.apiKey,
    tokenProvider: serviceAccountToken,
    contextTokenProvider: () => requestContext.getStore()?.idToken || null,
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    restBase: process.env.FIRESTORE_REST_BASE
  });
}
var backend = null;
var adminDb = createDb(() => backend ??= buildBackend());

// src/shared/incentive.ts
function normalizeEmail(email) {
  if (!email || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}
function formatCurrencyINR(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(amount);
}
function formatNumberINR(amount, decimals = 0) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(amount);
}
function roundHalfUp(x) {
  return Math.floor(x + 0.5 + 1e-9);
}
function safeNum(val) {
  if (val === null || val === void 0 || val === "") return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}
function parseToISTDateString(val) {
  if (!val) return "";
  if (typeof val === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = Math.round(val * 86400 * 1e3);
    const d2 = new Date(excelEpoch.getTime() + ms);
    const istString = d2.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    return istString;
  }
  if (val instanceof Date) {
    return val.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }
  return str;
}
function aggregateAgent(rows, qualityRow) {
  const normalizedRows = rows.map((r) => {
    const dateStr = parseToISTDateString(r.Date);
    const calls = safeNum(r.Inbound_Calls);
    const dayBlank = r.Day === void 0 || r.Day === null || String(r.Day).trim() === "";
    const day = dayBlank && calls > 0 ? 1 : safeNum(r.Day);
    return {
      raw: r,
      date: dateStr,
      sales: safeNum(r.Sales),
      orders: safeNum(r.Count_of_Orders),
      connects: safeNum(r.Unique_Connects),
      talkSeconds: safeNum(r.Talk_Time_Minutes) * 60,
      visitsBooked: safeNum(r.Store_Visits),
      visitsAttributed: safeNum(r.Store_Visits),
      day,
      calls,
      avgTalkSec: safeNum(r.Avg_TT_per_day)
    };
  });
  normalizedRows.sort((a, b) => a.date.localeCompare(b.date));
  const totals = {
    sales: 0,
    orders: 0,
    connects: 0,
    talkSeconds: 0,
    visitsBooked: 0,
    visitsAttributed: 0,
    activeDays: 0
  };
  const dailyMap = /* @__PURE__ */ new Map();
  let psCalls = 0;
  let psWeightedSum = 0;
  let psWeightCalls = 0;
  let psSum = 0;
  let psRows = 0;
  const ttByDate = /* @__PURE__ */ new Map();
  for (const nr of normalizedRows) {
    totals.sales += nr.sales;
    totals.orders += nr.orders;
    totals.connects += nr.connects;
    totals.talkSeconds += nr.talkSeconds;
    totals.visitsBooked += nr.visitsBooked;
    totals.visitsAttributed += nr.visitsAttributed;
    totals.activeDays += nr.day;
    psCalls += nr.calls;
    if (nr.avgTalkSec > 0) {
      psWeightedSum += nr.avgTalkSec * nr.calls;
      psWeightCalls += nr.calls;
      if (nr.day > 0) {
        psSum += nr.avgTalkSec;
        psRows += 1;
      }
      const acc = ttByDate.get(nr.date) ?? { num: 0, calls: 0, sum: 0, n: 0 };
      acc.num += nr.avgTalkSec * nr.calls;
      acc.calls += nr.calls;
      acc.sum += nr.avgTalkSec;
      acc.n += 1;
      ttByDate.set(nr.date, acc);
    }
    if (dailyMap.has(nr.date)) {
      const existing = dailyMap.get(nr.date);
      existing.sales += nr.sales;
      existing.orders += nr.orders;
      existing.connects += nr.connects;
      existing.talkSeconds += nr.talkSeconds;
      existing.visitsBooked += nr.visitsBooked;
      existing.visitsAttributed += nr.visitsAttributed;
      existing.day += nr.day;
      existing.calls = (existing.calls ?? 0) + nr.calls;
    } else {
      dailyMap.set(nr.date, {
        date: nr.date,
        sales: nr.sales,
        orders: nr.orders,
        connects: nr.connects,
        talkSeconds: nr.talkSeconds,
        visitsBooked: nr.visitsBooked,
        visitsAttributed: nr.visitsAttributed,
        day: nr.day,
        calls: nr.calls
      });
    }
  }
  totals.calls = psCalls;
  totals.ttWeightedSum = psWeightedSum;
  totals.ttWeightCalls = psWeightCalls;
  totals.ttSum = psSum;
  totals.ttRows = psRows;
  const daily = Array.from(dailyMap.values()).sort(
    (a, b) => a.date.localeCompare(b.date)
  );
  for (const entry of daily) {
    const acc = ttByDate.get(entry.date);
    if (acc) {
      const avg = acc.calls > 0 ? acc.num / acc.calls : acc.sum / acc.n;
      entry.avgTalkSec = Math.round(avg * 10) / 10;
    }
  }
  const latestRowItem = normalizedRows.length > 0 ? normalizedRows[normalizedRows.length - 1] : null;
  const latestRaw = latestRowItem ? latestRowItem.raw : {};
  const profile = {
    name: String(latestRaw.Agent_Name || "").trim(),
    officialEmail: normalizeEmail(latestRaw.Agent_Email_Official),
    personalEmail: normalizeEmail(latestRaw.Agent_Email_Personal),
    location: String(latestRaw.Agent_Location || "").trim(),
    agentTierRaw: String(latestRaw.Agent_Tier || "").trim(),
    tlOfficialEmail: normalizeEmail(latestRaw.TL_Official_Email),
    tlPersonalEmail: normalizeEmail(latestRaw.TL_Personal_Email)
  };
  const lastDataDate = latestRowItem ? latestRowItem.date : "";
  let quality = { audits: 0, score: 0 };
  if (qualityRow) {
    quality = {
      audits: safeNum(qualityRow.Total_Audits),
      score: safeNum(qualityRow.Average_Audit_Score)
    };
  }
  return {
    profile,
    totals,
    daily,
    quality,
    lastDataDate
  };
}
function metricsFromTotals(totals, quality, absentDays) {
  let avgConnects = 0;
  let avgTalkMinutes = 0;
  if (totals.activeDays > 0) {
    avgConnects = roundHalfUp(totals.connects / totals.activeDays);
    avgTalkMinutes = roundHalfUp(totals.talkSeconds / 60 / totals.activeDays);
  }
  let qualityScore = null;
  if (quality.audits > 0) {
    qualityScore = roundHalfUp(quality.score);
  }
  return {
    sales: totals.sales,
    avgConnects,
    avgTalkMinutes,
    qualityScore,
    visitsAttributed: totals.visitsAttributed,
    absentDays
  };
}
function evaluateBonusBand(value, config, className) {
  if (value === null) {
    return { value: null, band: "None", amount: 0 };
  }
  let band = "None";
  if (value >= config.high) {
    band = "High";
  } else if (value >= config.mid) {
    band = "Mid";
  }
  let amount = 0;
  if (band !== "None") {
    const classAmounts = config.amounts[className] || [0, 0];
    amount = band === "High" ? classAmounts[0] : classAmounts[1];
  }
  return {
    value,
    band,
    amount
  };
}
function evaluateOp(val, op, threshold) {
  switch (op) {
    case "<":
      return val < threshold;
    case "<=":
      return val <= threshold;
    case ">":
      return val > threshold;
    case ">=":
      return val >= threshold;
    case "=":
      return val === threshold;
    default:
      return false;
  }
}
function calculateFromMetrics(metrics, plan) {
  let activeClass = { name: "NQ", abovePct: 0, rate: 0 };
  const target = Math.round(plan.target);
  const sales = Math.round(metrics.sales);
  for (const c of plan.classes) {
    if (sales * 100 > target * c.abovePct) {
      activeClass = c;
    }
  }
  const achievementPct = target > 0 ? Math.round(metrics.sales / target * 1e4) / 100 : 0;
  const revenueIncentiveGross = roundHalfUp(metrics.sales * activeClass.rate);
  const qualityBonus = evaluateBonusBand(
    metrics.qualityScore,
    plan.bonuses.quality,
    activeClass.name
  );
  const connectsBonus = evaluateBonusBand(
    metrics.avgConnects,
    plan.bonuses.connects,
    activeClass.name
  );
  const talkBonus = evaluateBonusBand(
    metrics.avgTalkMinutes,
    plan.bonuses.talkMinutes,
    activeClass.name
  );
  let riderTier = 0;
  let riderAmount = 0;
  const sortedVisitTiers = [...plan.visitTiers].sort((a, b) => a.min - b.min);
  for (const vt of sortedVisitTiers) {
    if (metrics.visitsAttributed >= vt.min) {
      riderTier = vt.tier;
      riderAmount = vt.payout;
    }
  }
  const deductions = [];
  let totalDeductionsAmount = 0;
  if (plan.deductionRules && plan.deductionRules.length > 0) {
    for (const rule of plan.deductionRules) {
      let metricVal = null;
      if (rule.metric === "absentDays") {
        metricVal = metrics.absentDays;
      } else if (rule.metric === "qualityScore") {
        metricVal = metrics.qualityScore;
      }
      if (metricVal === null) continue;
      if (evaluateOp(metricVal, rule.op, rule.threshold)) {
        let ruleAmount = 0;
        if (rule.type === "fixed") {
          ruleAmount = rule.value;
        } else if (rule.type === "percent") {
          ruleAmount = roundHalfUp(revenueIncentiveGross * rule.value / 100);
        }
        deductions.push({ rule, amount: ruleAmount });
        totalDeductionsAmount += ruleAmount;
      }
    }
  }
  const revenueIncentiveNet = Math.max(0, revenueIncentiveGross - totalDeductionsAmount);
  const total = revenueIncentiveNet + qualityBonus.amount + connectsBonus.amount + talkBonus.amount + riderAmount;
  return {
    achievementPct,
    className: activeClass.name,
    rate: activeClass.rate,
    revenueIncentiveGross,
    deductions,
    revenueIncentiveNet,
    quality: qualityBonus,
    connects: connectsBonus,
    talk: talkBonus,
    rider: {
      tier: riderTier,
      amount: riderAmount
    },
    total
  };
}
function normalizeTierKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function resolveAgentType(tierMap, rawTier) {
  const key = normalizeTierKey(rawTier);
  if (!tierMap || !key) return null;
  for (const [label, type] of Object.entries(tierMap)) {
    if (normalizeTierKey(label) === key) return type;
  }
  return null;
}
function preSalesMetricsFromTotals(totals, quality, plan) {
  const days = totals.activeDays;
  const avgCalls = days > 0 ? roundHalfUp((totals.calls ?? 0) / days) : 0;
  let avgTalkSeconds = 0;
  const weightCalls = totals.ttWeightCalls ?? 0;
  const rows = totals.ttRows ?? 0;
  if (plan.talkMethod === "weighted" && weightCalls > 0) {
    avgTalkSeconds = roundHalfUp((totals.ttWeightedSum ?? 0) / weightCalls);
  } else if (rows > 0) {
    avgTalkSeconds = roundHalfUp((totals.ttSum ?? 0) / rows);
  }
  return {
    avgCalls,
    avgTalkSeconds,
    qualityScore: quality.audits > 0 ? roundHalfUp(quality.score) : null
  };
}
function pickPreSalesTier(tiers, value) {
  let tier = 0;
  let payout = 0;
  [...tiers].sort((a, b) => a.min - b.min).forEach((t, i) => {
    if (value >= t.min) {
      tier = i + 1;
      payout = t.payout;
    }
  });
  return { tier, payout };
}
function calculatePreSales(metrics, plan) {
  const eligible = metrics.qualityScore !== null && metrics.qualityScore >= plan.qualityGate;
  const callsPick = pickPreSalesTier(plan.calls, metrics.avgCalls);
  const talkPick = pickPreSalesTier(plan.talkSeconds, metrics.avgTalkSeconds);
  const callsAmount = eligible ? callsPick.payout : 0;
  const talkAmount = eligible ? talkPick.payout : 0;
  return {
    achievementPct: 0,
    className: "PS",
    rate: 0,
    revenueIncentiveGross: 0,
    deductions: [],
    revenueIncentiveNet: 0,
    quality: { value: metrics.qualityScore, band: "None", amount: 0 },
    connects: { value: null, band: "None", amount: 0 },
    talk: { value: null, band: "None", amount: 0 },
    rider: { tier: 0, amount: 0 },
    total: callsAmount + talkAmount,
    preSales: {
      qualityScore: metrics.qualityScore,
      qualityGate: plan.qualityGate,
      eligible,
      calls: {
        value: metrics.avgCalls,
        tier: callsPick.tier,
        payout: callsPick.payout,
        amount: callsAmount
      },
      talk: {
        value: metrics.avgTalkSeconds,
        tier: talkPick.tier,
        payout: talkPick.payout,
        amount: talkAmount
      },
      potentialTotal: callsPick.payout + talkPick.payout
    }
  };
}

// src/shared/plans.ts
var standardClasses = [
  { name: "NQ", abovePct: 0, rate: 0 },
  { name: "A", abovePct: 90, rate: 15e-4 },
  { name: "B", abovePct: 100, rate: 3e-3 },
  { name: "C", abovePct: 120, rate: 45e-4 },
  { name: "D", abovePct: 160, rate: 6e-3 }
];
var standardBonuses = {
  quality: {
    high: 90,
    mid: 85,
    amounts: {
      NQ: [1e3, 800],
      A: [1300, 1e3],
      B: [1300, 1e3],
      C: [1500, 1100],
      D: [2500, 1500]
    }
  },
  connects: {
    high: 145,
    mid: 140,
    amounts: {
      NQ: [1100, 800],
      A: [1300, 900],
      B: [1300, 900],
      C: [1500, 1100],
      D: [2500, 1500]
    }
  },
  talkMinutes: {
    high: 180,
    mid: 165,
    amounts: {
      NQ: [1e3, 700],
      A: [1500, 1e3],
      B: [1500, 1e3],
      C: [1800, 1250],
      D: [3e3, 1800]
    }
  }
};
var defaultHOPlan = {
  target: 9e6,
  classes: standardClasses,
  bonuses: standardBonuses,
  visitTiers: [
    { tier: 1, min: 110, payout: 2200 },
    { tier: 2, min: 160, payout: 4e3 },
    { tier: 3, min: 200, payout: 5e3 },
    { tier: 4, min: 220, payout: 7e3 }
  ],
  deductionRules: []
};
var defaultSTOREPlan = {
  target: 13e6,
  classes: standardClasses,
  bonuses: standardBonuses,
  visitTiers: [
    { tier: 1, min: 225, payout: 2200 },
    { tier: 2, min: 290, payout: 4e3 },
    { tier: 3, min: 360, payout: 5e3 },
    { tier: 4, min: 420, payout: 7e3 }
  ],
  deductionRules: []
};
var defaultPreSalesPlan = {
  qualityGate: 85,
  calls: [
    { min: 101, payout: 500 },
    { min: 116, payout: 1e3 },
    { min: 131, payout: 2e3 }
  ],
  talkSeconds: [
    { min: 166, payout: 500 },
    { min: 181, payout: 1e3 },
    { min: 211, payout: 2e3 }
  ],
  talkMethod: "weighted"
};
function getRevenuePlan(cycle, type) {
  return cycle?.plans?.[type] ?? (type === "HO" ? defaultHOPlan : defaultSTOREPlan);
}
function getPreSalesPlan(cycle) {
  return cycle?.plans?.PRE_SALES ?? defaultPreSalesPlan;
}

// src/shared/leaderboard.ts
function isTestAgentIdentifier(email, name) {
  const e = (email || "").trim().toLowerCase();
  const n = (name || "").trim().toLowerCase();
  return e === "test@thesleepcompany.in" || e === "test.agent@tsc.com" || e === "tl@tsc.com" || e.startsWith("test.") || e.startsWith("test@") || n === "testemp" || n === "test agent" || n.startsWith("test agent") || n.startsWith("demo agent");
}
function isPreSalesLocation(location) {
  return (location || "").toLowerCase().includes("pre sales");
}
function compareByRevenue(a, b) {
  return (b.sales || 0) - (a.sales || 0) || (a.name || "").localeCompare(b.name || "");
}
function rankRevenueRows(rows, location) {
  if (isPreSalesLocation(location)) return rows;
  return [...rows].sort(compareByRevenue).map((r, index) => ({ ...r, rank: index + 1 }));
}
function buildLocationRows(agents, location, includeTest) {
  if (isPreSalesLocation(location)) {
    return agents.filter(
      (a) => a.agentType === "PRE_SALES" && (includeTest || !a.isTest && !isTestAgentIdentifier(a.officialEmail, a.name))
    ).sort(
      (a, b) => (b.result?.total ?? 0) - (a.result?.total ?? 0) || (b.result?.preSales?.calls.value ?? 0) - (a.result?.preSales?.calls.value ?? 0) || (b.result?.preSales?.talk.value ?? 0) - (a.result?.preSales?.talk.value ?? 0) || a.name.localeCompare(b.name)
    ).map((a, index) => ({
      rank: index + 1,
      name: a.name,
      officialEmail: a.officialEmail,
      sales: 0,
      achievementPct: 0,
      className: "PS",
      totalIncentive: a.result?.total ?? 0,
      agentType: "PRE_SALES",
      avgCalls: a.result?.preSales?.calls.value ?? (a.totals?.activeDays ? Math.round((a.totals.calls || 0) / a.totals.activeDays) : 0),
      avgTalkSeconds: a.result?.preSales?.talk.value ?? 0,
      qualityScore: a.quality?.audits ? a.quality.score : null,
      callsTier: a.result?.preSales?.calls.tier ?? 0,
      talkTier: a.result?.preSales?.talk.tier ?? 0
    }));
  }
  const isHOLoc = location.toLowerCase() === "dighe";
  const expectedAgentType = isHOLoc ? "HO" : "STORE";
  return agents.filter(
    (a) => a.agentType === expectedAgentType && a.location.toLowerCase() === location.toLowerCase() && (includeTest || !a.isTest && !isTestAgentIdentifier(a.officialEmail, a.name))
  ).sort((a, b) => compareByRevenue({ sales: a.totals?.sales ?? 0, name: a.name }, { sales: b.totals?.sales ?? 0, name: b.name })).map((a, index) => ({
    rank: index + 1,
    name: a.name,
    officialEmail: a.officialEmail,
    sales: a.totals?.sales ?? 0,
    achievementPct: a.result?.achievementPct ?? 0,
    className: a.result?.className ?? "NQ",
    totalIncentive: a.result?.total ?? 0,
    agentType: a.agentType
  }));
}

// src/shared/revenue.ts
function cleanNum(val) {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}
function normalizeCategoryName(raw) {
  const norm = String(raw || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (norm.includes("shopify")) return "shopify";
  if (norm.includes("bfan")) return "bfan";
  if (norm.includes("bfmp")) return "bfmp";
  if (norm.includes("posoc") || norm.includes("pos")) return "posoc";
  return null;
}
function buildTeamRevenue(location, cycleId, mainRows, rawRevenueRows) {
  const dailyMain = /* @__PURE__ */ new Map();
  for (const r of mainRows) {
    const loc = String(r.Agent_Location || "").trim();
    if (loc.toLowerCase() !== location.toLowerCase()) continue;
    if (loc.toLowerCase().includes("pre sales")) continue;
    const dateStr = parseToISTDateString(r.Date);
    if (!dateStr) continue;
    const dayNum = cleanNum(r.Day) || 1;
    const orders = cleanNum(r.Count_of_Orders);
    const sales = cleanNum(r.Sales);
    const existing = dailyMain.get(dateStr) || { date: dateStr, day: dayNum, orders: 0, sales: 0 };
    existing.orders += orders;
    existing.sales += Math.round(sales);
    if (dayNum > existing.day) existing.day = dayNum;
    dailyMain.set(dateStr, existing);
  }
  const parsedExplicitByDate = /* @__PURE__ */ new Map();
  if (Array.isArray(rawRevenueRows) && rawRevenueRows.length > 0) {
    for (const row of rawRevenueRows) {
      const rowLoc = String(row.Location || row.Agent_Location || row.Store || row.Team || "").trim();
      if (rowLoc && rowLoc.toLowerCase() !== location.toLowerCase()) continue;
      const dateStr = parseToISTDateString(row.Date || row.date);
      if (!dateStr) continue;
      const existing = parsedExplicitByDate.get(dateStr) || {
        shopify: { orders: 0, sales: 0 },
        bfan: { orders: 0, sales: 0 },
        bfmp: { orders: 0, sales: 0 },
        posoc: { orders: 0, sales: 0 }
      };
      const cat = normalizeCategoryName(row.Category || row.Channel || row.category);
      if (cat) {
        existing[cat].orders += cleanNum(row.Orders || row.Count_of_Orders || row.orders);
        existing[cat].sales += Math.round(cleanNum(row.Sales || row.Revenue || row.sales));
      } else {
        for (const [k, v] of Object.entries(row)) {
          const keyNorm = k.toLowerCase().replace(/[^a-z0-9]/g, "");
          const isOrders = keyNorm.includes("order");
          const isSales = keyNorm.includes("sale") || keyNorm.includes("rev");
          if (keyNorm.includes("shopify")) {
            if (isOrders) existing.shopify.orders += cleanNum(v);
            if (isSales) existing.shopify.sales += Math.round(cleanNum(v));
          } else if (keyNorm.includes("bfan")) {
            if (isOrders) existing.bfan.orders += cleanNum(v);
            if (isSales) existing.bfan.sales += Math.round(cleanNum(v));
          } else if (keyNorm.includes("bfmp")) {
            if (isOrders) existing.bfmp.orders += cleanNum(v);
            if (isSales) existing.bfmp.sales += Math.round(cleanNum(v));
          } else if (keyNorm.includes("posoc") || keyNorm.includes("pos")) {
            if (isOrders) existing.posoc.orders += cleanNum(v);
            if (isSales) existing.posoc.sales += Math.round(cleanNum(v));
          }
        }
      }
      parsedExplicitByDate.set(dateStr, existing);
    }
  }
  const dailyList = [];
  const sortedDates = Array.from(dailyMain.keys()).sort((a, b) => b.localeCompare(a));
  for (const date of sortedDates) {
    const mainDay = dailyMain.get(date);
    const explicit = parsedExplicitByDate.get(date);
    let shopifyOrders = 0;
    let shopifySales = 0;
    let bfanOrders = 0;
    let bfanSales = 0;
    let bfmpOrders = 0;
    let bfmpSales = 0;
    let posocOrders = 0;
    let posocSales = 0;
    const hasExplicit = explicit && (explicit.shopify.orders > 0 || explicit.shopify.sales > 0 || explicit.bfan.orders > 0 || explicit.bfan.sales > 0 || explicit.bfmp.orders > 0 || explicit.bfmp.sales > 0 || explicit.posoc.orders > 0 || explicit.posoc.sales > 0);
    if (hasExplicit && explicit) {
      shopifyOrders = explicit.shopify.orders;
      shopifySales = explicit.shopify.sales;
      bfanOrders = explicit.bfan.orders;
      bfanSales = explicit.bfan.sales;
      bfmpOrders = explicit.bfmp.orders;
      bfmpSales = explicit.bfmp.sales;
      posocOrders = explicit.posoc.orders;
      posocSales = explicit.posoc.sales;
      const sumOrders = shopifyOrders + bfanOrders + bfmpOrders + posocOrders;
      if (sumOrders !== mainDay.orders && mainDay.orders > 0) {
        posocOrders = Math.max(0, mainDay.orders - (shopifyOrders + bfanOrders + bfmpOrders));
      }
      const sumSales = shopifySales + bfanSales + bfmpSales + posocSales;
      if (sumSales !== mainDay.sales && mainDay.sales > 0) {
        posocSales = Math.max(0, mainDay.sales - (shopifySales + bfanSales + bfmpSales));
      }
    } else {
      shopifyOrders = 0;
      shopifySales = 0;
      bfanOrders = 0;
      bfanSales = 0;
      bfmpOrders = 0;
      bfmpSales = 0;
      posocOrders = 0;
      posocSales = 0;
    }
    dailyList.push({
      date,
      day: mainDay.day,
      totalOrders: mainDay.orders,
      totalSales: mainDay.sales,
      hasDoDSplit: Boolean(hasExplicit),
      shopify: {
        orders: shopifyOrders,
        sales: shopifySales
      },
      bfan: {
        orders: bfanOrders,
        sales: bfanSales
      },
      bfmp: {
        orders: bfmpOrders,
        sales: bfmpSales
      },
      posoc: {
        orders: posocOrders,
        sales: posocSales
      }
    });
  }
  let cycleTotalSales = 0;
  let cycleTotalOrders = 0;
  let shopifyTotalOrders = 0;
  let shopifyTotalSales = 0;
  let bfanTotalOrders = 0;
  let bfanTotalSales = 0;
  let bfmpTotalOrders = 0;
  let bfmpTotalSales = 0;
  let posocTotalOrders = 0;
  let posocTotalSales = 0;
  for (const d of dailyList) {
    cycleTotalSales += d.totalSales;
    cycleTotalOrders += d.totalOrders;
    shopifyTotalOrders += d.shopify.orders;
    shopifyTotalSales += d.shopify.sales;
    bfanTotalOrders += d.bfan.orders;
    bfanTotalSales += d.bfan.sales;
    bfmpTotalOrders += d.bfmp.orders;
    bfmpTotalSales += d.bfmp.sales;
    posocTotalOrders += d.posoc.orders;
    posocTotalSales += d.posoc.sales;
  }
  const aov = cycleTotalOrders > 0 ? Math.round(cycleTotalSales / cycleTotalOrders) : 0;
  const toCategory = (orders, sales) => ({
    orders,
    sales,
    pctOfSales: cycleTotalSales > 0 ? Number((sales / cycleTotalSales * 100).toFixed(1)) : 0
  });
  return {
    location,
    cycleId,
    totalSales: cycleTotalSales,
    totalOrders: cycleTotalOrders,
    aov,
    hasDoDSplit: dailyList.some((d) => d.hasDoDSplit),
    categories: {
      shopify: toCategory(shopifyTotalOrders, shopifyTotalSales),
      bfan: toCategory(bfanTotalOrders, bfanTotalSales),
      bfmp: toCategory(bfmpTotalOrders, bfmpTotalSales),
      posoc: toCategory(posocTotalOrders, posocTotalSales)
    },
    daily: dailyList,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/shared/aiText.ts
function aiFingerprint(a) {
  const t = a.totals || {};
  return [
    a.agentType,
    a.lastDataDate,
    a.result?.total,
    a.result?.className,
    t.activeDays,
    t.sales,
    t.connects,
    t.talkSeconds,
    t.visitsAttributed,
    t.calls ?? 0,
    t.ttWeightedSum ?? 0,
    a.quality?.audits,
    a.quality?.score
  ].join("|");
}
function aiTextIsCurrent(a) {
  const ai = a?.aiSuggestions;
  if (!a || !ai) return false;
  if (ai.fingerprint) return ai.fingerprint === aiFingerprint(a);
  return ai.lastDataDate === a.lastDataDate;
}

// server-ai.ts
import { GoogleGenAI, Type } from "@google/genai";

// src/shared/planning.ts
function calculateCalendarDays(fromDateStr, toDateStr) {
  if (!fromDateStr || !toDateStr) return 0;
  const from = /* @__PURE__ */ new Date(fromDateStr + "T00:00:00Z");
  const to = /* @__PURE__ */ new Date(toDateStr + "T00:00:00Z");
  const diffMs = to.getTime() - from.getTime();
  const diffDays = Math.round(diffMs / (1e3 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}
function calculateRemainingWorkingDays(lastDataDate, startDate, endDate, workingDaysPerWeek) {
  let calendarDays;
  if (lastDataDate && lastDataDate.trim()) {
    calendarDays = calculateCalendarDays(lastDataDate, endDate);
  } else {
    const start = /* @__PURE__ */ new Date(startDate + "T00:00:00Z");
    start.setUTCDate(start.getUTCDate() - 1);
    const dayBeforeStart = start.toISOString().split("T")[0];
    calendarDays = calculateCalendarDays(dayBeforeStart, endDate);
  }
  const rawWorkingDays = Math.max(0, calendarDays) * workingDaysPerWeek / 7;
  return Math.round(rawWorkingDays * 10) / 10;
}
function minSalesForClass(plan, className) {
  const planClass = plan.classes.find((c) => c.name === className);
  if (!planClass) return 0;
  return Math.floor(plan.target * planClass.abovePct / 100) + 1;
}
function requiredPerDay(targetSales, currentSales, remainingWorkingDays) {
  if (remainingWorkingDays <= 0) return 0;
  const gap = Math.max(0, targetSales - currentSales);
  return gap / remainingWorkingDays;
}
function calculateProjection(currentVal, activeDays, remainingWorkingDays) {
  if (activeDays <= 0) return currentVal;
  return currentVal + currentVal / activeDays * remainingWorkingDays;
}

// src/shared/suggestions.ts
function buildSuggestions(agentRecord, plan, cycle) {
  if (!agentRecord || !agentRecord.totals || agentRecord.totals.activeDays <= 0) {
    return [];
  }
  const { totals, quality, absentDays, daily, lastDataDate, result } = agentRecord;
  const currentTotal = result.total;
  const activeDays = totals.activeDays;
  const currentSales = totals.sales;
  const remainingWorkingDays = calculateRemainingWorkingDays(
    lastDataDate,
    cycle.startDate,
    cycle.endDate,
    cycle.workingDaysPerWeek
  );
  const currentDailyAvgSales = activeDays > 0 ? currentSales / activeDays : 0;
  const currentMetrics = metricsFromTotals(totals, quality, absentDays);
  const suggestions = [];
  function testGain(metricsDelta) {
    const updatedMetrics = { ...currentMetrics, ...metricsDelta };
    const simulatedResult = calculateFromMetrics(updatedMetrics, plan);
    return Math.max(0, simulatedResult.total - currentTotal);
  }
  const startMs = (/* @__PURE__ */ new Date(cycle.startDate + "T00:00:00Z")).getTime();
  const endMs = (/* @__PURE__ */ new Date(cycle.endDate + "T00:00:00Z")).getTime();
  const totalCycleCalendarDays = Math.max(
    1,
    Math.round((endMs - startMs) / (1e3 * 60 * 60 * 24)) + 1
  );
  const lastDataMs = lastDataDate ? (/* @__PURE__ */ new Date(lastDataDate + "T00:00:00Z")).getTime() : startMs;
  const elapsedDays = Math.max(
    1,
    Math.min(
      totalCycleCalendarDays,
      Math.round((lastDataMs - startMs) / (1e3 * 60 * 60 * 24)) + 1
    )
  );
  const headlineSuggestion = {
    id: "headline",
    type: "headline",
    priority: 100,
    gainRupees: 0,
    numbers: {
      day: elapsedDays,
      totalDays: totalCycleCalendarDays,
      achievementPct: result.achievementPct
    },
    defaultText: `Day ${elapsedDays} of ${totalCycleCalendarDays}: you are at ${formatNumberINR(
      result.achievementPct,
      1
    )}% of target.`,
    difficult: false
  };
  const currentClassIdx = plan.classes.findIndex((c) => c.name === result.className);
  if (currentClassIdx >= 0 && currentClassIdx < plan.classes.length - 1) {
    const nextClass = plan.classes[currentClassIdx + 1];
    const targetMinSales = minSalesForClass(plan, nextClass.name);
    const gap = Math.max(0, targetMinSales - currentSales);
    if (gap > 0) {
      const gain = testGain({ sales: targetMinSales });
      const reqDaily = requiredPerDay(targetMinSales, currentSales, remainingWorkingDays);
      const isDifficult = currentDailyAvgSales > 0 && reqDaily > 2 * currentDailyAvgSales;
      suggestions.push({
        id: `nextClass-${nextClass.name}`,
        type: "nextClass",
        priority: 50,
        gainRupees: gain,
        numbers: { gap, gain, reqDaily, minSales: targetMinSales },
        defaultText: `${formatCurrencyINR(gap)} more revenue moves you to Class ${nextClass.name}. Your payout increases by ${formatCurrencyINR(gain)}.`,
        difficult: isDifficult
      });
      if (totals.orders > 0) {
        const aov = currentSales / totals.orders;
        if (aov > 0) {
          const neededOrders = Math.ceil(gap / aov);
          suggestions.push({
            id: `ordersNeeded-${nextClass.name}`,
            type: "ordersNeeded",
            priority: 45,
            gainRupees: gain,
            numbers: { neededOrders, aov, gap },
            defaultText: `That is about ${formatNumberINR(
              neededOrders
            )} more orders at your average order value.`,
            difficult: isDifficult
          });
        }
      }
    }
  }
  const bonusCandidates = [];
  if (result.connects.band !== "High") {
    const nextLimit = result.connects.band === "Mid" ? plan.bonuses.connects.high : plan.bonuses.connects.mid;
    const currentConnectsTotal = totals.connects;
    const currentAvgConnects = currentMetrics.avgConnects;
    if (remainingWorkingDays > 0 && currentAvgConnects > 0) {
      const extraPerDay = (nextLimit * (activeDays + remainingWorkingDays) - currentConnectsTotal) / remainingWorkingDays - currentAvgConnects;
      if (extraPerDay > 0) {
        const gain = testGain({ avgConnects: nextLimit });
        bonusCandidates.push({
          name: "Unique Connects",
          unit: "connects",
          limit: nextLimit,
          extraPerDay: Math.ceil(extraPerDay),
          pctOfCurrent: extraPerDay / currentAvgConnects,
          gain,
          metricKey: "avgConnects"
        });
      }
    }
  }
  if (result.talk.band !== "High") {
    const nextLimit = result.talk.band === "Mid" ? plan.bonuses.talkMinutes.high : plan.bonuses.talkMinutes.mid;
    const currentTalkMinutesTotal = totals.talkSeconds / 60;
    const currentAvgTalk = currentMetrics.avgTalkMinutes;
    if (remainingWorkingDays > 0 && currentAvgTalk > 0) {
      const extraPerDay = (nextLimit * (activeDays + remainingWorkingDays) - currentTalkMinutesTotal) / remainingWorkingDays - currentAvgTalk;
      if (extraPerDay > 0) {
        const gain = testGain({ avgTalkMinutes: nextLimit });
        bonusCandidates.push({
          name: "Talk Time",
          unit: "minutes",
          limit: nextLimit,
          extraPerDay: Math.ceil(extraPerDay),
          pctOfCurrent: extraPerDay / currentAvgTalk,
          gain,
          metricKey: "avgTalkMinutes"
        });
      }
    }
  }
  if (bonusCandidates.length > 0) {
    bonusCandidates.sort((a, b) => a.pctOfCurrent - b.pctOfCurrent);
    const best = bonusCandidates[0];
    suggestions.push({
      id: `fastestBonus-${best.metricKey}`,
      type: "fastestBonus",
      priority: 60,
      gainRupees: best.gain,
      numbers: {
        extraPerDay: best.extraPerDay,
        gain: best.gain,
        nextLimit: best.limit
      },
      defaultText: `The fastest bonus to unlock is ${best.name}. You need ${best.extraPerDay} more ${best.unit} each day (+${formatCurrencyINR(best.gain)}).`,
      difficult: false
    });
  }
  const currentTierNum = result.rider.tier;
  const currentTierIndex = plan.visitTiers.findIndex((t) => t.tier === currentTierNum);
  const nextTier = currentTierIndex === -1 ? plan.visitTiers[0] : plan.visitTiers[currentTierIndex + 1];
  if (nextTier) {
    const gap = Math.max(0, nextTier.min - totals.visitsAttributed);
    const gain = testGain({ visitsAttributed: nextTier.min });
    suggestions.push({
      id: `storeVisits-tier${nextTier.tier}`,
      type: "storeVisits",
      priority: 40,
      gainRupees: gain,
      numbers: { gap, tier: nextTier.tier, gain },
      defaultText: `You need ${formatNumberINR(gap)} more store visits to reach Tier ${nextTier.tier} (+${formatCurrencyINR(gain)}).`,
      difficult: false
    });
  }
  const projectedSales = Math.round(
    calculateProjection(currentSales, activeDays, remainingWorkingDays)
  );
  const projectedVisits = Math.round(
    calculateProjection(totals.visitsAttributed, activeDays, remainingWorkingDays)
  );
  const projectedResult = calculateFromMetrics(
    {
      ...currentMetrics,
      sales: projectedSales,
      visitsAttributed: projectedVisits
    },
    plan
  );
  suggestions.push({
    id: "projection",
    type: "projection",
    priority: 30,
    gainRupees: 0,
    numbers: {
      projectedSales,
      projectedVisits,
      projectedTotal: projectedResult.total,
      achievementPct: projectedResult.achievementPct
    },
    defaultText: `At your current speed, you will finish at ${formatNumberINR(
      projectedResult.achievementPct,
      0
    )}% (Class ${projectedResult.className}) with ${formatCurrencyINR(
      projectedResult.total
    )}.`,
    difficult: false
  });
  const activeEntries = (daily || []).filter((d) => d.day > 0);
  const last7Active = activeEntries.slice(-7);
  if (last7Active.length > 0) {
    const sumActiveDays7 = last7Active.reduce((acc, d) => acc + d.day, 0);
    if (result.connects.band === "High" || result.connects.band === "Mid") {
      const currentBandLimit = result.connects.band === "High" ? plan.bonuses.connects.high : plan.bonuses.connects.mid;
      const lowerBandName = result.connects.band === "High" ? "Mid" : "None";
      const sumConnects7 = last7Active.reduce((acc, d) => acc + d.connects, 0);
      const avg7Connects = sumActiveDays7 > 0 ? Math.round(sumConnects7 / sumActiveDays7) : 0;
      if (avg7Connects < currentBandLimit && currentMetrics.avgConnects >= currentBandLimit) {
        const lowerLimit = result.connects.band === "High" ? plan.bonuses.connects.mid : plan.bonuses.connects.mid - 1;
        const loss = currentTotal - calculateFromMetrics({ ...currentMetrics, avgConnects: lowerLimit }, plan).total;
        suggestions.push({
          id: "warning-connects",
          type: "warning",
          priority: 1e3,
          gainRupees: 0,
          numbers: { avg7: avg7Connects, loss },
          defaultText: `Warning: your Connects average in the last 7 days is ${avg7Connects}. You can drop from ${result.connects.band} to ${lowerBandName} (-${formatCurrencyINR(loss)}).`,
          difficult: false
        });
      }
    }
    if (result.talk.band === "High" || result.talk.band === "Mid") {
      const currentBandLimit = result.talk.band === "High" ? plan.bonuses.talkMinutes.high : plan.bonuses.talkMinutes.mid;
      const lowerBandName = result.talk.band === "High" ? "Mid" : "None";
      const sumTalkSec7 = last7Active.reduce((acc, d) => acc + d.talkSeconds, 0);
      const avg7TalkMin = sumActiveDays7 > 0 ? Math.round(sumTalkSec7 / 60 / sumActiveDays7) : 0;
      if (avg7TalkMin < currentBandLimit && currentMetrics.avgTalkMinutes >= currentBandLimit) {
        const lowerLimit = result.talk.band === "High" ? plan.bonuses.talkMinutes.mid : plan.bonuses.talkMinutes.mid - 1;
        const loss = currentTotal - calculateFromMetrics({ ...currentMetrics, avgTalkMinutes: lowerLimit }, plan).total;
        suggestions.push({
          id: "warning-talk",
          type: "warning",
          priority: 1e3,
          gainRupees: 0,
          numbers: { avg7: avg7TalkMin, loss },
          defaultText: `Warning: your Talk Time average in the last 7 days is ${avg7TalkMin} min. You can drop from ${result.talk.band} to ${lowerBandName} (-${formatCurrencyINR(loss)}).`,
          difficult: false
        });
      }
    }
  }
  if (currentMetrics.qualityScore !== null) {
    const q = currentMetrics.qualityScore;
    const { high, mid } = plan.bonuses.quality;
    const bandName = q >= high ? q - high <= 1 ? "High" : null : q >= mid && q - mid <= 1 ? "Mid" : null;
    if (bandName) {
      const lowerBand = bandName === "High" ? "Mid" : "None";
      suggestions.push({
        id: "warning-quality",
        type: "warning",
        priority: 1e3,
        gainRupees: 0,
        numbers: { score: q },
        defaultText: `Warning: your Quality score (${q}) is right on the edge of the ${bandName} band. One low score will drop you to ${lowerBand}.`,
        difficult: false
      });
    }
  }
  if (activeEntries.length >= 3) {
    let connectsStreak = 0;
    for (let i = activeEntries.length - 1; i >= 0; i--) {
      if (activeEntries[i].connects >= plan.bonuses.connects.high) {
        connectsStreak++;
      } else {
        break;
      }
    }
    if (connectsStreak >= 3) {
      suggestions.push({
        id: "streak-connects",
        type: "streak",
        priority: 35,
        gainRupees: 0,
        numbers: { streak: connectsStreak, limit: plan.bonuses.connects.high },
        defaultText: `${connectsStreak} days in a row at ${plan.bonuses.connects.high}+ connects. Keep the streak alive!`,
        difficult: false
      });
    }
    let talkStreak = 0;
    for (let i = activeEntries.length - 1; i >= 0; i--) {
      const dailyTalkMin = Math.round(activeEntries[i].talkSeconds / 60);
      if (dailyTalkMin >= plan.bonuses.talkMinutes.high) {
        talkStreak++;
      } else {
        break;
      }
    }
    if (talkStreak >= 3) {
      suggestions.push({
        id: "streak-talk",
        type: "streak",
        priority: 35,
        gainRupees: 0,
        numbers: { streak: talkStreak, limit: plan.bonuses.talkMinutes.high },
        defaultText: `${talkStreak} days in a row at ${plan.bonuses.talkMinutes.high}+ minutes talk time. Keep the streak alive!`,
        difficult: false
      });
    }
  }
  if (currentSales >= 1e6) {
    const milestoneSales = Math.floor(currentSales / 1e6) * 1e6;
    suggestions.push({
      id: `milestone-${milestoneSales}`,
      type: "milestone",
      priority: 20,
      gainRupees: 0,
      numbers: { milestoneSales },
      defaultText: `You crossed ${formatCurrencyINR(milestoneSales)} in revenue!`,
      difficult: false
    });
  }
  const warnings = suggestions.filter((s) => s.type === "warning");
  const others = suggestions.filter((s) => s.type !== "warning");
  others.sort((a, b) => b.gainRupees - a.gainRupees || b.priority - a.priority);
  const topSuggestions = [...warnings, ...others].slice(0, 5);
  return [headlineSuggestion, ...topSuggestions];
}
function buildPreSalesSuggestions(agentRecord, plan, cycle) {
  if (!agentRecord || !agentRecord.totals || agentRecord.totals.activeDays <= 0) {
    return [];
  }
  const { totals, quality, daily, lastDataDate } = agentRecord;
  const activeDays = totals.activeDays;
  const metrics = preSalesMetricsFromTotals(totals, quality, plan);
  const calc = calculatePreSales(metrics, plan);
  const ps = calc.preSales;
  if (!ps) return [];
  const remaining = calculateRemainingWorkingDays(
    lastDataDate,
    cycle.startDate,
    cycle.endDate,
    cycle.workingDaysPerWeek
  );
  const gate = plan.qualityGate;
  const callsTiers = [...plan.calls].sort((a, b) => a.min - b.min);
  const talkTiers = [...plan.talkSeconds].sort((a, b) => a.min - b.min);
  const totalCalls = totals.calls ?? 0;
  const suggestions = [];
  const startMs = (/* @__PURE__ */ new Date(cycle.startDate + "T00:00:00Z")).getTime();
  const endMs = (/* @__PURE__ */ new Date(cycle.endDate + "T00:00:00Z")).getTime();
  const totalDays = Math.max(1, Math.round((endMs - startMs) / (1e3 * 60 * 60 * 24)) + 1);
  const lastMs = lastDataDate ? (/* @__PURE__ */ new Date(lastDataDate + "T00:00:00Z")).getTime() : startMs;
  const elapsed = Math.max(
    1,
    Math.min(totalDays, Math.round((lastMs - startMs) / (1e3 * 60 * 60 * 24)) + 1)
  );
  let headlineText;
  if (ps.eligible) {
    headlineText = `Day ${elapsed} of ${totalDays}: you have earned ${formatCurrencyINR(calc.total)} so far.`;
  } else if (ps.potentialTotal > 0) {
    headlineText = `Day ${elapsed} of ${totalDays}: reach a Quality Score of ${gate}% to unlock ${formatCurrencyINR(ps.potentialTotal)}.`;
  } else {
    headlineText = `Day ${elapsed} of ${totalDays}: keep going. Your first payout starts at ${callsTiers[0]?.min ?? 0} calls a day.`;
  }
  const headlineSuggestion = {
    id: "headline",
    type: "headline",
    priority: 100,
    gainRupees: 0,
    numbers: { day: elapsed, totalDays, total: calc.total },
    defaultText: headlineText,
    difficult: false
  };
  const score = metrics.qualityScore;
  if (score === null) {
    suggestions.push({
      id: "warning-quality-gate",
      type: "warning",
      priority: 1e3,
      gainRupees: 0,
      numbers: { gate, potential: ps.potentialTotal },
      defaultText: `No Quality audit yet. You need a Quality Score of ${gate}% or more to receive your Calls and Talk Time incentives.`,
      difficult: false
    });
  } else if (score < gate) {
    suggestions.push({
      id: "warning-quality-gate",
      type: "warning",
      priority: 1e3,
      gainRupees: 0,
      numbers: { score, gate, potential: ps.potentialTotal },
      defaultText: ps.potentialTotal > 0 ? `Your Quality Score is ${score}%. Reach ${gate}% to unlock ${formatCurrencyINR(ps.potentialTotal)}.` : `Your Quality Score is ${score}%. You need ${gate}% or more to receive your incentives.`,
      difficult: false
    });
  } else if (score - gate <= 1 && ps.potentialTotal > 0) {
    suggestions.push({
      id: "warning-quality-gate",
      type: "warning",
      priority: 1e3,
      gainRupees: 0,
      numbers: { score, gate, potential: ps.potentialTotal },
      defaultText: `Warning: your Quality Score (${score}) is right on the edge of the ${gate}% you need. One low audit can lock ${formatCurrencyINR(ps.potentialTotal)}.`,
      difficult: false
    });
  }
  const nextCalls = callsTiers.find((t) => t.min > metrics.avgCalls);
  if (nextCalls && remaining > 0) {
    const extra = (nextCalls.min * (activeDays + remaining) - totalCalls) / remaining - metrics.avgCalls;
    if (extra > 0) {
      const gain = nextCalls.payout - pickPreSalesTier(plan.calls, metrics.avgCalls).payout;
      suggestions.push({
        id: "fastestBonus-calls",
        type: "fastestBonus",
        priority: 60,
        gainRupees: gain,
        numbers: { extraPerDay: Math.ceil(extra), gain, nextLimit: nextCalls.min },
        defaultText: `The next calls tier starts at ${nextCalls.min} calls a day. You need ${Math.ceil(extra)} more calls each day (+${formatCurrencyINR(gain)}).`,
        difficult: metrics.avgCalls > 0 && extra > metrics.avgCalls
      });
    }
  }
  const nextTalk = talkTiers.find((t) => t.min > metrics.avgTalkSeconds);
  if (nextTalk && remaining > 0 && metrics.avgTalkSeconds > 0) {
    const weightCalls = totals.ttWeightCalls ?? 0;
    const futureCalls = totalCalls / activeDays * remaining;
    let neededAvg;
    if (plan.talkMethod === "weighted" && weightCalls > 0 && futureCalls > 0) {
      neededAvg = (nextTalk.min * (weightCalls + futureCalls) - (totals.ttWeightedSum ?? 0)) / futureCalls;
    } else {
      neededAvg = (nextTalk.min * ((totals.ttRows ?? 0) + remaining) - (totals.ttSum ?? 0)) / remaining;
    }
    const extra = neededAvg - metrics.avgTalkSeconds;
    if (extra > 0) {
      const gain = nextTalk.payout - pickPreSalesTier(plan.talkSeconds, metrics.avgTalkSeconds).payout;
      suggestions.push({
        id: "fastestBonus-talk",
        type: "fastestBonus",
        priority: 55,
        gainRupees: gain,
        numbers: { extraSeconds: Math.ceil(extra), gain, nextLimit: nextTalk.min },
        defaultText: `The next talk time tier starts at ${nextTalk.min} seconds. You need about ${Math.ceil(extra)} more seconds on each call from now on (+${formatCurrencyINR(gain)}).`,
        difficult: extra > metrics.avgTalkSeconds
      });
    }
  }
  const activeEntries = (daily || []).filter((d) => d.day > 0);
  if (activeEntries.length >= 3 && callsTiers.length > 0) {
    const limit = callsTiers[0].min;
    let streak = 0;
    for (let i = activeEntries.length - 1; i >= 0; i--) {
      if ((activeEntries[i].calls ?? 0) >= limit) streak++;
      else break;
    }
    if (streak >= 3) {
      suggestions.push({
        id: "streak-calls",
        type: "streak",
        priority: 35,
        gainRupees: 0,
        numbers: { streak, limit },
        defaultText: `${streak} days in a row at ${limit}+ calls. Keep the streak alive!`,
        difficult: false
      });
    }
  }
  const warnings = suggestions.filter((s) => s.type === "warning");
  const others = suggestions.filter((s) => s.type !== "warning");
  others.sort((a, b) => b.gainRupees - a.gainRupees || b.priority - a.priority);
  return [headlineSuggestion, ...[...warnings, ...others].slice(0, 5)];
}
function buildAgentSuggestions(agentRecord, cycle) {
  if (!agentRecord) return [];
  if (agentRecord.agentType === "PRE_SALES") {
    return buildPreSalesSuggestions(agentRecord, getPreSalesPlan(cycle), cycle);
  }
  return buildSuggestions(agentRecord, getRevenuePlan(cycle, agentRecord.agentType), cycle);
}

// server-ai.ts
var GEMINI_MODEL = "gemini-2.5-flash";
var genAI = null;
var genAIKey = "";
function getGenAI() {
  loadEnv();
  const key = process.env.GEMINI_API_KEY || "";
  if (!key) return null;
  if (!genAI || genAIKey !== key) {
    genAI = new GoogleGenAI({ apiKey: key });
    genAIKey = key;
  }
  return genAI;
}
function isAiConfigured() {
  loadEnv();
  return Boolean(process.env.GEMINI_API_KEY);
}
var geminiOverride = null;
function extractNumbers(text) {
  if (!text) return [];
  const cleaned = text.replace(/,/g, "").replace(/[₹]/g, "").replace(/\bRs\.?\s*/gi, "").replace(/\s+%/g, "%");
  const matches = cleaned.match(/\d+(?:\.\d+)?%?/g);
  if (!matches) return [];
  return matches.map((m) => m.trim());
}
function areNumberSetsEqual(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;
  const s1 = [...arr1].sort();
  const s2 = [...arr2].sort();
  return s1.every((val, idx) => val === s2[idx]);
}
function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}
var SYSTEM_INSTRUCTION = "You write short, upbeat coaching messages for call sales agents of a mattress company during the Diwali sales season. For each item, rewrite defaultText in a fun, energetic, motivating way. Rules: 1) Keep every number exactly as it appears in defaultText, with the same digits, the rupee sign, and the Indian comma format. 2) Do not add any other number. 3) Max 25 words for each item. 4) Max 1 emoji for each item. 5) Never shame or pressure; no words like failure, poor, or bad. 6) Tone: if tone is english, use simple friendly English; if tone is hinglish, use casual Hindi-English mix in Latin script. 7) You can use Diwali, festival lights, rangoli, or cricket ideas. 8) Do not use a person's name. 9) For the headline item, write a headline of max 12 words and return it in the headline field. Return only JSON.";
async function callGeminiWithTimeoutAndRetry(payloadString) {
  if (geminiOverride) return geminiOverride(payloadString);
  const client = getGenAI();
  if (!client) {
    throw new Error("GEMINI_API_KEY is not configured on server.");
  }
  const callOnce = async () => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Gemini API call timed out after 10000ms"));
      }, 1e4);
    });
    try {
      const responsePromise = client.models.generateContent({
        model: GEMINI_MODEL,
        contents: payloadString,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.9,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    text: { type: Type.STRING }
                  },
                  required: ["id", "text"]
                }
              }
            },
            required: ["headline", "items"]
          }
        }
      });
      const res = await Promise.race([responsePromise, timeoutPromise]);
      return res;
    } finally {
      clearTimeout(timeoutId);
    }
  };
  try {
    return await callOnce();
  } catch (err) {
    await new Promise((resolve) => setTimeout(resolve, 1e3));
    return await callOnce();
  }
}
async function generateAiText(agentRecord, cycle, appConfig) {
  const suggestions = buildAgentSuggestions(agentRecord, cycle);
  if (!suggestions || suggestions.length === 0) {
    return {
      success: false,
      report: [],
      error: "No suggestions generated for this agent."
    };
  }
  const remainingWorkingDays = calculateRemainingWorkingDays(
    agentRecord.lastDataDate,
    cycle.startDate,
    cycle.endDate,
    cycle.workingDaysPerWeek
  );
  const inputPayload = {
    tone: appConfig.aiTone || "english",
    agentType: agentRecord.agentType,
    // Revenue class and achievement only exist for HO / Store agents
    ...agentRecord.agentType === "PRE_SALES" ? {} : {
      className: agentRecord.result?.className || "NQ",
      achievementPct: agentRecord.result?.achievementPct || 0
    },
    daysLeft: remainingWorkingDays,
    items: suggestions.map((s) => ({
      id: s.id,
      type: s.type,
      numbers: s.numbers,
      gainRupees: s.gainRupees,
      defaultText: s.defaultText
    }))
  };
  const payloadString = JSON.stringify(inputPayload);
  let rawResponse;
  try {
    rawResponse = await callGeminiWithTimeoutAndRetry(payloadString);
  } catch (err) {
    return {
      success: false,
      report: [],
      error: err?.message || "Gemini call failed"
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(rawResponse.text || "{}");
  } catch (err) {
    return {
      success: false,
      report: [],
      error: "Failed to parse Gemini JSON output"
    };
  }
  const report = [];
  const validItems = [];
  const suggestionMap = /* @__PURE__ */ new Map();
  suggestions.forEach((s) => suggestionMap.set(s.id, s));
  let validHeadline = void 0;
  const headlineSuggestion = suggestions.find((s) => s.type === "headline");
  const headlineText = parsed.headline || "";
  if (headlineSuggestion) {
    const defaultNumbers = extractNumbers(headlineSuggestion.defaultText);
    const geminiNumbers = extractNumbers(headlineText);
    const wCount = countWords(headlineText);
    if (!headlineText.trim()) {
      report.push({
        id: "headline",
        defaultText: headlineSuggestion.defaultText,
        geminiText: "",
        status: "dropped",
        reason: "Empty headline returned by model"
      });
    } else if (wCount > 12) {
      report.push({
        id: "headline",
        defaultText: headlineSuggestion.defaultText,
        geminiText: headlineText,
        status: "dropped",
        reason: `Word count exceeded (${wCount} > 12 words)`
      });
    } else if (!areNumberSetsEqual(defaultNumbers, geminiNumbers)) {
      report.push({
        id: "headline",
        defaultText: headlineSuggestion.defaultText,
        geminiText: headlineText,
        status: "dropped",
        reason: `Numbers mismatch. Expected [${defaultNumbers.join(", ")}], got [${geminiNumbers.join(", ")}]`
      });
    } else {
      validHeadline = headlineText;
      report.push({
        id: "headline",
        defaultText: headlineSuggestion.defaultText,
        geminiText: headlineText,
        status: "passed"
      });
    }
  }
  const returnedItems = parsed.items || [];
  for (const item of returnedItems) {
    if (item.id === "headline") continue;
    const s = suggestionMap.get(item.id);
    if (!s) {
      report.push({
        id: item.id,
        defaultText: "\u2014",
        geminiText: item.text,
        status: "dropped",
        reason: "Unknown item id"
      });
      continue;
    }
    const defaultNumbers = extractNumbers(s.defaultText);
    const geminiNumbers = extractNumbers(item.text);
    const wCount = countWords(item.text);
    if (wCount > 25) {
      report.push({
        id: item.id,
        defaultText: s.defaultText,
        geminiText: item.text,
        status: "dropped",
        reason: `Word count exceeded (${wCount} > 25 words)`
      });
    } else if (!areNumberSetsEqual(defaultNumbers, geminiNumbers)) {
      report.push({
        id: item.id,
        defaultText: s.defaultText,
        geminiText: item.text,
        status: "dropped",
        reason: `Numbers mismatch. Expected [${defaultNumbers.join(", ")}], got [${geminiNumbers.join(", ")}]`
      });
    } else {
      validItems.push({ id: item.id, text: item.text });
      report.push({
        id: item.id,
        defaultText: s.defaultText,
        geminiText: item.text,
        status: "passed"
      });
    }
  }
  for (const s of suggestions) {
    if (s.id === "headline") continue;
    if (!returnedItems.some((it) => it.id === s.id)) {
      report.push({
        id: s.id,
        defaultText: s.defaultText,
        geminiText: "\u2014",
        status: "dropped",
        reason: "Item was not generated by model"
      });
    }
  }
  return {
    success: true,
    aiSuggestions: {
      lastDataDate: agentRecord.lastDataDate,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      model: GEMINI_MODEL,
      fingerprint: aiFingerprint(agentRecord),
      ...validHeadline ? { headline: validHeadline } : {},
      items: validItems
    },
    report
  };
}
async function runBatchAiGeneration(agents, cycle, appConfig, options = {}) {
  let okCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  const updatedAgents = [...agents];
  const generatedAgents = [];
  const deadline = options.budgetMs !== void 0 ? Date.now() + options.budgetMs : Infinity;
  let currentIndex = 0;
  let completed = 0;
  async function worker() {
    while (currentIndex < updatedAgents.length) {
      const idx = currentIndex++;
      const agent = updatedAgents[idx];
      if (Date.now() >= deadline) {
        pendingCount++;
        continue;
      }
      try {
        const result = await generateAiText(agent, cycle, appConfig);
        if (result.success && result.aiSuggestions) {
          agent.aiSuggestions = result.aiSuggestions;
          generatedAgents.push(agent);
          okCount++;
        } else {
          failedCount++;
        }
      } catch (_e) {
        failedCount++;
      } finally {
        completed++;
        if (options.onProgress) options.onProgress(completed, updatedAgents.length);
      }
    }
  }
  const concurrency = Math.min(3, agents.length);
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return { okCount, failedCount, pendingCount, updatedAgents, generatedAgents };
}

// server-raw-data.ts
var DEFAULT_RAW_SHEET_URL = "https://docs.google.com/spreadsheets/d/1Bg_F0Asq16F1BSwxyKF7SjFH4UUSVk6cTZ6cp9dnqb0/edit";
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const parseLine = (line) => {
    const res = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === "," && !inQuotes) {
        res.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    res.push(cur.trim());
    return res;
  };
  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] !== void 0 ? vals[idx] : "";
    });
    rows.push(obj);
  }
  return rows;
}
function headerKey(h) {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function pick(row, ...names) {
  const wanted = new Set(names.map(headerKey));
  for (const [k, v] of Object.entries(row || {})) {
    if (wanted.has(headerKey(k)) && v !== void 0 && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}
var ORDER_VALUE_HEADERS = ["Order Value", "order_value", "Order_Value"];
var ORDER_AGENT_HEADERS = ["Agent", "Agent Email", "Agent_Email"];
var VISIT_AGENT_HEADERS = ["Agent ID", "agent_id", "Agent", "Agent Email"];
function branchOf(text, fallback) {
  const t = text.toLowerCase();
  if (t.includes("andheri")) return "Andheri";
  if (t.includes("bangalore") || t.includes("bengaluru")) return "Bangalore";
  if (t.includes("dighe") || /\bho\b/.test(t)) return "Dighe";
  return fallback;
}
function normalizeRawOrders(rawOrders, excludedSet) {
  return (rawOrders || []).map((o) => {
    const agentCategory = pick(o, "Agent Category");
    const val = parseFloat(pick(o, ...ORDER_VALUE_HEADERS).replace(/[^0-9.-]/g, "")) || 0;
    return {
      orderId: pick(o, "Order ID", "order_id", "Order_ID"),
      date: pick(o, "Date", "Activity Date/Order Date"),
      orderTime: pick(o, "Order Time", "order_time", "Order_Time"),
      orderValue: Math.round(val),
      orderPhone: pick(o, "Phone/Alternate Phone", "Order Phone / Alternate Phone", "Order_Phone", "phone_alternate_phone"),
      agentEmail: normalizeEmail(pick(o, ...ORDER_AGENT_HEADERS)),
      category: pick(o, "Category"),
      talkTimeCohort: pick(o, "Talk Time Cohort"),
      originalPhoneOrMarketplace: pick(
        o,
        "Original Phone/Marketplace Name",
        "Original Phone / Marketplace Name (for Alt/MP Orders)"
      ),
      consideredForOverall: true,
      consideredForAgent: true,
      agentCategory,
      location: branchOf(agentCategory || pick(o, "Location"), "Dighe"),
      channel: pick(o, "Channel")
    };
  }).filter((o) => !excludedSet.has(normalizeEmail(o.agentEmail)));
}
function normalizeRawVisits(rawVisits, excludedSet) {
  return (rawVisits || []).map((v, i) => {
    const visitDateTime = pick(v, "Visit Date Time", "visit_date_time");
    return {
      id: "visit_" + (i + 1),
      type: "STORE",
      date: (visitDateTime || pick(v, "Date")).split(" ")[0] || "",
      visitDateTime,
      phoneNumber: pick(v, "Phone Number", "phone_number"),
      agentEmail: normalizeEmail(pick(v, ...VISIT_AGENT_HEADERS)),
      location: branchOf(pick(v, "Location"), "Store"),
      talkTimeSeconds: parseInt(pick(v, "Talk Time (before visit)", "Talk Time before visit", "talk_time_before_visit"), 10) || 0,
      visitSource: pick(v, "Visit Source", "visit_source")
    };
  }).filter((v) => !excludedSet.has(normalizeEmail(v.agentEmail)));
}
function assertRawHeaders(tab, rows) {
  if (!rows || rows.length === 0) return;
  const keys = /* @__PURE__ */ new Set();
  for (const r of rows.slice(0, 5)) Object.keys(r || {}).forEach((k) => keys.add(headerKey(k)));
  const groups = tab === "Raw_Revenue" ? { "Order Value": ORDER_VALUE_HEADERS, Agent: ORDER_AGENT_HEADERS } : { "Agent ID": VISIT_AGENT_HEADERS };
  const missing = Object.entries(groups).filter(([, names]) => !names.some((n) => keys.has(headerKey(n)))).map(([label]) => label);
  if (missing.length > 0) {
    const found = Object.keys(rows[0] || {}).filter((k) => k.trim() !== "").slice(0, 12);
    throw new Error(
      `${tab}: missing column ${missing.join(", ")}. Row 1 of the tab must be the header row. Columns found: ${found.length ? found.map((f) => `"${f}"`).join(", ") : "(none)"}`
    );
  }
}
function buildLocationSummaries(orders) {
  const locationSummaries = {};
  const locations = ["Dighe", "Andheri", "Bangalore"];
  for (const loc of locations) {
    const locOrders = orders.filter((o) => o.location.toLowerCase() === loc.toLowerCase());
    const agentMap = /* @__PURE__ */ new Map();
    let totalOrders = 0;
    let totalRevenue = 0;
    let shopifyOrders = 0;
    let shopifyRevenue = 0;
    let altOrders = 0;
    let altRevenue = 0;
    let mpOrders = 0;
    let mpRevenue = 0;
    let posOrders = 0;
    let posRevenue = 0;
    for (const o of locOrders) {
      totalOrders++;
      totalRevenue += o.orderValue;
      const email = normalizeEmail(o.agentEmail);
      if (!agentMap.has(email)) {
        agentMap.set(email, {
          agentEmail: email,
          shopifyOrders: 0,
          shopifyRevenue: 0,
          altOrders: 0,
          altRevenue: 0,
          mpOrders: 0,
          mpRevenue: 0,
          posOrders: 0,
          posRevenue: 0,
          totalOrders: 0,
          totalRevenue: 0,
          aov: 0
        });
      }
      const ag = agentMap.get(email);
      ag.totalOrders++;
      ag.totalRevenue += o.orderValue;
      const cat = o.category.toLowerCase();
      if (cat.includes("shopify")) {
        shopifyOrders++;
        shopifyRevenue += o.orderValue;
        ag.shopifyOrders++;
        ag.shopifyRevenue += o.orderValue;
      } else if (cat.includes("another number") || cat.includes("alt")) {
        altOrders++;
        altRevenue += o.orderValue;
        ag.altOrders++;
        ag.altRevenue += o.orderValue;
      } else if (cat.includes("marketplace")) {
        mpOrders++;
        mpRevenue += o.orderValue;
        ag.mpOrders++;
        ag.mpRevenue += o.orderValue;
      } else if (cat.includes("pos")) {
        posOrders++;
        posRevenue += o.orderValue;
        ag.posOrders++;
        ag.posRevenue += o.orderValue;
      }
    }
    const rows = Array.from(agentMap.values()).map((r) => ({
      ...r,
      aov: r.totalOrders > 0 ? Math.round(r.totalRevenue / r.totalOrders) : 0
    }));
    rows.sort((a, b) => b.totalRevenue - a.totalRevenue);
    locationSummaries[loc] = {
      location: loc,
      totalOrders,
      totalRevenue,
      aov: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
      categories: {
        shopify: { orders: shopifyOrders, sales: shopifyRevenue },
        bfan: { orders: altOrders, sales: altRevenue },
        bfmp: { orders: mpOrders, sales: mpRevenue },
        posoc: { orders: posOrders, sales: posRevenue }
      },
      rows
    };
  }
  return locationSummaries;
}
function rawRecordsRef(cycleId) {
  return adminDb.collection("cycles").doc(cycleId).collection("data").doc("rawRecords");
}
function rawStatusRef(cycleId) {
  return adminDb.collection("cycles").doc(cycleId).collection("data").doc("rawRecordsStatus");
}
var RAW_RETRY_COOLDOWN_MS = 10 * 60 * 1e3;
async function recordRawSyncStatus(cycleId, status) {
  invalidateRawCache();
  try {
    await rawStatusRef(cycleId).set(status);
  } catch (e) {
    console.error("[RawData] Could not save the raw-data sync status:", e);
  }
}
async function getRawSyncStatus(cycleId) {
  try {
    const snap = await rawStatusRef(cycleId).get();
    return snap.exists ? snap.data() : null;
  } catch (_e) {
    return null;
  }
}
var RAW_CHUNK_SIZE = 1e3;
function rawChunksCol(cycleId) {
  return rawRecordsRef(cycleId).collection("chunks");
}
function chunk(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += RAW_CHUNK_SIZE) out.push(rows.slice(i, i + RAW_CHUNK_SIZE));
  return out;
}
var RAW_CACHE_TTL_MS = 3e4;
var rawCache = /* @__PURE__ */ new Map();
function invalidateRawCache() {
  rawCache.clear();
}
async function saveRawRecords(cycleId, orders, visits) {
  const locationSummaries = buildLocationSummaries(orders);
  const prev = await rawRecordsRef(cycleId).get();
  const prevData = prev.exists ? prev.data() : null;
  const orderChunks = chunk(orders);
  const visitChunks = chunk(visits);
  const batch = adminDb.batch();
  orderChunks.forEach((rows, i) => batch.set(rawChunksCol(cycleId).doc(`orders-${i}`), { rows }));
  visitChunks.forEach((rows, i) => batch.set(rawChunksCol(cycleId).doc(`visits-${i}`), { rows }));
  for (let i = orderChunks.length; i < (prevData?.orderChunks || 0); i++) batch.delete(rawChunksCol(cycleId).doc(`orders-${i}`));
  for (let i = visitChunks.length; i < (prevData?.visitChunks || 0); i++) batch.delete(rawChunksCol(cycleId).doc(`visits-${i}`));
  batch.set(rawRecordsRef(cycleId), {
    orderChunks: orderChunks.length,
    visitChunks: visitChunks.length,
    ordersCount: orders.length,
    visitsCount: visits.length,
    locationSummaries,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  await batch.commit();
  invalidateRawCache();
}
async function readRawRecords(cycleId) {
  const snap = await rawRecordsRef(cycleId).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (Array.isArray(d.orders) || Array.isArray(d.visits)) {
    return { orders: d.orders || [], visits: d.visits || [], locationSummaries: d.locationSummaries, updatedAt: d.updatedAt };
  }
  const read = async (prefix, count) => {
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => rawChunksCol(cycleId).doc(`${prefix}-${i}`).get())
    );
    return parts.flatMap((p) => p.exists ? p.data()?.rows || [] : []);
  };
  const [orders, visits] = await Promise.all([read("orders", d.orderChunks || 0), read("visits", d.visitChunks || 0)]);
  return { orders, visits, locationSummaries: d.locationSummaries, updatedAt: d.updatedAt };
}
async function saveRawPayload(cycleId, rawRevenueTabRows, rawVisitRows, excludedSet) {
  try {
    assertRawHeaders("Raw_Revenue", rawRevenueTabRows);
    assertRawHeaders("Raw_Visit", rawVisitRows);
    const orders = normalizeRawOrders(rawRevenueTabRows, excludedSet);
    const visits = normalizeRawVisits(rawVisitRows, excludedSet);
    await saveRawRecords(cycleId, orders, visits);
    const result = { ordersCount: orders.length, visitsCount: visits.length };
    await recordRawSyncStatus(cycleId, { ok: true, at: (/* @__PURE__ */ new Date()).toISOString(), source: "sync-payload", ...result });
    return result;
  } catch (err) {
    const error = err?.message || String(err);
    await recordRawSyncStatus(cycleId, { ok: false, at: (/* @__PURE__ */ new Date()).toISOString(), source: "sync-payload", error });
    throw new Error(error);
  }
}
var sheetFetch = (input, init) => fetch(input, init);
async function fetchTabCsv(spreadsheetId, tab) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;
  let res;
  try {
    res = await sheetFetch(url);
  } catch (err) {
    throw new Error(`${tab}: could not reach Google Sheets (${err?.message || err})`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    throw new Error(`${tab}: Google Sheets answered HTTP ${res.status}. Check the tab name and that the sheet is shared as "Anyone with the link can view".`);
  }
  if (!/csv|text\/plain/i.test(contentType)) {
    throw new Error(`${tab}: Google Sheets did not return CSV (got "${contentType || "unknown"}"). The sheet is probably not shared as "Anyone with the link can view".`);
  }
  return parseCSV(await res.text());
}
function spreadsheetIdOf(sheetUrl) {
  const match = (sheetUrl || "").match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}
async function syncRawSheetData(cycleId, sheetUrl = DEFAULT_RAW_SHEET_URL) {
  try {
    const excludedSet = /* @__PURE__ */ new Set();
    try {
      const excludesSnap = await adminDb.collection("cycles").doc(cycleId).collection("data").doc("excludedAgents").get();
      if (excludesSnap.exists) {
        const list = excludesSnap.data()?.list || [];
        for (const item of list) {
          if (item.active && item.agentEmail) {
            excludedSet.add(normalizeEmail(item.agentEmail));
          }
        }
      }
    } catch (e) {
      console.warn("Failed to load excluded agents in syncRawSheetData:", e);
    }
    const spreadsheetId = spreadsheetIdOf(sheetUrl);
    if (!spreadsheetId) throw new Error(`Not a Google Sheets URL: "${sheetUrl}"`);
    const [rawOrders, rawVisits] = await Promise.all([
      fetchTabCsv(spreadsheetId, "Raw_Revenue"),
      fetchTabCsv(spreadsheetId, "Raw_Visit")
    ]);
    assertRawHeaders("Raw_Revenue", rawOrders);
    assertRawHeaders("Raw_Visit", rawVisits);
    const orders = normalizeRawOrders(rawOrders, excludedSet);
    const visits = normalizeRawVisits(rawVisits, excludedSet);
    await saveRawRecords(cycleId, orders, visits);
    const result = { ordersCount: orders.length, visitsCount: visits.length };
    await recordRawSyncStatus(cycleId, { ok: true, at: (/* @__PURE__ */ new Date()).toISOString(), source: "sheet-csv", ...result });
    return result;
  } catch (err) {
    const error = err?.message || String(err);
    console.error("[RawData] Raw sheet sync failed:", error);
    await recordRawSyncStatus(cycleId, { ok: false, at: (/* @__PURE__ */ new Date()).toISOString(), source: "sheet-csv", error });
    throw new Error(error);
  }
}
async function getOrLoadRawRecords(cycleId) {
  const hit = rawCache.get(cycleId);
  if (hit && Date.now() - hit.at < RAW_CACHE_TTL_MS) return structuredClone(hit.value);
  const value = await getOrLoadRawRecordsUncached(cycleId);
  rawCache.set(cycleId, { at: Date.now(), value: structuredClone(value) });
  return value;
}
async function getOrLoadRawRecordsUncached(cycleId) {
  const saved = await readRawRecords(cycleId);
  const status = await getRawSyncStatus(cycleId);
  if (saved && (saved.orders.length > 0 || saved.visits.length > 0)) {
    return { ...saved, syncStatus: status };
  }
  const empty = { orders: [], visits: [], locationSummaries: {}, syncStatus: status };
  if (status && !status.ok && Date.now() - new Date(status.at).getTime() < RAW_RETRY_COOLDOWN_MS) {
    return empty;
  }
  let sheetUrl;
  try {
    const configSnap = await adminDb.collection("config").doc("app").get();
    if (configSnap.exists) {
      sheetUrl = configSnap.data()?.googleSpreadsheetUrl;
    }
  } catch (err) {
    console.warn("Failed to load config for spreadsheetUrl in getOrLoadRawRecords:", err);
  }
  try {
    await syncRawSheetData(cycleId, sheetUrl || DEFAULT_RAW_SHEET_URL);
  } catch (_err) {
    return { ...empty, syncStatus: await getRawSyncStatus(cycleId) };
  }
  const fresh = await readRawRecords(cycleId);
  return {
    orders: fresh?.orders || [],
    visits: fresh?.visits || [],
    locationSummaries: fresh?.locationSummaries || {},
    updatedAt: fresh?.updatedAt,
    syncStatus: await getRawSyncStatus(cycleId)
  };
}

// server-import.ts
var REQUIRED_MAIN_HEADERS = [
  "Date",
  "Agent_Name",
  "Agent_Email_Official",
  "Agent_Email_Personal",
  "Agent_Location",
  "Agent_Tier",
  "Count_of_Orders",
  "Sales",
  "Unique_Connects",
  "Talk_Time_Minutes",
  "Store_Visits",
  "Day"
];
var REQUIRED_QUALITY_HEADERS = [
  "Agent_Email_Official",
  "Total_Audits",
  "Average_Audit_Score"
];
function canonicalizeMainHeader(rawHeader) {
  const clean = String(rawHeader || "").trim();
  const normalized = clean.toLowerCase().replace(/[\s_\-\(\)\[\]\.\/\\]+/g, "");
  if (normalized === "talktimemins" || normalized === "talktimemin" || normalized === "talktimeminutes" || normalized === "talkminutes" || normalized === "talkmins" || normalized === "talkdurationmins" || normalized === "talkdurationminutes" || normalized === "totaltalktimemins" || normalized === "totaltalktimeminutes" || normalized === "talktimem" || normalized === "talktimeseconds" || normalized === "talktime" || normalized === "talkseconds" || normalized === "talktimesec" || normalized === "talktimesecs" || normalized === "talkduration" || normalized === "talkdurationseconds" || normalized === "totaltalktime" || normalized === "totaltalktimeseconds" || normalized === "talktimeinmins") {
    return "Talk_Time_Minutes";
  }
  if (normalized === "tlpersonalemail" || normalized === "tlemailpersonal" || normalized === "tlpersonal" || normalized === "tlemail" || normalized === "teamleaderpersonalemail" || normalized === "teamleaderemail" || normalized === "teamleaderpersonal" || normalized === "tlgmail" || normalized === "tlpersonalmail") {
    return "TL_Personal_Email";
  }
  if (normalized === "tlofficialemail" || normalized === "tlemailofficial" || normalized === "tlofficial" || normalized === "teamleaderofficialemail" || normalized === "teamleaderofficial") {
    return "TL_Official_Email";
  }
  if (normalized === "storevisits" || normalized === "visits" || normalized === "storevisitsattributed" || normalized === "visitsattributed" || normalized === "attributedstorevisits" || normalized === "attributedvisits" || normalized === "storevisitsbooked" || normalized === "visitsbooked" || normalized === "bookedstorevisits" || normalized === "bookedvisits") {
    return "Store_Visits";
  }
  if (normalized === "agentname" || normalized === "name" || normalized === "agent") {
    return "Agent_Name";
  }
  if (normalized === "agentemailofficial" || normalized === "agentofficialemail" || normalized === "officialemail" || normalized === "workemail" || normalized === "companyemail" || normalized === "agentemail") {
    return "Agent_Email_Official";
  }
  if (normalized === "agentemailpersonal" || normalized === "agentpersonalemail" || normalized === "personalemail" || normalized === "gmail" || normalized === "loginemail") {
    return "Agent_Email_Personal";
  }
  if (normalized === "agentlocation" || normalized === "location" || normalized === "branch" || normalized === "city") {
    return "Agent_Location";
  }
  if (normalized === "agenttier" || normalized === "tier" || normalized === "lob" || normalized === "category" || normalized === "role") {
    return "Agent_Tier";
  }
  if (normalized === "countoforders" || normalized === "orders" || normalized === "ordercount" || normalized === "totalorders") {
    return "Count_of_Orders";
  }
  if (normalized === "sales" || normalized === "revenue" || normalized === "netsales" || normalized === "totalsales" || normalized === "turnover") {
    return "Sales";
  }
  if (normalized === "averageordervalue" || normalized === "aov" || normalized === "avgordervalue") {
    return "Average_Order_Value";
  }
  if (normalized === "uniqueconnects" || normalized === "connects" || normalized === "totalconnects" || normalized === "callsconnected") {
    return "Unique_Connects";
  }
  if (normalized === "day" || normalized === "workingday" || normalized === "active" || normalized === "workedday" || normalized === "activedays") {
    return "Day";
  }
  if (normalized === "month") {
    return "Month";
  }
  if (normalized === "date") {
    return "Date";
  }
  if (normalized === "inboundcalls" || normalized === "calls" || normalized === "totalcalls" || normalized === "dailycalls") {
    return "Inbound_Calls";
  }
  if (normalized === "avgttperday" || normalized === "avgtt" || normalized === "averagett" || normalized === "avgttsec" || normalized === "talktimepercall" || normalized === "averagetalktime" || normalized === "avgttseconds") {
    return "Avg_TT_per_day";
  }
  return clean;
}
function headerKey2(h) {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function pickColumn(row, ...names) {
  const values = /* @__PURE__ */ new Map();
  for (const [k, v] of Object.entries(row || {})) values.set(headerKey2(k), v);
  for (const name of names) {
    const v = values.get(headerKey2(name));
    if (v !== void 0 && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function normalizeRawMainRow(row) {
  const normalized = {};
  for (const [k, v] of Object.entries(row)) {
    const canonical = canonicalizeMainHeader(k);
    normalized[canonical] = v;
  }
  if (normalized.Store_Visits === void 0) {
    normalized.Store_Visits = 0;
  }
  if (normalized.TL_Personal_Email === void 0) {
    normalized.TL_Personal_Email = "";
  }
  if (normalized.TL_Official_Email === void 0) {
    normalized.TL_Official_Email = "";
  }
  const rawTalk = normalized["Talk_Time_Minutes"];
  if (rawTalk !== void 0) {
    normalized["Talk_Time_Minutes"] = typeof rawTalk === "number" ? rawTalk : parseFloat(String(rawTalk).replace(/[^0-9.-]+/g, "")) || 0;
  } else {
    normalized["Talk_Time_Minutes"] = 0;
  }
  if (normalized.Month === void 0 && normalized.Date) {
    const d = new Date(normalized.Date);
    normalized.Month = !isNaN(d.getTime()) ? d.toLocaleString("en-US", { month: "short", year: "2-digit" }) : "";
  }
  if (normalized.Average_Order_Value === void 0) {
    const s = Number(normalized.Sales) || 0;
    const o = Number(normalized.Count_of_Orders) || 0;
    normalized.Average_Order_Value = o > 0 ? Math.round(s / o) : 0;
  }
  return normalized;
}
function canonicalizeQualityHeader(rawHeader) {
  const clean = String(rawHeader || "").trim();
  const normalized = clean.toLowerCase().replace(/[\s_\-\(\)\[\]\.\/\\]+/g, "");
  if (normalized === "agentemailofficial" || normalized === "agentofficialemail" || normalized === "officialemail" || normalized === "agentemail" || normalized === "email") {
    return "Agent_Email_Official";
  }
  if (normalized === "totalaudits" || normalized === "audits" || normalized === "auditcount" || normalized === "countofaudits") {
    return "Total_Audits";
  }
  if (normalized === "averageauditscore" || normalized === "auditscore" || normalized === "avgscore" || normalized === "qualityscore" || normalized === "score" || normalized === "avgauditscore") {
    return "Average_Audit_Score";
  }
  return clean;
}
function normalizeRawQualityRow(row) {
  const normalized = {};
  for (const [k, v] of Object.entries(row)) {
    const canonical = canonicalizeQualityHeader(k);
    normalized[canonical] = v;
  }
  return normalized;
}
var PRE_SALES_HEADERS = ["Inbound_Calls", "Avg_TT_per_day"];
var DEFAULT_SUPER_ADMIN = "agha.h489@gmail.com";
var DEFAULT_AI_SYNC_BUDGET_MS = 35e3;
function envEmails(name) {
  loadEnv();
  return (process.env[name] || "").split(/[,;\s]+/).map(normalizeEmail).filter(Boolean);
}
function defaultTierMap() {
  return {
    "HO Callers": "HO",
    "Store Callers": "STORE",
    PreSales: "PRE_SALES",
    "Pre Sales": "PRE_SALES",
    "Dighe (Pre Sales)": "PRE_SALES"
  };
}
function defaultAppConfig() {
  const superAdmins = envEmails("SUPER_ADMIN_EMAILS");
  const managers = envEmails("MANAGER_EMAILS");
  return {
    superAdmins: superAdmins.length > 0 ? superAdmins : [DEFAULT_SUPER_ADMIN],
    managers,
    activeCycleId: "diwali-2026",
    tierMap: defaultTierMap(),
    locations: ["Dighe (Pre Sales)", "Dighe", "Andheri", "Bangalore"],
    testMode: true,
    aiEnabled: false,
    aiTone: "english",
    googleSpreadsheetUrl: "https://docs.google.com/spreadsheets/d/1cyAdyup2UontNJecjnZYdS4ndBq8qZtX9JJ5qiuq8mk/edit?usp=sharing",
    legacyManagerMigrated: true
  };
}
var LEGACY_CODE_MANAGER = "snehatsc@gmail.com";
var CACHE_TTL_MS = 3e4;
var seedCache = null;
var agentsCache = /* @__PURE__ */ new Map();
function invalidateReadCache() {
  seedCache = null;
  agentsCache.clear();
}
async function ensureSeedData() {
  if (seedCache && Date.now() - seedCache.at < CACHE_TTL_MS) {
    return structuredClone(seedCache.value);
  }
  const value = await ensureSeedDataUncached();
  seedCache = { at: Date.now(), value: structuredClone(value) };
  return value;
}
async function ensureSeedDataUncached() {
  let appConfig = defaultAppConfig();
  try {
    const configRef = adminDb.collection("config").doc("app");
    const configSnap = await configRef.get();
    if (!configSnap.exists) {
      await configRef.set(appConfig);
    } else {
      appConfig = configSnap.data();
      const patch = {};
      if (!Array.isArray(appConfig.superAdmins) || appConfig.superAdmins.length === 0) {
        appConfig.superAdmins = defaultAppConfig().superAdmins;
        patch.superAdmins = appConfig.superAdmins;
      }
      if (!Array.isArray(appConfig.managers)) {
        appConfig.managers = [];
        patch.managers = appConfig.managers;
      }
      if (!appConfig.legacyManagerMigrated) {
        if (!appConfig.managers.map(normalizeEmail).includes(LEGACY_CODE_MANAGER)) {
          appConfig.managers = [...appConfig.managers, LEGACY_CODE_MANAGER];
          patch.managers = appConfig.managers;
        }
        appConfig.legacyManagerMigrated = true;
        patch.legacyManagerMigrated = true;
      }
      if (!appConfig.activeCycleId) {
        appConfig.activeCycleId = "diwali-2026";
        patch.activeCycleId = appConfig.activeCycleId;
      }
      if (!Array.isArray(appConfig.locations) || appConfig.locations.length === 0) {
        appConfig.locations = ["Dighe (Pre Sales)", "Dighe", "Andheri", "Bangalore"];
        patch.locations = appConfig.locations;
      } else if (!appConfig.locations.includes("Dighe (Pre Sales)")) {
        appConfig.locations.unshift("Dighe (Pre Sales)");
        patch.locations = appConfig.locations;
      }
      if (!appConfig.tierMap) {
        appConfig.tierMap = defaultTierMap();
        patch.tierMap = appConfig.tierMap;
      }
      if (!Object.values(appConfig.tierMap).includes("PRE_SALES")) {
        appConfig.tierMap["PreSales"] = "PRE_SALES";
        appConfig.tierMap["Pre Sales"] = "PRE_SALES";
        patch.tierMap = appConfig.tierMap;
      }
      if (!appConfig.googleSpreadsheetUrl) {
        appConfig.googleSpreadsheetUrl = "https://docs.google.com/spreadsheets/d/1cyAdyup2UontNJecjnZYdS4ndBq8qZtX9JJ5qiuq8mk/edit?usp=sharing";
        patch.googleSpreadsheetUrl = appConfig.googleSpreadsheetUrl;
      }
      if (Object.keys(patch).length > 0) {
        await configRef.set(patch, { merge: true });
      }
    }
  } catch (err) {
    console.warn("[ensureSeedData] Firestore read/write for config/app not accessible:", err?.message || err);
    throw err;
  }
  let cycle = {
    name: "Diwali 2026",
    startDate: "2026-10-01",
    endDate: "2026-11-30",
    status: "active",
    workingDaysPerWeek: 6,
    plans: {
      HO: defaultHOPlan,
      STORE: defaultSTOREPlan,
      PRE_SALES: defaultPreSalesPlan
    }
  };
  try {
    const cycleRef = adminDb.collection("cycles").doc(appConfig.activeCycleId || "diwali-2026");
    const cycleSnap = await cycleRef.get();
    if (!cycleSnap.exists) {
      await cycleRef.set(cycle);
    } else {
      cycle = cycleSnap.data();
      if (cycle.plans && !cycle.plans.PRE_SALES) {
        cycle.plans.PRE_SALES = defaultPreSalesPlan;
        await cycleRef.set({ plans: cycle.plans }, { merge: true });
      }
    }
  } catch (err) {
    console.warn("[ensureSeedData] Firestore read/write for active cycle not accessible:", err?.message || err);
    throw err;
  }
  return { appConfig, cycle };
}
async function loadAgents(cycleId) {
  const hit = agentsCache.get(cycleId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return structuredClone(hit.value);
  const snap = await adminDb.collection("cycles").doc(cycleId).collection("agents").get();
  const agents = snap.docs.map((d) => d.data());
  agentsCache.set(cycleId, { at: Date.now(), value: structuredClone(agents) });
  return agents;
}
function buildLeaderboardDocs(agents, appConfig) {
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  return appConfig.locations.map((location) => ({
    location,
    updatedAt,
    rows: buildLocationRows(agents, location, Boolean(appConfig.testMode))
  }));
}
async function rebuildLeaderboards(appConfig) {
  const cycleId = appConfig.activeCycleId;
  const agents = await loadAgents(cycleId);
  const col = adminDb.collection("cycles").doc(cycleId).collection("leaderboards");
  const batch = adminDb.batch();
  for (const doc of buildLeaderboardDocs(agents, appConfig)) {
    batch.set(col.doc(doc.location), doc);
  }
  await batch.commit();
}
async function clearTestData(appConfig) {
  const cycleId = appConfig.activeCycleId;
  const [allAgentsSnap, allAccessSnap, logsSnap] = await Promise.all([
    adminDb.collection("cycles").doc(cycleId).collection("agents").get(),
    adminDb.collection("access").get(),
    adminDb.collection("syncLogs").where("source", "==", "test").get()
  ]);
  const batch = adminDb.batch();
  let deletedAgents = 0;
  allAgentsSnap.forEach((d) => {
    const data = d.data();
    if (data.isTest || isTestAgentIdentifier(d.id, data.name) || isTestAgentIdentifier(data.officialEmail, data.name)) {
      batch.delete(d.ref);
      deletedAgents++;
    }
  });
  let deletedAccess = 0;
  allAccessSnap.forEach((d) => {
    const data = d.data();
    if (data.isTest || isTestAgentIdentifier(d.id, data.name) || isTestAgentIdentifier(data.officialEmail, data.name)) {
      batch.delete(d.ref);
      deletedAccess++;
    }
  });
  logsSnap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  await rebuildLeaderboards(appConfig);
  return {
    deletedAgents,
    deletedAccess,
    deletedSyncLogs: logsSnap.size
  };
}
async function saveAiText(cycleId, agents) {
  const col = adminDb.collection("cycles").doc(cycleId).collection("agents");
  const batch = adminDb.batch();
  for (const agent of agents) {
    if (agent.aiSuggestions) {
      batch.set(col.doc(agent.officialEmail), { aiSuggestions: agent.aiSuggestions }, { merge: true });
    }
  }
  await batch.commit();
}
async function processImport(source, mainRows, qualityRows = [], options = {}) {
  const warnings = [];
  const revenueRows = options.revenueRows || [];
  let rawData;
  try {
    if (!Array.isArray(mainRows) || mainRows.length === 0) {
      const err = "No data rows found in MainSheet";
      await logSync(source, "error", 0, 0, "", [err], err);
      return { result: "error", warnings: [err], error: err };
    }
    const normalizedMainRows = mainRows.map(normalizeRawMainRow);
    const normalizedQualityRows = (qualityRows || []).map(normalizeRawQualityRow);
    const sampleMain = normalizedMainRows[0] || {};
    const mainKeys = Object.keys(sampleMain);
    const missingMain = REQUIRED_MAIN_HEADERS.filter((h) => !mainKeys.includes(h));
    if (missingMain.length > 0) {
      const err = `Missing MainSheet headers: ${missingMain.join(", ")}`;
      await logSync(source, "error", 0, 0, "", [err], err);
      return { result: "error", warnings: [err], error: err };
    }
    const preSalesColumnsMissing = PRE_SALES_HEADERS.filter((h) => !mainKeys.includes(h));
    let preSalesColumnsWarned = false;
    if (normalizedQualityRows && normalizedQualityRows.length > 0) {
      const sampleQuality = normalizedQualityRows[0] || {};
      const qualityKeys = Object.keys(sampleQuality);
      const missingQuality = REQUIRED_QUALITY_HEADERS.filter(
        (h) => !qualityKeys.includes(h)
      );
      if (missingQuality.length > 0) {
        const err = `Missing Quality headers: ${missingQuality.join(", ")}`;
        await logSync(source, "error", 0, 0, "", [err], err);
        return { result: "error", warnings: [err], error: err };
      }
    }
    const { appConfig, cycle } = await ensureSeedData();
    const cycleId = appConfig.activeCycleId;
    const startDate = cycle.startDate;
    const endDate = cycle.endDate;
    const excludedEmails = /* @__PURE__ */ new Set();
    let excludedAgentsList = [];
    try {
      const excludesSnap = await adminDb.collection("cycles").doc(cycleId).collection("data").doc("excludedAgents").get();
      if (excludesSnap.exists) {
        const data = excludesSnap.data();
        if (Array.isArray(data?.list)) {
          data.list.forEach((item) => {
            if (item.active && item.agentEmail) {
              excludedEmails.add(normalizeEmail(item.agentEmail));
            }
            excludedAgentsList.push(item);
          });
        }
      }
    } catch (e) {
      console.warn("Failed to load existing excluded agents:", e);
    }
    if (options.excludedAgentsRows && options.excludedAgentsRows.length > 0) {
      excludedEmails.clear();
      excludedAgentsList = [];
      for (const row of options.excludedAgentsRows) {
        const rawEmail = row["Agent_Email_Official"] || row["agentofficialemail"] || row["Agent Email Official"] || "";
        const email = normalizeEmail(rawEmail);
        if (!email) continue;
        const activeVal = String(row["Active_Exclusion"] || row["activeexclusion"] || row["Active Exclusion"] || "").trim().toLowerCase();
        const active = activeVal === "true" || activeVal === "yes" || activeVal === "1";
        excludedAgentsList.push({
          agentEmail: email,
          reason: row["Reason"] || row["reason"] || "",
          excludedSince: row["Excluded_Since"] || row["excludedsince"] || "",
          active
        });
        if (active) {
          excludedEmails.add(email);
        }
      }
      await adminDb.collection("cycles").doc(cycleId).collection("data").doc("excludedAgents").set({
        list: excludedAgentsList,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    const hasRawPayload = options.rawVisitRows && options.rawVisitRows.length > 0 || options.rawRevenueTabRows && options.rawRevenueTabRows.length > 0;
    try {
      if (hasRawPayload) {
        rawData = await saveRawPayload(cycleId, options.rawRevenueTabRows || [], options.rawVisitRows || [], excludedEmails);
      } else {
        console.log("[Import] No raw rows in payload. Syncing raw sheet directly from", appConfig.googleSpreadsheetUrl);
        rawData = await syncRawSheetData(cycleId, appConfig.googleSpreadsheetUrl || DEFAULT_RAW_SHEET_URL);
      }
    } catch (err) {
      const reason = err?.message || String(err);
      rawData = { ordersCount: 0, visitsCount: 0, error: reason };
      warnings.push(`Raw data (Raw_Revenue / Raw_Visit) not saved: ${reason}`);
    }
    const leaderMappingDict = /* @__PURE__ */ new Map();
    const rawMappings = options.leaderMappingRows || [];
    for (const row of rawMappings) {
      const official = normalizeEmail(
        pickColumn(row, "Agent_Email_Official", "Agent_Official_Email", "Official_Email", "Agent_Official_Mail", "Agent_Email")
      );
      if (!official) continue;
      const personal = normalizeEmail(
        pickColumn(row, "Agent_Email_Personal", "Agent_Personal_Email", "Personal_Email", "Agent_Gmail_Mail", "Agent_Gmail", "Gmail", "Login_Email")
      );
      const tlOfficial = normalizeEmail(
        pickColumn(row, "TL_Official_Email", "TL_Email_Official", "Leader_Official_Mail", "Leader_Official_Email", "Team_Leader_Official_Email")
      );
      const tlPersonal = normalizeEmail(
        pickColumn(row, "TL_Personal_Email", "TL_Email_Personal", "Leader_Gmail_Mail", "Leader_Personal_Email", "TL_Gmail", "Team_Leader_Personal_Email")
      );
      const status = pickColumn(row, "Status") || "Active";
      leaderMappingDict.set(official, {
        personalEmail: personal,
        tlOfficialEmail: tlOfficial,
        tlPersonalEmail: tlPersonal,
        status
      });
    }
    if (source === "test" && !appConfig.testMode) {
      const err = "Test mode is off. Demo users can only be created while test mode is on (Admin tab > Go live / test mode).";
      await logSync(source, "error", 0, 0, "", [err], err);
      return { result: "error", warnings: [err], error: err };
    }
    const qualityMap = /* @__PURE__ */ new Map();
    if (normalizedQualityRows) {
      for (const q of normalizedQualityRows) {
        const email = normalizeEmail(q.Agent_Email_Official);
        if (email) {
          qualityMap.set(email, q);
        }
      }
    }
    const groupedByAgent = /* @__PURE__ */ new Map();
    const validMainRows = [];
    let validRowCount = 0;
    for (const r of normalizedMainRows) {
      const istDate = parseToISTDateString(r.Date);
      if (!istDate || istDate < startDate || istDate > endDate) {
        continue;
      }
      const officialEmail = normalizeEmail(r.Agent_Email_Official);
      if (!officialEmail) {
        continue;
      }
      validRowCount++;
      validMainRows.push(r);
      if (!groupedByAgent.has(officialEmail)) {
        groupedByAgent.set(officialEmail, []);
      }
      groupedByAgent.get(officialEmail).push(r);
    }
    if (groupedByAgent.size === 0) {
      const warningMsg = `No rows matched cycle date range (${startDate} to ${endDate}).`;
      warnings.push(warningMsg);
      await logSync(source, "ok", validRowCount, 0, "", warnings);
      return {
        result: "ok",
        rows: validRowCount,
        agents: 0,
        lastDataDate: "",
        warnings,
        rawData
      };
    }
    const existingAgentsSnap = await adminDb.collection("cycles").doc(cycleId).collection("agents").get();
    const existingAgentData = /* @__PURE__ */ new Map();
    existingAgentsSnap.forEach((doc) => {
      existingAgentData.set(doc.id, doc.data());
    });
    const updatedAgents = [];
    let overallLastDate = "";
    const agentAccessEntries = [];
    const tlAccessEntries = [];
    const knownTlAccessSnap = await adminDb.collection("access").get();
    const tlOfficialToPersonal = /* @__PURE__ */ new Map();
    knownTlAccessSnap.forEach((d) => {
      const data = d.data();
      if (data?.role === "tl" && data.officialEmail) {
        tlOfficialToPersonal.set(normalizeEmail(data.officialEmail), d.id);
      }
    });
    const emailsToDelete = /* @__PURE__ */ new Set();
    for (const [officialEmail, agentRows] of groupedByAgent.entries()) {
      if (excludedEmails.has(officialEmail)) {
        emailsToDelete.add(officialEmail);
        continue;
      }
      const qualityRow = qualityMap.get(officialEmail) || null;
      const aggregated = aggregateAgent(agentRows, qualityRow);
      const lmInfo = leaderMappingDict.get(officialEmail);
      if (lmInfo) {
        if (lmInfo.personalEmail) {
          const fromMain = normalizeEmail(aggregated.profile.personalEmail);
          if (fromMain && fromMain !== lmInfo.personalEmail) {
            warnings.push(
              `Agent ${aggregated.profile.name} (${officialEmail}): MainSheet has Gmail '${fromMain}' but Leader_Mapping has '${lmInfo.personalEmail}'. Using Leader_Mapping.`
            );
          }
          aggregated.profile.personalEmail = lmInfo.personalEmail;
        }
        if (lmInfo.tlOfficialEmail && !aggregated.profile.tlOfficialEmail) {
          aggregated.profile.tlOfficialEmail = lmInfo.tlOfficialEmail;
        }
        if (lmInfo.tlPersonalEmail && !aggregated.profile.tlPersonalEmail) {
          aggregated.profile.tlPersonalEmail = lmInfo.tlPersonalEmail;
        }
      }
      if (aggregated.lastDataDate > overallLastDate) {
        overallLastDate = aggregated.lastDataDate;
      }
      let mappedType = resolveAgentType(appConfig.tierMap, aggregated.profile.agentTierRaw);
      const rawLoc = aggregated.profile.location.trim();
      if (!mappedType && rawLoc.toLowerCase().includes("pre sales")) {
        mappedType = "PRE_SALES";
      }
      if (!mappedType) {
        warnings.push(
          `Agent ${aggregated.profile.name} (${officialEmail}): Unknown tier '${aggregated.profile.agentTierRaw}'. Skipped.`
        );
        continue;
      }
      let loc = rawLoc;
      if (mappedType === "PRE_SALES" && (loc.toLowerCase() === "dighe" || loc.toLowerCase().includes("pre sales"))) {
        loc = "Dighe (Pre Sales)";
        aggregated.profile.location = loc;
      }
      if (!appConfig.locations.includes(loc)) {
        const match = appConfig.locations.find((l) => l.toLowerCase() === loc.toLowerCase());
        if (match) {
          loc = match;
          aggregated.profile.location = loc;
        } else {
          warnings.push(
            `Agent ${aggregated.profile.name} (${officialEmail}): Unknown location '${aggregated.profile.location}'. Skipped.`
          );
          continue;
        }
      }
      const existing = existingAgentData.get(officialEmail);
      const absentDays = existing && existing.absentDays !== void 0 ? existing.absentDays : null;
      const agentIsTest = source === "test" || agentRows.some((r) => r.isTest) || isTestAgentIdentifier(officialEmail, aggregated.profile.name);
      let result;
      if (mappedType === "PRE_SALES") {
        if (preSalesColumnsMissing.length > 0 && !preSalesColumnsWarned) {
          warnings.push(
            `MainSheet is missing Pre Sales columns: ${preSalesColumnsMissing.join(", ")}. Pre Sales incentives stay at 0 until they are added.`
          );
          preSalesColumnsWarned = true;
        }
        if ((aggregated.totals.calls ?? 0) === 0 && aggregated.totals.activeDays > 0) {
          warnings.push(
            `Agent ${aggregated.profile.name} (${officialEmail}): Pre Sales agent has no Inbound_Calls in this cycle.`
          );
        }
        const psPlan = getPreSalesPlan(cycle);
        result = calculatePreSales(
          preSalesMetricsFromTotals(aggregated.totals, aggregated.quality, psPlan),
          psPlan
        );
      } else {
        const plan = cycle.plans[mappedType];
        if (!plan) {
          warnings.push(
            `Agent ${aggregated.profile.name} (${officialEmail}): No plan found for tier '${mappedType}'. Skipped.`
          );
          continue;
        }
        const metrics = metricsFromTotals(aggregated.totals, aggregated.quality, absentDays);
        result = calculateFromMetrics(metrics, plan);
      }
      let effectiveTlPersonalEmail = aggregated.profile.tlPersonalEmail;
      if (!effectiveTlPersonalEmail && aggregated.profile.tlOfficialEmail) {
        effectiveTlPersonalEmail = tlOfficialToPersonal.get(normalizeEmail(aggregated.profile.tlOfficialEmail)) || "";
      }
      const agentRecord = {
        name: aggregated.profile.name,
        officialEmail,
        personalEmail: aggregated.profile.personalEmail,
        location: aggregated.profile.location,
        agentType: mappedType,
        tlOfficialEmail: aggregated.profile.tlOfficialEmail,
        tlPersonalEmail: effectiveTlPersonalEmail,
        totals: aggregated.totals,
        daily: aggregated.daily,
        quality: aggregated.quality,
        absentDays,
        lastDataDate: aggregated.lastDataDate,
        result,
        isTest: agentIsTest,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      if (appConfig.aiEnabled && existing?.aiSuggestions?.fingerprint && existing.aiSuggestions.fingerprint === aiFingerprint(agentRecord)) {
        agentRecord.aiSuggestions = existing.aiSuggestions;
      }
      updatedAgents.push(agentRecord);
      if (agentRecord.personalEmail) {
        agentAccessEntries.push({
          email: agentRecord.personalEmail,
          doc: {
            role: "agent",
            officialEmail,
            name: agentRecord.name,
            location: agentRecord.location,
            isTest: agentIsTest
          }
        });
      }
      if (agentRecord.tlPersonalEmail) {
        tlAccessEntries.push({
          email: agentRecord.tlPersonalEmail,
          doc: {
            role: "tl",
            officialEmail: agentRecord.tlOfficialEmail,
            name: "Team Leader",
            location: agentRecord.location,
            isTest: agentIsTest
          }
        });
      }
    }
    const notInMain = Array.from(leaderMappingDict.entries()).filter(([official, info]) => !groupedByAgent.has(official) && !excludedEmails.has(official) && !/inactive|left|exit/i.test(info.status)).map(([official, info]) => info.personalEmail ? `${official} (${info.personalEmail})` : official);
    if (notInMain.length > 0) {
      warnings.push(
        `${notInMain.length} agent(s) in Leader_Mapping have no MainSheet rows between ${startDate} and ${endDate}, so they cannot sign in yet: ${notInMain.slice(0, 20).join(", ")}${notInMain.length > 20 ? ", ..." : ""}`
      );
    }
    const batch = adminDb.batch();
    const agentsCollection = adminDb.collection("cycles").doc(cycleId).collection("agents");
    for (const agent of updatedAgents) {
      batch.set(agentsCollection.doc(agent.officialEmail), agent);
    }
    for (const email of emailsToDelete) {
      batch.delete(agentsCollection.doc(email));
    }
    for (const entry of agentAccessEntries) {
      batch.set(adminDb.collection("access").doc(entry.email), entry.doc, { merge: true });
    }
    const tlMap = /* @__PURE__ */ new Map();
    for (const entry of tlAccessEntries) {
      const existing = tlMap.get(entry.email);
      if (!existing) {
        tlMap.set(entry.email, entry.doc);
      } else {
        if (existing.location.includes("(") && !entry.doc.location.includes("(")) {
          tlMap.set(entry.email, entry.doc);
        }
      }
    }
    for (const [email, doc] of tlMap.entries()) {
      batch.set(adminDb.collection("access").doc(email), doc, { merge: true });
    }
    const allAgentsMap = /* @__PURE__ */ new Map();
    existingAgentData.forEach((data, email) => {
      if (!excludedEmails.has(normalizeEmail(email))) {
        allAgentsMap.set(email, data);
      }
    });
    for (const agent of updatedAgents) {
      if (!excludedEmails.has(normalizeEmail(agent.officialEmail))) {
        allAgentsMap.set(agent.officialEmail, agent);
      }
    }
    for (const email of emailsToDelete) {
      allAgentsMap.delete(email);
    }
    const leaderboardCollection = adminDb.collection("cycles").doc(cycleId).collection("leaderboards");
    for (const doc of buildLeaderboardDocs(Array.from(allAgentsMap.values()), appConfig)) {
      batch.set(leaderboardCollection.doc(doc.location), doc);
    }
    const teamRevenueCollection = adminDb.collection("cycles").doc(cycleId).collection("teamRevenue");
    const filteredMainRows = validMainRows.filter((r) => !excludedEmails.has(normalizeEmail(r.Agent_Email_Official)));
    for (const loc of ["Dighe", "Andheri", "Bangalore"]) {
      const revDoc = buildTeamRevenue(loc, cycleId, filteredMainRows, revenueRows);
      batch.set(teamRevenueCollection.doc(loc), revDoc);
    }
    const syncLogRef = adminDb.collection("syncLogs").doc();
    const syncLogDoc = {
      time: (/* @__PURE__ */ new Date()).toISOString(),
      source,
      result: "ok",
      rows: validRowCount,
      agents: updatedAgents.length,
      lastDataDate: overallLastDate,
      warnings
    };
    batch.set(syncLogRef, syncLogDoc);
    await batch.commit();
    const ai = { ok: 0, failed: 0, skipped: 0, pending: 0 };
    if (appConfig.aiEnabled && updatedAgents.length > 0) {
      const need = updatedAgents.filter((a) => !aiTextIsCurrent(a));
      ai.skipped = updatedAgents.length - need.length;
      if (need.length > 0) {
        if (!isAiConfigured()) {
          ai.failed = need.length;
          warnings.push(
            "AI text is switched on, but GEMINI_API_KEY is not set on the server. Agents see the rule-based text."
          );
        } else {
          try {
            const budget = options.aiBudgetMs ?? (Number(process.env.AI_SYNC_BUDGET_MS) || DEFAULT_AI_SYNC_BUDGET_MS);
            const run = await runBatchAiGeneration(need, cycle, appConfig, { budgetMs: budget });
            ai.ok = run.okCount;
            ai.failed = run.failedCount;
            ai.pending = run.pendingCount;
            await saveAiText(cycleId, run.generatedAgents);
          } catch (aiErr) {
            console.error("AI text step failed after the data was saved:", aiErr);
            warnings.push(`AI text generation failed: ${aiErr?.message || String(aiErr)}`);
            ai.failed = need.length - ai.ok;
          }
        }
      }
      try {
        await syncLogRef.set(
          { warnings, aiOk: ai.ok, aiFailed: ai.failed, aiSkipped: ai.skipped, aiPending: ai.pending },
          { merge: true }
        );
      } catch (logErr) {
        console.error("Failed to complete the sync log entry:", logErr);
      }
    }
    return {
      result: "ok",
      rows: validRowCount,
      agents: updatedAgents.length,
      lastDataDate: overallLastDate,
      warnings,
      rawData,
      ...appConfig.aiEnabled ? { aiOk: ai.ok, aiFailed: ai.failed, aiSkipped: ai.skipped, aiPending: ai.pending } : {}
    };
  } catch (err) {
    const errorMsg = err?.message || String(err);
    warnings.push(errorMsg);
    await logSync(source, "error", 0, 0, "", warnings, errorMsg);
    return {
      result: "error",
      warnings,
      error: errorMsg
    };
  }
}
async function logSync(source, result, rows, agents, lastDataDate, warnings, error) {
  try {
    await adminDb.collection("syncLogs").add({
      time: (/* @__PURE__ */ new Date()).toISOString(),
      source,
      result,
      rows,
      agents,
      lastDataDate,
      warnings,
      ...error ? { error } : {}
    });
  } catch (e) {
    console.error("Failed to write sync log:", e);
  }
}

// server-readiness.ts
function todayIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1e3).toISOString().split("T")[0];
}
function daysBetween(fromDate, toDate) {
  const a = (/* @__PURE__ */ new Date(fromDate + "T00:00:00Z")).getTime();
  const b = (/* @__PURE__ */ new Date(toDate + "T00:00:00Z")).getTime();
  return Math.round((b - a) / 864e5);
}
async function buildReadiness() {
  const { appConfig, cycle } = await ensureSeedData();
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });
  if (adminDb.kind === "local") {
    add(
      "database",
      "Database",
      "fail",
      "The server is using a local file (DB_MODE=local), not Firestore. Nothing is shared with the browser. Remove DB_MODE before going live."
    );
  } else {
    try {
      await adminDb.healthCheck();
      add("database", "Database", "ok", "The server can write to and read from Firestore.");
    } catch (err) {
      add("database", "Database", "fail", err?.message || String(err));
    }
  }
  const syncKey = process.env.SYNC_KEY || "";
  if (!syncKey) {
    add("sync-key", "Sync key", "fail", "SYNC_KEY is not set on the server, so the Google Sheet cannot sync. Add it in the AI Studio secrets.");
  } else if (syncKey.length < 16) {
    add("sync-key", "Sync key", "warn", `SYNC_KEY is set but short (${syncKey.length} characters). Use 24 or more random characters, different from the test key.`);
  } else {
    add("sync-key", "Sync key", "ok", "SYNC_KEY is set on the server. The Apps Script must use the same value.");
  }
  if (appConfig.testMode) {
    add("mode", "Mode", "warn", "TEST MODE is on: demo users are visible to everyone and the demo tools are open. Switch to Live before real agents log in.");
  } else {
    add("mode", "Mode", "ok", "LIVE: demo users are hidden from everyone except the Super Admin.");
  }
  add(
    "super-admins",
    "Super Admins",
    appConfig.superAdmins.length > 0 ? "ok" : "fail",
    `${appConfig.superAdmins.length} Super Admin account(s).`
  );
  add(
    "managers",
    "Managers",
    appConfig.managers.length > 0 ? "ok" : "warn",
    appConfig.managers.length > 0 ? `${appConfig.managers.length} Manager account(s).` : "No Managers yet. Add their personal Gmail addresses under Roles & access."
  );
  const agents = await loadAgents(appConfig.activeCycleId);
  const real = agents.filter((a) => !a.isTest);
  const demo = agents.filter((a) => a.isTest);
  const realByType = { HO: 0, STORE: 0, PRE_SALES: 0 };
  for (const a of real) realByType[a.agentType] = (realByType[a.agentType] || 0) + 1;
  add(
    "agents",
    "Real agents",
    real.length > 0 ? "ok" : "warn",
    real.length > 0 ? `${real.length} real agent(s): ${realByType.HO} HO, ${realByType.STORE} Store, ${realByType.PRE_SALES} Pre Sales.` : "No real agents loaded yet. Run Sync Now from the Google Sheet (Incentive App menu)."
  );
  if (demo.length > 0) {
    add(
      "demo-users",
      "Demo users",
      appConfig.testMode ? "ok" : "warn",
      appConfig.testMode ? `${demo.length} demo user(s) stored.` : `${demo.length} demo user(s) are still stored. Only the Super Admin sees them. Switch to test mode and use Clear Test Data to remove them.`
    );
  }
  const logsSnap = await adminDb.collection("syncLogs").orderBy("time", "desc").limit(30).get();
  const logs = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const lastSync = logs[0] || null;
  const lastRealSync = logs.find((l) => l.source !== "test") || null;
  if (!lastRealSync) {
    add("sync", "Last sync from the sheet", "warn", "No sync from the Google Sheet or an Excel import yet.");
  } else if (lastRealSync.result === "error") {
    add("sync", "Last sync from the sheet", "fail", `The last sync failed: ${lastRealSync.error || "unknown error"}`);
  } else {
    const stale = lastRealSync.lastDataDate && daysBetween(lastRealSync.lastDataDate, todayIST()) > 2;
    add(
      "sync",
      "Last sync from the sheet",
      stale ? "warn" : "ok",
      `${new Date(lastRealSync.time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST, ${lastRealSync.agents ?? 0} agents, data up to ${lastRealSync.lastDataDate || "n/a"}${stale ? " (more than 2 days old)" : ""}.`
    );
    const psWarning = (lastRealSync.warnings || []).find((w) => /missing Pre Sales columns/i.test(w));
    if (psWarning) add("pre-sales-columns", "Pre Sales columns", "warn", psWarning);
    const otherWarnings = (lastRealSync.warnings || []).filter((w) => w !== psWarning);
    if (otherWarnings.length > 0) {
      add("sync-warnings", "Sync warnings", "warn", otherWarnings.slice(0, 3).join(" | ") + (otherWarnings.length > 3 ? ` (+${otherWarnings.length - 3} more)` : ""));
    }
  }
  if (!appConfig.aiEnabled) {
    add("ai", "AI coaching text", "ok", "Off: agents see the rule-based coaching text.");
  } else if (!isAiConfigured()) {
    add("ai", "AI coaching text", "fail", "AI text is on, but GEMINI_API_KEY is not set on the server. Add it in the AI Studio secrets, or switch AI text off.");
  } else {
    add("ai", "AI coaching text", "ok", "On, and the Gemini key is set. Text is written after each sync; the numbers are validated.");
  }
  return {
    checks,
    facts: {
      storage: adminDb.kind,
      testMode: Boolean(appConfig.testMode),
      cycle: {
        id: appConfig.activeCycleId,
        name: cycle.name,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        status: cycle.status
      },
      realAgents: real.length,
      demoAgents: demo.length,
      realByType,
      lastSync,
      lastRealSync
    }
  };
}

// server-login-tracker.ts
var DEFAULT_LOGIN_TRACKER_CONFIG = {
  enabled: true,
  amWindowMinutes: 30,
  // 30 min in AM (12:00 AM - 11:59 AM)
  pmWindowMinutes: 30,
  // 30 min in PM (12:00 PM - 11:59 PM)
  timezone: "Asia/Kolkata"
};
function getWindowInfo(now = /* @__PURE__ */ new Date(), config) {
  const tz = config?.timezone || DEFAULT_LOGIN_TRACKER_CONFIG.timezone || "Asia/Kolkata";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const year = map.year;
  const month = map.month;
  const day = map.day;
  const hour = parseInt(map.hour || "0", 10);
  const minute = parseInt(map.minute || "0", 10);
  const second = parseInt(map.second || "0", 10);
  const dateKey = `${year}-${month}-${day}`;
  const isAm = hour < 12;
  const windowId = isAm ? "AM" : "PM";
  const amLimit = config?.amWindowMinutes !== void 0 ? config.amWindowMinutes : DEFAULT_LOGIN_TRACKER_CONFIG.amWindowMinutes;
  const pmLimit = config?.pmWindowMinutes !== void 0 ? config.pmWindowMinutes : DEFAULT_LOGIN_TRACKER_CONFIG.pmWindowMinutes;
  const windowLimitMinutes = isAm ? amLimit : pmLimit;
  const windowLimitSeconds = Math.max(1, windowLimitMinutes * 60);
  const endHour = isAm ? 12 : 24;
  const secondsUntilWindowEnd = Math.max(0, endHour * 3600 - (hour * 3600 + minute * 60 + second));
  const nextWindowOpensAt = isAm ? "12:00 PM IST" : "12:00 AM IST";
  return {
    dateKey,
    windowId,
    isAm,
    hour,
    minute,
    second,
    windowLimitMinutes,
    windowLimitSeconds,
    secondsUntilWindowEnd,
    nextWindowOpensAt
  };
}
async function checkAgentAllowance(agentEmail, config, now = /* @__PURE__ */ new Date()) {
  const isEnabled = config?.enabled !== false;
  const windowInfo = getWindowInfo(now, config);
  if (!isEnabled) {
    return {
      enabled: false,
      windowId: windowInfo.windowId,
      dateKey: windowInfo.dateKey,
      remainingSeconds: 86400,
      windowLimitMinutes: windowInfo.windowLimitMinutes,
      usedSeconds: 0,
      secondsUntilWindowEnd: windowInfo.secondsUntilWindowEnd,
      allowed: true,
      nextWindowOpensAt: windowInfo.nextWindowOpensAt
    };
  }
  const cleanEmail = normalizeEmail(agentEmail);
  const docId = `${cleanEmail}_${windowInfo.dateKey}`;
  const docSnap = await adminDb.collection("loginActivity").doc(docId).get();
  const data = docSnap.exists ? docSnap.data() : null;
  const usedSeconds = windowInfo.isAm ? data?.amSecondsUsed || 0 : data?.pmSecondsUsed || 0;
  const remainingSeconds = Math.max(0, windowInfo.windowLimitSeconds - usedSeconds);
  const allowed = remainingSeconds > 0;
  let reason = void 0;
  if (!allowed) {
    const windowLabel = windowInfo.isAm ? "AM window (12:00 AM \u2013 11:59 AM)" : "PM window (12:00 PM \u2013 11:59 PM)";
    reason = `Time Limit Exceeded: You have used your ${windowInfo.windowLimitMinutes}-minute access limit for the ${windowLabel}. Your next access window opens at ${windowInfo.nextWindowOpensAt}.`;
  }
  return {
    enabled: true,
    windowId: windowInfo.windowId,
    dateKey: windowInfo.dateKey,
    remainingSeconds,
    windowLimitMinutes: windowInfo.windowLimitMinutes,
    usedSeconds,
    secondsUntilWindowEnd: windowInfo.secondsUntilWindowEnd,
    allowed,
    reason,
    nextWindowOpensAt: windowInfo.nextWindowOpensAt
  };
}
async function recordAgentHeartbeat(agentEmail, config, now = /* @__PURE__ */ new Date()) {
  const isEnabled = config?.enabled !== false;
  const windowInfo = getWindowInfo(now, config);
  if (!isEnabled) {
    return {
      enabled: false,
      windowId: windowInfo.windowId,
      dateKey: windowInfo.dateKey,
      remainingSeconds: 86400,
      windowLimitMinutes: windowInfo.windowLimitMinutes,
      usedSeconds: 0,
      secondsUntilWindowEnd: windowInfo.secondsUntilWindowEnd,
      allowed: true,
      nextWindowOpensAt: windowInfo.nextWindowOpensAt
    };
  }
  const cleanEmail = normalizeEmail(agentEmail);
  const docId = `${cleanEmail}_${windowInfo.dateKey}`;
  const docRef = adminDb.collection("loginActivity").doc(docId);
  const docSnap = await docRef.get();
  const data = docSnap.exists ? docSnap.data() : null;
  const nowMs = now.getTime();
  const lastTime = data?.lastHeartbeatTime;
  const lastWindow = data?.lastWindow;
  let delta = 0;
  if (lastTime && lastWindow === windowInfo.windowId) {
    const diffMs = nowMs - lastTime;
    if (diffMs > 0 && diffMs <= 45e3) {
      delta = Math.min(30, Math.max(1, Math.round(diffMs / 1e3)));
    } else {
      delta = 1;
    }
  } else {
    delta = 1;
  }
  const prevAm = data?.amSecondsUsed || 0;
  const prevPm = data?.pmSecondsUsed || 0;
  const newAm = windowInfo.isAm ? prevAm + delta : prevAm;
  const newPm = !windowInfo.isAm ? prevPm + delta : prevPm;
  const currentUsed = windowInfo.isAm ? newAm : newPm;
  const remainingSeconds = Math.max(0, windowInfo.windowLimitSeconds - currentUsed);
  const allowed = remainingSeconds > 0;
  await docRef.set(
    {
      agentEmail: cleanEmail,
      date: windowInfo.dateKey,
      amSecondsUsed: newAm,
      pmSecondsUsed: newPm,
      lastHeartbeatTime: nowMs,
      lastWindow: windowInfo.windowId,
      updatedAt: now.toISOString()
    },
    { merge: true }
  );
  let reason = void 0;
  if (!allowed) {
    const windowLabel = windowInfo.isAm ? "AM window (12:00 AM \u2013 11:59 AM)" : "PM window (12:00 PM \u2013 11:59 PM)";
    reason = `Time Limit Exceeded: You have completed your ${windowInfo.windowLimitMinutes}-minute access limit for the ${windowLabel}. Your next access window opens at ${windowInfo.nextWindowOpensAt}.`;
  }
  return {
    enabled: true,
    windowId: windowInfo.windowId,
    dateKey: windowInfo.dateKey,
    remainingSeconds,
    windowLimitMinutes: windowInfo.windowLimitMinutes,
    usedSeconds: currentUsed,
    secondsUntilWindowEnd: windowInfo.secondsUntilWindowEnd,
    allowed,
    reason,
    nextWindowOpensAt: windowInfo.nextWindowOpensAt
  };
}
async function resetAgentLoginUsage(agentEmail, dateKey, now = /* @__PURE__ */ new Date()) {
  const windowInfo = getWindowInfo(now);
  const targetDateKey = dateKey || windowInfo.dateKey;
  const cleanEmail = normalizeEmail(agentEmail);
  const docId = `${cleanEmail}_${targetDateKey}`;
  await adminDb.collection("loginActivity").doc(docId).set(
    {
      agentEmail: cleanEmail,
      date: targetDateKey,
      amSecondsUsed: 0,
      pmSecondsUsed: 0,
      lastHeartbeatTime: void 0,
      lastWindow: void 0,
      updatedAt: now.toISOString(),
      resetByAdminAt: now.toISOString()
    },
    { merge: true }
  );
}
async function getTodayLoginActivities(dateKey, now = /* @__PURE__ */ new Date()) {
  const windowInfo = getWindowInfo(now);
  const targetDateKey = dateKey || windowInfo.dateKey;
  const snap = await adminDb.collection("loginActivity").where("date", "==", targetDateKey).get();
  return snap.docs.map((d) => d.data());
}

// server-routes.ts
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function includesEmail(list, email) {
  return (list || []).map(normalizeEmail).includes(email);
}
function sameSecret(a, b) {
  const ha = crypto2.createHash("sha256").update(a).digest();
  const hb = crypto2.createHash("sha256").update(b).digest();
  return crypto2.timingSafeEqual(ha, hb);
}
var ROUTE_CACHE_TTL_MS = 3e4;
var excludedCache = /* @__PURE__ */ new Map();
var accessCache = /* @__PURE__ */ new Map();
function clearRouteCache() {
  excludedCache.clear();
  accessCache.clear();
}
async function getExcludedEmails(cycleId) {
  const hit = excludedCache.get(cycleId);
  if (hit && Date.now() - hit.at < ROUTE_CACHE_TTL_MS) return new Set(hit.value);
  const value = await loadExcludedEmails(cycleId);
  excludedCache.set(cycleId, { at: Date.now(), value: new Set(value) });
  return value;
}
async function loadExcludedEmails(cycleId) {
  const excludesSet = /* @__PURE__ */ new Set();
  try {
    const snap = await adminDb.collection("cycles").doc(cycleId).collection("data").doc("excludedAgents").get();
    if (snap.exists) {
      const list = snap.data()?.list || [];
      for (const item of list) {
        if (item.active && item.agentEmail) {
          excludesSet.add(normalizeEmail(item.agentEmail));
        }
      }
    }
  } catch (e) {
    console.warn("Failed to load excluded agents:", e);
  }
  return excludesSet;
}
function cleanEmailList(value, field) {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be a list of email addresses`);
  const out = [];
  for (const item of value) {
    const email = normalizeEmail(item);
    if (!email) continue;
    if (!EMAIL_RE.test(email)) throw new HttpError(400, `"${item}" is not a valid email address`);
    if (!out.includes(email)) out.push(email);
  }
  return out;
}
function publicConfig(appConfig) {
  return {
    activeCycleId: appConfig.activeCycleId,
    testMode: Boolean(appConfig.testMode),
    aiEnabled: Boolean(appConfig.aiEnabled)
  };
}
function createApiApp(options = {}) {
  loadEnv();
  const api = express();
  api.disable("x-powered-by");
  const verify = options.verifyIdToken ?? ((t) => verifyFirebaseIdToken(t));
  api.use("/api", express.json({ limit: "50mb" }));
  api.use(["/api/sync", "/api/import", "/api/clear-test", "/api/admin"], (req, res, next) => {
    if (req.method === "GET") return next();
    const clear = () => {
      invalidateReadCache();
      invalidateRawCache();
      clearRouteCache();
    };
    clear();
    res.on("finish", clear);
    next();
  });
  api.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : void 0;
    if (token) {
      requestContext.run({ idToken: token }, () => next());
    } else {
      next();
    }
  });
  const route = (fn) => (req, res, next) => {
    fn(req, res).catch(next);
  };
  async function authenticate(req) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new HttpError(401, "Unauthorized: Missing or invalid Authorization header");
    }
    let decoded;
    try {
      decoded = await verify(header.slice("Bearer ".length).trim());
    } catch (err) {
      throw new HttpError(401, `Invalid ID token: ${err?.message || "could not be verified"}`);
    }
    const email = normalizeEmail(decoded.email);
    if (!email) throw new HttpError(403, "Forbidden: No email associated with token");
    if (decoded.email_verified !== true) throw new HttpError(403, "Forbidden: The email address is not verified");
    return { email, name: decoded.name || email };
  }
  async function identify(email, appConfig) {
    const normalized = normalizeEmail(email);
    if (includesEmail(appConfig.superAdmins, email)) return { role: "superAdmin" };
    if (includesEmail(appConfig.managers, email)) return { role: "manager" };
    try {
      const hit = accessCache.get(normalized);
      let data;
      if (hit && Date.now() - hit.at < ROUTE_CACHE_TTL_MS) {
        data = hit.value;
      } else {
        const snap = await adminDb.collection("access").doc(normalized).get();
        data = snap.exists ? snap.data() : null;
        accessCache.set(normalized, { at: Date.now(), value: data });
      }
      if (data?.role === "tl" || data?.role === "agent") return { role: data.role, access: { ...data } };
    } catch (_err) {
    }
    return null;
  }
  async function requireSuperAdmin(req) {
    const user = await authenticate(req);
    const { appConfig, cycle } = await ensureSeedData();
    if (!includesEmail(appConfig.superAdmins, user.email)) {
      throw new HttpError(403, "Forbidden: User is not a Super Admin");
    }
    return { user, appConfig, cycle };
  }
  let healthCache = null;
  api.get(
    "/api/health",
    route(async (_req, res) => {
      const now = Date.now();
      if (healthCache && now - healthCache.at < 1e4) {
        return res.status(healthCache.status).json(healthCache.body);
      }
      let status = 200;
      let body;
      try {
        await adminDb.healthCheck();
        body = { status: "ok", storage: adminDb.kind };
      } catch (err) {
        console.error("Health check error:", err);
        status = 500;
        body = { status: "error", storage: adminDb.kind, message: err?.message || String(err) };
      }
      healthCache = { at: now, status, body };
      return res.status(status).json(body);
    })
  );
  api.post(
    ["/api/sync", "/api/sync/apps-script"],
    route(async (req, res) => {
      try {
        const { appConfig } = await ensureSeedData();
        const validKeys = [process.env.SYNC_KEY, appConfig?.syncKey].filter(
          (k) => typeof k === "string" && k.length > 0
        );
        if (validKeys.length === 0) {
          throw new HttpError(503, "Sync is not configured: set SYNC_KEY on the server.");
        }
        const given = req.headers["x-sync-key"];
        const isAuthorized = typeof given === "string" && given.length > 0 && validKeys.some((k) => sameSecret(given, k));
        if (!isAuthorized) {
          throw new HttpError(401, "Unauthorized: Invalid or missing X-Sync-Key header.");
        }
        const { mainRows, qualityRows, revenueRows, leaderMappingRows, excludedAgentsRows, rawVisitRows, rawRevenueTabRows } = req.body || {};
        const result = await processImport("apps-script", mainRows || [], qualityRows || [], {
          revenueRows: revenueRows || [],
          leaderMappingRows: leaderMappingRows || [],
          excludedAgentsRows: excludedAgentsRows || [],
          rawVisitRows: rawVisitRows || [],
          rawRevenueTabRows: rawRevenueTabRows || []
        });
        return res.json(result);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        return res.json({ result: "error", error: err?.message || String(err) });
      }
    })
  );
  api.post(
    "/api/import",
    route(async (req, res) => {
      await requireSuperAdmin(req);
      const { mainRows, qualityRows, revenueRows, leaderMappingRows, excludedAgentsRows, rawVisitRows, rawRevenueTabRows, source } = req.body || {};
      const importSource = source === "test" ? "test" : "import";
      const result = await processImport(importSource, mainRows || [], qualityRows || [], {
        revenueRows: revenueRows || [],
        leaderMappingRows: leaderMappingRows || [],
        excludedAgentsRows: excludedAgentsRows || [],
        rawVisitRows: rawVisitRows || [],
        rawRevenueTabRows: rawRevenueTabRows || []
      });
      return res.json(result);
    })
  );
  api.post(
    ["/api/clear-test", "/api/admin/clear-test-data"],
    route(async (req, res) => {
      const { appConfig } = await requireSuperAdmin(req);
      const counts = await clearTestData(appConfig);
      return res.json({ status: "ok", ...counts });
    })
  );
  api.get(
    "/api/admin/sync-logs",
    route(async (req, res) => {
      await requireSuperAdmin(req);
      const snap = await adminDb.collection("syncLogs").orderBy("time", "desc").limit(30).get();
      return res.json({ logs: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    })
  );
  api.get(
    "/api/admin/config",
    route(async (req, res) => {
      const { appConfig } = await requireSuperAdmin(req);
      return res.json({ config: appConfig });
    })
  );
  api.post(
    "/api/admin/config",
    route(async (req, res) => {
      const { user, appConfig } = await requireSuperAdmin(req);
      const { aiEnabled, aiTone, testMode, managers, superAdmins, googleSpreadsheetUrl, loginTracker } = req.body || {};
      const updates = {};
      if (typeof googleSpreadsheetUrl === "string") updates.googleSpreadsheetUrl = googleSpreadsheetUrl.trim();
      if (typeof aiEnabled === "boolean") updates.aiEnabled = aiEnabled;
      if (aiTone === "english" || aiTone === "hinglish") updates.aiTone = aiTone;
      if (typeof testMode === "boolean") updates.testMode = testMode;
      if (loginTracker && typeof loginTracker === "object") {
        const current = appConfig.loginTracker || DEFAULT_LOGIN_TRACKER_CONFIG;
        updates.loginTracker = {
          enabled: typeof loginTracker.enabled === "boolean" ? loginTracker.enabled : current.enabled,
          amWindowMinutes: typeof loginTracker.amWindowMinutes === "number" && loginTracker.amWindowMinutes > 0 ? Math.round(loginTracker.amWindowMinutes) : current.amWindowMinutes,
          pmWindowMinutes: typeof loginTracker.pmWindowMinutes === "number" && loginTracker.pmWindowMinutes > 0 ? Math.round(loginTracker.pmWindowMinutes) : current.pmWindowMinutes,
          timezone: current.timezone || "Asia/Kolkata"
        };
      }
      if (managers !== void 0) updates.managers = cleanEmailList(managers, "managers");
      if (superAdmins !== void 0) {
        const list = cleanEmailList(superAdmins, "superAdmins");
        if (list.length === 0) throw new HttpError(400, "There must be at least one Super Admin");
        if (!list.includes(user.email)) {
          throw new HttpError(400, "You cannot remove your own Super Admin access");
        }
        updates.superAdmins = list;
      }
      if (Object.keys(updates).length > 0) {
        await adminDb.collection("config").doc("app").set(updates, { merge: true });
      }
      const next = { ...appConfig, ...updates };
      if (typeof updates.testMode === "boolean" && updates.testMode !== Boolean(appConfig.testMode)) {
        await rebuildLeaderboards(next);
      }
      return res.json({ status: "ok", config: next });
    })
  );
  api.get(
    "/api/admin/config-cycle",
    route(async (req, res) => {
      const { appConfig, cycle } = await requireSuperAdmin(req);
      return res.json({
        isSuperAdmin: true,
        appConfig,
        cycle,
        server: {
          storage: adminDb.kind,
          syncKeyConfigured: Boolean(process.env.SYNC_KEY),
          aiKeyConfigured: isAiConfigured()
        }
      });
    })
  );
  api.get(
    "/api/admin/readiness",
    route(async (req, res) => {
      await requireSuperAdmin(req);
      return res.json(await buildReadiness());
    })
  );
  api.post(
    "/api/admin/test-ai",
    route(async (req, res) => {
      const { appConfig, cycle } = await requireSuperAdmin(req);
      const cycleId = appConfig.activeCycleId;
      const agents = adminDb.collection("cycles").doc(cycleId).collection("agents");
      let targetAgent = null;
      const requestedEmail = normalizeEmail(req.body?.officialEmail);
      if (requestedEmail) {
        const snap = await agents.doc(requestedEmail).get();
        if (snap.exists) targetAgent = snap.data();
      }
      if (!targetAgent) {
        const first = await agents.limit(1).get();
        if (!first.empty) targetAgent = first.docs[0].data();
      }
      if (!targetAgent) {
        throw new HttpError(404, "No agents found in active cycle. Import dummy data first.");
      }
      const aiResult = await generateAiText(targetAgent, cycle, appConfig);
      return res.json({
        agentName: targetAgent.name,
        officialEmail: targetAgent.officialEmail,
        agentType: targetAgent.agentType,
        success: aiResult.success,
        headline: aiResult.aiSuggestions?.headline,
        report: aiResult.report,
        error: aiResult.error
      });
    })
  );
  api.post(
    "/api/admin/generate-ai-all",
    route(async (req, res) => {
      const { appConfig, cycle } = await requireSuperAdmin(req);
      if (!isAiConfigured()) throw new HttpError(400, "GEMINI_API_KEY is not set on the server.");
      const cycleId = appConfig.activeCycleId;
      const agents = await loadAgents(cycleId);
      if (agents.length === 0) return res.json({ status: "ok", okCount: 0, failedCount: 0, pendingCount: 0, total: 0 });
      const run = await runBatchAiGeneration(agents, cycle, appConfig, { budgetMs: 12e4 });
      await saveAiText(cycleId, run.generatedAgents);
      return res.json({
        status: "ok",
        okCount: run.okCount,
        failedCount: run.failedCount,
        pendingCount: run.pendingCount,
        total: agents.length
      });
    })
  );
  api.get(
    "/api/auth/session",
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig, cycle } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) {
        return res.status(403).json({ role: null, error: "Access denied. Contact your TL." });
      }
      const common = {
        email: user.email,
        role: identity.role,
        name: identity.access?.name || user.name,
        activeCycleId: appConfig.activeCycleId,
        activeCycleName: cycle.name,
        testMode: Boolean(appConfig.testMode)
      };
      if (identity.role === "superAdmin" || identity.role === "manager") {
        return res.json({ ...common, officialEmail: user.email, name: user.name });
      }
      if (identity.role === "tl") {
        return res.json({
          ...common,
          name: user.name,
          officialEmail: identity.access?.officialEmail || user.email,
          location: identity.access?.location
        });
      }
      const agentOfficial = identity.access?.officialEmail || user.email;
      const trackerState = await checkAgentAllowance(agentOfficial, appConfig.loginTracker);
      if (!trackerState.allowed) {
        return res.status(403).json({
          role: null,
          timeExhausted: true,
          error: trackerState.reason || "Session time limit reached.",
          loginTracker: trackerState
        });
      }
      return res.json({
        ...common,
        officialEmail: identity.access?.officialEmail,
        location: identity.access?.location,
        loginTracker: trackerState
      });
    })
  );
  api.get(
    "/api/agent/session-time",
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, "Access denied");
      if (identity.role !== "agent") {
        return res.json({
          enabled: false,
          allowed: true,
          remainingSeconds: 86400,
          windowId: "AM",
          windowLimitMinutes: 30,
          usedSeconds: 0
        });
      }
      const agentEmail = identity.access?.officialEmail || user.email;
      const state = await checkAgentAllowance(agentEmail, appConfig.loginTracker);
      return res.json(state);
    })
  );
  api.post(
    "/api/agent/heartbeat",
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, "Access denied");
      if (identity.role !== "agent") {
        return res.json({
          enabled: false,
          allowed: true,
          remainingSeconds: 86400,
          windowId: "AM",
          windowLimitMinutes: 30,
          usedSeconds: 0
        });
      }
      const agentEmail = identity.access?.officialEmail || user.email;
      const state = await recordAgentHeartbeat(agentEmail, appConfig.loginTracker);
      return res.json(state);
    })
  );
  api.post(
    "/api/admin/login-tracker",
    route(async (req, res) => {
      const { appConfig } = await requireSuperAdmin(req);
      const { enabled, amWindowMinutes, pmWindowMinutes } = req.body || {};
      const current = appConfig.loginTracker || DEFAULT_LOGIN_TRACKER_CONFIG;
      const nextTracker = {
        enabled: typeof enabled === "boolean" ? enabled : current.enabled,
        amWindowMinutes: typeof amWindowMinutes === "number" && amWindowMinutes > 0 ? Math.round(amWindowMinutes) : current.amWindowMinutes,
        pmWindowMinutes: typeof pmWindowMinutes === "number" && pmWindowMinutes > 0 ? Math.round(pmWindowMinutes) : current.pmWindowMinutes,
        timezone: current.timezone || "Asia/Kolkata"
      };
      await adminDb.collection("config").doc("app").set({ loginTracker: nextTracker }, { merge: true });
      const next = { ...appConfig, loginTracker: nextTracker };
      return res.json({ status: "ok", loginTracker: nextTracker, config: next });
    })
  );
  api.get(
    "/api/admin/login-tracker/activity",
    route(async (req, res) => {
      const { appConfig } = await requireSuperAdmin(req);
      const activities = await getTodayLoginActivities();
      const windowInfo = getWindowInfo(/* @__PURE__ */ new Date(), appConfig.loginTracker);
      return res.json({ activities, windowInfo, config: appConfig.loginTracker || DEFAULT_LOGIN_TRACKER_CONFIG });
    })
  );
  api.post(
    "/api/admin/login-tracker/reset",
    route(async (req, res) => {
      await requireSuperAdmin(req);
      const agentEmail = (req.body?.agentEmail || "").trim();
      if (!agentEmail) throw new HttpError(400, "Missing agentEmail");
      await resetAgentLoginUsage(agentEmail);
      return res.json({ status: "ok", agentEmail });
    })
  );
  function isAgentOfTl(agent, tlUserEmail, tlAccess) {
    const tlPersonal = normalizeEmail(tlUserEmail);
    const tlOfficial = normalizeEmail(tlAccess?.officialEmail);
    const agentTlPersonal = normalizeEmail(agent.tlPersonalEmail);
    const agentTlOfficial = normalizeEmail(agent.tlOfficialEmail);
    if (tlPersonal && agentTlPersonal && agentTlPersonal === tlPersonal) {
      return true;
    }
    if (tlOfficial && agentTlOfficial && agentTlOfficial === tlOfficial) {
      return true;
    }
    if (tlPersonal && agentTlOfficial && agentTlOfficial === tlPersonal) {
      return true;
    }
    if (tlOfficial && agentTlPersonal && agentTlPersonal === tlOfficial) {
      return true;
    }
    if (!agentTlPersonal && !agentTlOfficial && tlAccess?.location) {
      const tlLoc = tlAccess.location.trim().toLowerCase();
      const agLoc = (agent.location || "").trim().toLowerCase();
      if (tlLoc === agLoc) return true;
      if (tlLoc === "dighe" && agLoc === "dighe (pre sales)") return true;
    }
    return false;
  }
  api.get(
    "/api/agent-data",
    route(async (req, res) => {
      const user = await authenticate(req);
      const target = normalizeEmail(String(req.query.officialEmail ?? ""));
      if (!target) throw new HttpError(400, "Missing officialEmail parameter");
      const { appConfig, cycle } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, "Access denied to this agent record.");
      const excludedEmails = await getExcludedEmails(appConfig.activeCycleId);
      if (excludedEmails.has(target)) {
        throw new HttpError(403, "This agent record is excluded.");
      }
      const snap = await adminDb.collection("cycles").doc(appConfig.activeCycleId).collection("agents").doc(target).get();
      const agentRecord = snap.exists ? snap.data() : null;
      if (identity.role === "agent") {
        if (normalizeEmail(identity.access?.officialEmail) !== target) {
          throw new HttpError(403, "Access denied to this agent record.");
        }
      } else if (identity.role === "tl") {
        if (!agentRecord || !isAgentOfTl(agentRecord, user.email, identity.access)) {
          throw new HttpError(403, "Access denied to this agent record.");
        }
      }
      const hideDemo = agentRecord?.isTest && !appConfig.testMode && identity.role !== "superAdmin" && identity.role !== "agent";
      return res.json({
        agentRecord: hideDemo ? null : agentRecord,
        cycle,
        userRole: identity.role,
        config: publicConfig(appConfig)
      });
    })
  );
  api.get(
    "/api/allowed-agents",
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, "Access denied");
      let agents = await loadAgents(appConfig.activeCycleId);
      const excludedEmails = await getExcludedEmails(appConfig.activeCycleId);
      agents = agents.filter((a) => !excludedEmails.has(normalizeEmail(a.officialEmail)));
      if (identity.role === "agent") {
        const own = normalizeEmail(identity.access?.officialEmail);
        agents = agents.filter((a) => normalizeEmail(a.officialEmail) === own);
      } else if (identity.role === "tl") {
        agents = agents.filter((a) => isAgentOfTl(a, user.email, identity.access));
      }
      if (!appConfig.testMode && identity.role !== "superAdmin" && identity.role !== "agent") {
        agents = agents.filter((a) => !a.isTest);
      }
      return res.json({
        role: identity.role,
        agents: agents.map((a) => ({
          officialEmail: a.officialEmail,
          name: a.name,
          location: a.location,
          agentType: a.agentType,
          total: a.result?.total || 0,
          className: a.result?.className || "NQ",
          sales: a.totals?.sales || 0,
          isTest: a.isTest || false
        }))
      });
    })
  );
  api.get(
    "/api/team-agents",
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity || identity.role !== "superAdmin" && identity.role !== "manager" && identity.role !== "tl") {
        throw new HttpError(403, "Forbidden: Staff access required");
      }
      const cycleId = req.query.cycleId || appConfig.activeCycleId;
      let agents = await loadAgents(cycleId);
      const excludedEmails = await getExcludedEmails(cycleId);
      agents = agents.filter((a) => !excludedEmails.has(normalizeEmail(a.officialEmail)));
      if (!appConfig.testMode && identity.role !== "superAdmin") {
        agents = agents.filter((a) => !a.isTest && !isTestAgentIdentifier(a.officialEmail, a.name));
      }
      if (identity.role === "tl") {
        agents = agents.filter((a) => isAgentOfTl(a, user.email, identity.access));
      }
      return res.json({ agents });
    })
  );
  api.get(
    "/api/leaderboard",
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity || identity.role === "agent") throw new HttpError(403, "Forbidden: Staff access required");
      const cycleId = req.query.cycleId || appConfig.activeCycleId;
      const loc = req.query.location || "Dighe";
      if (identity.role === "tl" && normalizeEmail(loc) !== normalizeEmail(identity.access?.location)) {
        throw new HttpError(403, "Forbidden: A TL sees only the leaderboard of their own location");
      }
      const snap = await adminDb.collection("cycles").doc(cycleId).collection("leaderboards").doc(loc).get();
      if (snap.exists) {
        const stored = snap.data();
        const rows = Array.isArray(stored?.rows) ? rankRevenueRows(stored.rows, loc) : [];
        return res.json({ leaderboard: { ...stored, rows } });
      }
      return res.json({
        leaderboard: {
          location: loc,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          rows: []
        }
      });
    })
  );
  api.get(
    "/api/agent-leaderboard",
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, "Access denied");
      const cycleId = req.query.cycleId || appConfig.activeCycleId;
      let agents = await loadAgents(cycleId);
      const excludedEmails = await getExcludedEmails(cycleId);
      agents = agents.filter((a) => !excludedEmails.has(normalizeEmail(a.officialEmail)));
      if (!appConfig.testMode && identity.role !== "superAdmin") {
        agents = agents.filter((a) => !a.isTest && !isTestAgentIdentifier(a.officialEmail, a.name));
      }
      const userOfficial = normalizeEmail(identity.access?.officialEmail || user.email);
      const byRevenue = (a, b) => compareByRevenue({ sales: a.totals?.sales || 0, name: a.name }, { sales: b.totals?.sales || 0, name: b.name });
      const hoAgents = agents.filter((a) => a.agentType === "HO");
      hoAgents.sort(byRevenue);
      const storeAgents = agents.filter((a) => a.agentType === "STORE");
      storeAgents.sort(byRevenue);
      const preSalesAgents = agents.filter((a) => a.agentType === "PRE_SALES");
      preSalesAgents.sort(
        (a, b) => (b.result?.total || 0) - (a.result?.total || 0) || (b.result?.preSales?.calls.value ?? 0) - (a.result?.preSales?.calls.value ?? 0) || (b.result?.preSales?.talk.value ?? 0) - (a.result?.preSales?.talk.value ?? 0) || a.name.localeCompare(b.name)
      );
      const mapRow = (a, idx) => ({
        rank: idx + 1,
        name: a.name,
        officialEmail: a.officialEmail,
        location: a.location,
        agentType: a.agentType,
        orders: a.totals?.orders || 0,
        sales: a.totals?.sales || 0,
        aov: a.totals?.orders ? Math.round(a.totals.sales / a.totals.orders) : 0,
        achievementPct: a.result?.achievementPct || 0,
        className: a.result?.className || "NQ",
        activeDays: a.totals?.activeDays || 0,
        avgConnects: a.totals?.activeDays ? Math.round((a.totals.connects || 0) / a.totals.activeDays) : 0,
        avgTalkMinutes: a.totals?.activeDays ? Math.round((a.totals.talkSeconds || 0) / 60 / a.totals.activeDays) : 0,
        qualityScore: a.quality?.audits ? a.quality.score : null,
        visitsAttributed: a.totals?.visitsAttributed || 0,
        isCurrentAgent: normalizeEmail(a.officialEmail) === userOfficial
      });
      const mapPreSalesRow = (a, idx) => ({
        rank: idx + 1,
        name: a.name,
        officialEmail: a.officialEmail,
        location: a.location,
        agentType: "PRE_SALES",
        orders: 0,
        sales: 0,
        aov: 0,
        achievementPct: 0,
        className: "PS",
        activeDays: a.totals?.activeDays || 0,
        avgConnects: 0,
        avgTalkMinutes: 0,
        qualityScore: a.quality?.audits ? a.quality.score : null,
        visitsAttributed: 0,
        avgCalls: a.result?.preSales?.calls.value ?? (a.totals?.activeDays ? Math.round((a.totals.calls || 0) / a.totals.activeDays) : 0),
        avgTalkSeconds: a.result?.preSales?.talk.value ?? 0,
        callsTier: a.result?.preSales?.calls.tier ?? 0,
        talkTier: a.result?.preSales?.talk.tier ?? 0,
        isCurrentAgent: normalizeEmail(a.officialEmail) === userOfficial
      });
      if (identity.role === "agent") {
        const found = agents.find((a) => normalizeEmail(a.officialEmail) === userOfficial);
        const inferredType = found?.agentType || identity.access?.agentType || (found?.location?.toLowerCase().includes("pre sales") || identity.access?.location?.toLowerCase().includes("pre sales") ? "PRE_SALES" : found?.location?.toLowerCase() === "dighe" || identity.access?.location?.toLowerCase() === "dighe" ? "HO" : "STORE");
        if (inferredType === "HO") {
          return res.json({
            allowedCategory: "HO",
            ho: hoAgents.map(mapRow),
            store: [],
            preSales: [],
            userLocation: identity.access?.location,
            userRole: identity.role
          });
        }
        if (inferredType === "STORE") {
          return res.json({
            allowedCategory: "STORE",
            ho: [],
            store: storeAgents.map(mapRow),
            preSales: [],
            userLocation: identity.access?.location,
            userRole: identity.role
          });
        }
        return res.json({
          allowedCategory: "PRE_SALES",
          ho: [],
          store: [],
          preSales: preSalesAgents.map(mapPreSalesRow),
          userLocation: identity.access?.location,
          userRole: identity.role
        });
      }
      return res.json({
        allowedCategory: "ALL",
        ho: hoAgents.map(mapRow),
        store: storeAgents.map(mapRow),
        preSales: preSalesAgents.map(mapPreSalesRow),
        userLocation: identity.access?.location,
        userRole: identity.role
      });
    })
  );
  api.get(
    "/api/team-revenue",
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, "Access denied");
      const cycleId = req.query.cycleId || appConfig.activeCycleId;
      let targetLocation = req.query.location || "";
      if (identity.role === "agent") {
        targetLocation = identity.access?.location || "Dighe";
        if (targetLocation.toLowerCase().includes("pre sales")) {
          throw new HttpError(403, "Pre Sales agents do not have revenue data.");
        }
      } else if (identity.role === "tl") {
        targetLocation = identity.access?.location || "Dighe";
      } else {
        if (!targetLocation) targetLocation = "Dighe";
      }
      const snap = await adminDb.collection("cycles").doc(cycleId).collection("teamRevenue").doc(targetLocation).get();
      if (snap.exists) {
        return res.json({ teamRevenue: snap.data() });
      }
      const agents = await loadAgents(cycleId);
      const rows = [];
      for (const a of agents) {
        if (a.location !== targetLocation) continue;
        for (const d of a.daily || []) {
          rows.push({
            Date: d.date,
            Day: d.day,
            Agent_Location: a.location,
            Count_of_Orders: d.orders,
            Sales: d.sales
          });
        }
      }
      const generated = buildTeamRevenue(targetLocation, cycleId, rows);
      return res.json({ teamRevenue: generated });
    })
  );
  api.get(
    "/api/dod-data",
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, "Access denied");
      const cycleId = req.query.cycleId || appConfig.activeCycleId;
      const rawRecords = await getOrLoadRawRecords(cycleId);
      const allOrdersRaw = rawRecords.orders || [];
      const excludedEmails = await getExcludedEmails(cycleId);
      const allOrders = allOrdersRaw.filter((o) => !excludedEmails.has(normalizeEmail(o.agentEmail)));
      let allAgents = await loadAgents(cycleId);
      allAgents = allAgents.filter((a) => !excludedEmails.has(normalizeEmail(a.officialEmail)));
      if (!appConfig.testMode && identity.role !== "superAdmin") {
        allAgents = allAgents.filter((a) => !a.isTest && !isTestAgentIdentifier(a.officialEmail, a.name));
      }
      let targetAgentEmail = req.query.agentEmail?.trim() || "";
      if (identity.role === "agent") {
        targetAgentEmail = identity.access?.officialEmail || user.email;
      }
      let targetAgent = targetAgentEmail ? allAgents.find((a) => normalizeEmail(a.officialEmail) === normalizeEmail(targetAgentEmail)) : null;
      if (identity.role === "tl") {
        if (targetAgent && !isAgentOfTl(targetAgent, user.email, identity.access)) {
          throw new HttpError(403, "Access denied to this agent data.");
        }
      }
      const requestedLocation = identity.role === "agent" || identity.role === "tl" ? "" : req.query.location?.trim();
      let location = targetAgent?.location || requestedLocation || identity.access?.location || "Dighe";
      if (location.toLowerCase().includes("andheri")) location = "Andheri";
      else if (location.toLowerCase().includes("bangalore")) location = "Bangalore";
      else if (location.toLowerCase().includes("pre sales")) location = "Dighe";
      else location = "Dighe";
      const teamAgents = allAgents.filter((a) => {
        const aLoc = (a.location || "").toLowerCase();
        return aLoc === location.toLowerCase() && a.agentType !== "PRE_SALES";
      });
      const datesSet = /* @__PURE__ */ new Set();
      allOrders.forEach((o) => {
        const d = o.date.replace(/\//g, "-");
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) datesSet.add(d);
      });
      teamAgents.forEach((a) => {
        (a.daily || []).forEach((d) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) datesSet.add(d.date);
        });
      });
      const sortedDates = Array.from(datesSet).sort();
      const teamDailyMap = {};
      const agentDailyMap = {};
      sortedDates.forEach((d) => {
        teamDailyMap[d] = { sales: 0, orders: 0, activeCallers: /* @__PURE__ */ new Set() };
        agentDailyMap[d] = { sales: 0, orders: 0, connects: 0, talkSeconds: 0, visitsAttributed: 0 };
      });
      const targetOfficial = targetAgent ? normalizeEmail(targetAgent.officialEmail) : "";
      const agentHasRawOrders = allOrders.some((o) => normalizeEmail(o.agentEmail) === targetOfficial);
      allOrders.forEach((o) => {
        const d = o.date.replace(/\//g, "-");
        if (!teamDailyMap[d]) return;
        const oLoc = (o.location || "").toLowerCase();
        if (oLoc === location.toLowerCase()) {
          teamDailyMap[d].sales += o.orderValue;
          teamDailyMap[d].orders += 1;
          teamDailyMap[d].activeCallers.add(normalizeEmail(o.agentEmail));
        }
        if (targetOfficial && normalizeEmail(o.agentEmail) === targetOfficial) {
          agentDailyMap[d].sales += o.orderValue;
          agentDailyMap[d].orders += 1;
        }
      });
      if (targetAgent && Array.isArray(targetAgent.daily)) {
        targetAgent.daily.forEach((d) => {
          const dateStr = d.date.replace(/\//g, "-");
          if (agentDailyMap[dateStr]) {
            agentDailyMap[dateStr].connects = d.connects || 0;
            agentDailyMap[dateStr].talkSeconds = d.talkSeconds || 0;
            agentDailyMap[dateStr].visitsAttributed = d.visitsAttributed || 0;
            if (!agentHasRawOrders && agentDailyMap[dateStr].sales === 0 && d.sales > 0) {
              agentDailyMap[dateStr].sales = d.sales;
              agentDailyMap[dateStr].orders = d.orders || 0;
            }
          }
        });
      }
      let cumAgentSales = 0;
      let cumTeamSales = 0;
      let cumAgentOrders = 0;
      let cumTeamOrders = 0;
      const dailyComparison = sortedDates.map((date, idx) => {
        const ag = agentDailyMap[date] || { sales: 0, orders: 0, connects: 0, talkSeconds: 0, visitsAttributed: 0 };
        const tm = teamDailyMap[date] || { sales: 0, orders: 0, activeCallers: /* @__PURE__ */ new Set() };
        cumAgentSales += ag.sales;
        cumTeamSales += tm.sales;
        cumAgentOrders += ag.orders;
        cumTeamOrders += tm.orders;
        const prevDate = idx > 0 ? sortedDates[idx - 1] : null;
        const prevAg = prevDate ? agentDailyMap[prevDate] : null;
        const prevTm = prevDate ? teamDailyMap[prevDate] : null;
        const agSalesDelta = prevAg ? ag.sales - prevAg.sales : ag.sales;
        const agSalesGrowthPct = prevAg && prevAg.sales > 0 ? Math.round((ag.sales - prevAg.sales) / prevAg.sales * 1e3) / 10 : null;
        const agOrdersDelta = prevAg ? ag.orders - prevAg.orders : ag.orders;
        const tmSalesDelta = prevTm ? tm.sales - prevTm.sales : tm.sales;
        const tmSalesGrowthPct = prevTm && prevTm.sales > 0 ? Math.round((tm.sales - prevTm.sales) / prevTm.sales * 1e3) / 10 : null;
        const tmOrdersDelta = prevTm ? tm.orders - prevTm.orders : tm.orders;
        const sharePct = tm.sales > 0 ? Math.round(ag.sales / tm.sales * 1e3) / 10 : 0;
        const cumSharePct = cumTeamSales > 0 ? Math.round(cumAgentSales / cumTeamSales * 1e3) / 10 : 0;
        return {
          date,
          dayNumber: idx + 1,
          agent: {
            sales: ag.sales,
            orders: ag.orders,
            connects: ag.connects,
            talkMinutes: Math.round(ag.talkSeconds / 60),
            salesDelta: agSalesDelta,
            salesGrowthPct: agSalesGrowthPct,
            ordersDelta: agOrdersDelta
          },
          team: {
            sales: tm.sales,
            orders: tm.orders,
            activeCallersCount: tm.activeCallers.size,
            salesDelta: tmSalesDelta,
            salesGrowthPct: tmSalesGrowthPct,
            ordersDelta: tmOrdersDelta
          },
          sharePct,
          cumulative: {
            agentSales: cumAgentSales,
            teamSales: cumTeamSales,
            agentOrders: cumAgentOrders,
            teamOrders: cumTeamOrders,
            sharePct: cumSharePct
          }
        };
      });
      const teamRosterMatrix = teamAgents.map((a) => {
        const aOfficial = normalizeEmail(a.officialEmail);
        const daySales = {};
        let totalSales = 0;
        let totalOrders = 0;
        sortedDates.forEach((d) => {
          daySales[d] = 0;
        });
        allOrders.forEach((o) => {
          if (normalizeEmail(o.agentEmail) === aOfficial) {
            const d = o.date.replace(/\//g, "-");
            if (daySales[d] !== void 0) {
              daySales[d] += o.orderValue;
            }
            totalSales += o.orderValue;
            totalOrders += 1;
          }
        });
        if (totalSales === 0 && a.totals?.sales) {
          totalSales = a.totals.sales;
          totalOrders = a.totals.orders || 0;
          (a.daily || []).forEach((d) => {
            const dateStr = d.date.replace(/\//g, "-");
            if (daySales[dateStr] !== void 0) daySales[dateStr] = d.sales;
          });
        }
        const shareOfTeam = cumTeamSales > 0 ? Math.round(totalSales / cumTeamSales * 1e3) / 10 : 0;
        return {
          officialEmail: a.officialEmail,
          name: a.name,
          location: a.location,
          className: a.result?.className || "NQ",
          totalSales,
          totalOrders,
          daySales,
          shareOfTeam
        };
      });
      teamRosterMatrix.sort((a, b) => b.totalSales - a.totalSales);
      const latestDay = dailyComparison[dailyComparison.length - 1] || null;
      return res.json({
        agent: targetAgent ? {
          name: targetAgent.name,
          officialEmail: targetAgent.officialEmail,
          location: targetAgent.location,
          className: targetAgent.result?.className || "NQ",
          agentType: targetAgent.agentType
        } : null,
        team: {
          location,
          targetAmount: 9e6,
          totalRevenue: cumTeamSales,
          totalOrders: cumTeamOrders,
          agentCount: teamAgents.length
        },
        summary: {
          latestDate: latestDay?.date || "",
          latestAgentSales: latestDay?.agent.sales || 0,
          latestTeamSales: latestDay?.team.sales || 0,
          latestSharePct: latestDay?.sharePct || 0,
          totalAgentSales: cumAgentSales,
          totalTeamSales: cumTeamSales,
          totalSharePct: cumTeamSales > 0 ? Math.round(cumAgentSales / cumTeamSales * 1e3) / 10 : 0,
          totalAgentOrders: cumAgentOrders,
          totalTeamOrders: cumTeamOrders,
          dates: sortedDates
        },
        dailyComparison,
        teamRosterMatrix
      });
    })
  );
  api.get(
    "/api/location-revenue",
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, "Access denied");
      const cycleId = req.query.cycleId || appConfig.activeCycleId;
      const rawRecords = await getOrLoadRawRecords(cycleId);
      const summaries = rawRecords.locationSummaries || {};
      let targetLoc = req.query.location?.trim() || "";
      if (identity.role === "agent") {
        targetLoc = identity.access?.location || "Dighe";
      } else if (identity.role === "tl") {
        targetLoc = identity.access?.location || "Dighe";
      } else {
        if (!targetLoc) targetLoc = "Dighe";
      }
      let locKey = "Dighe";
      if (targetLoc.toLowerCase().includes("andheri")) locKey = "Andheri";
      else if (targetLoc.toLowerCase().includes("bangalore")) locKey = "Bangalore";
      else locKey = "Dighe";
      const data = summaries[locKey] || {
        location: locKey,
        totalOrders: 0,
        totalRevenue: 0,
        aov: 0,
        categories: {
          shopify: { orders: 0, sales: 0 },
          bfan: { orders: 0, sales: 0 },
          bfmp: { orders: 0, sales: 0 },
          posoc: { orders: 0, sales: 0 }
        },
        rows: []
      };
      return res.json({
        locationRevenue: data,
        availableLocations: Object.keys(summaries)
      });
    })
  );
  api.get(
    "/api/raw-data",
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, "Access denied");
      const cycleId = req.query.cycleId || appConfig.activeCycleId;
      const rawRecords = await getOrLoadRawRecords(cycleId);
      let orders = rawRecords.orders || [];
      let visits = rawRecords.visits || [];
      const excludedEmails = await getExcludedEmails(cycleId);
      orders = orders.filter((o) => !excludedEmails.has(normalizeEmail(o.agentEmail)));
      visits = visits.filter((v) => !excludedEmails.has(normalizeEmail(v.agentEmail)));
      const allAgents = await loadAgents(cycleId);
      let allowedAgents = [];
      if (identity.role === "agent") {
        const userOfficial = normalizeEmail(identity.access?.officialEmail || user.email);
        orders = orders.filter((o) => normalizeEmail(o.agentEmail) === userOfficial);
        visits = visits.filter((v) => normalizeEmail(v.agentEmail) === userOfficial);
        const me = allAgents.find((a) => normalizeEmail(a.officialEmail) === userOfficial);
        allowedAgents = me ? [{ officialEmail: me.officialEmail, name: me.name, location: me.location }] : [];
      } else if (identity.role === "tl") {
        const myTeam = allAgents.filter((a) => isAgentOfTl(a, user.email, identity.access));
        const teamEmails = new Set(myTeam.map((a) => normalizeEmail(a.officialEmail)));
        orders = orders.filter((o) => teamEmails.has(normalizeEmail(o.agentEmail)));
        visits = visits.filter((v) => teamEmails.has(normalizeEmail(v.agentEmail)));
        allowedAgents = myTeam.map((a) => ({
          officialEmail: a.officialEmail,
          name: a.name,
          location: a.location
        }));
        const filterAgent = normalizeEmail(req.query.agentEmail);
        if (filterAgent && filterAgent !== "all") {
          if (!teamEmails.has(filterAgent)) {
            throw new HttpError(403, "Access denied to this agent data.");
          }
          orders = orders.filter((o) => normalizeEmail(o.agentEmail) === filterAgent);
          visits = visits.filter((v) => normalizeEmail(v.agentEmail) === filterAgent);
        }
      } else {
        allowedAgents = allAgents.map((a) => ({
          officialEmail: a.officialEmail,
          name: a.name,
          location: a.location
        }));
        const filterLocation = req.query.location?.trim().toLowerCase();
        if (filterLocation && filterLocation !== "all") {
          orders = orders.filter((o) => o.location.toLowerCase() === filterLocation);
          visits = visits.filter((v) => v.location.toLowerCase() === filterLocation);
        }
        const filterAgent = normalizeEmail(req.query.agentEmail);
        if (filterAgent && filterAgent !== "all") {
          orders = orders.filter((o) => normalizeEmail(o.agentEmail) === filterAgent);
          visits = visits.filter((v) => normalizeEmail(v.agentEmail) === filterAgent);
        }
      }
      const filterCategory = req.query.category?.trim().toLowerCase();
      if (filterCategory && filterCategory !== "all") {
        orders = orders.filter((o) => o.category.toLowerCase().includes(filterCategory));
      }
      const search = req.query.search?.trim().toLowerCase();
      if (search) {
        orders = orders.filter(
          (o) => o.orderId.toLowerCase().includes(search) || o.agentEmail.toLowerCase().includes(search) || o.orderPhone.includes(search) || o.category.toLowerCase().includes(search) || o.channel.toLowerCase().includes(search)
        );
        visits = visits.filter(
          (v) => v.phoneNumber.includes(search) || v.agentEmail.toLowerCase().includes(search) || v.location.toLowerCase().includes(search) || v.visitSource.toLowerCase().includes(search)
        );
      }
      const totalRevenue = orders.reduce((sum, o) => sum + o.orderValue, 0);
      return res.json({
        orders,
        visits,
        summary: {
          totalOrders: orders.length,
          totalRevenue,
          totalVisits: visits.length,
          aov: orders.length > 0 ? Math.round(totalRevenue / orders.length) : 0
        },
        allowedAgents,
        updatedAt: rawRecords.updatedAt,
        // Why the data may be missing (last fill attempt). Only staff see the technical reason.
        syncStatus: rawRecords.syncStatus ? identity.role === "agent" ? { ok: rawRecords.syncStatus.ok, at: rawRecords.syncStatus.at } : rawRecords.syncStatus : null
      });
    })
  );
  api.post(
    "/api/admin/sync-raw-sheet",
    route(async (req, res) => {
      const { appConfig } = await requireSuperAdmin(req);
      const cycleId = appConfig.activeCycleId;
      const sheetUrl = req.body?.sheetUrl || appConfig.googleSpreadsheetUrl || DEFAULT_RAW_SHEET_URL;
      let result;
      try {
        result = await syncRawSheetData(cycleId, sheetUrl);
      } catch (err) {
        throw new HttpError(502, `Raw sheet sync failed: ${err?.message || err}`);
      }
      return res.json({
        status: "ok",
        ordersCount: result.ordersCount,
        visitsCount: result.visitsCount
      });
    })
  );
  api.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not Found" });
  });
  api.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Invalid JSON body: " + err.message });
    }
    if (err?.type === "entity.too.large") {
      return res.status(413).json({ error: "The request is too large" });
    }
    console.error("API error:", err);
    return res.status(500).json({ error: err?.message || String(err) });
  });
  return api;
}

// api/_source.ts
loadEnv();
var app2 = express2();
app2.disable("x-powered-by");
app2.use(createApiApp());
ensureSeedData().catch((err) => {
  console.error("Error ensuring seed data on cold start:", err);
});
var source_default = app2;
export {
  source_default as default
};
