const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "outputs");
const DATA_FILE_NAME = "jingcai-logistics-maintenance-data.json";
const USERS_FILE_NAME = "jingcai-users.json";
const DATA_FILE = path.join(DATA_DIR, DATA_FILE_NAME);
const USERS_FILE = path.join(DATA_DIR, USERS_FILE_NAME);
const BUNDLED_DATA_FILE = path.join(ROOT, "outputs", DATA_FILE_NAME);
const BUNDLED_USERS_FILE = path.join(ROOT, "outputs", USERS_FILE_NAME);
const BLOB_DATA_PATH = `jingcai/${DATA_FILE_NAME}`;
const BLOB_USERS_PATH = `jingcai/${USERS_FILE_NAME}`;

function hasBlobStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

async function blobSdk() {
  return import("@vercel/blob");
}

async function readBlobJson(pathname, fallbackFile, fallbackValue) {
  const { get, put } = await blobSdk();
  const result = await get(pathname, { access: "private" }).catch(() => null);
  if (result?.stream) {
    return JSON.parse(await new Response(result.stream).text());
  }
  const initial = fs.existsSync(fallbackFile) ? JSON.parse(fs.readFileSync(fallbackFile, "utf8")) : fallbackValue;
  await put(pathname, JSON.stringify(initial, null, 2), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json"
  });
  return initial;
}

async function writeBlobJson(pathname, data) {
  const { put } = await blobSdk();
  await put(pathname, JSON.stringify(data, null, 2), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json"
  });
}

function ensureLocalFile(file, bundledFile, fallbackValue) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(file)) return;
  if (fs.existsSync(bundledFile)) {
    fs.copyFileSync(bundledFile, file);
    return;
  }
  fs.writeFileSync(file, JSON.stringify(fallbackValue, null, 2), "utf8");
}

async function readData() {
  const fallback = { selectedVehicleId: "", vehicles: [], records: [], revision: 0 };
  const data = hasBlobStore()
    ? await readBlobJson(BLOB_DATA_PATH, BUNDLED_DATA_FILE, fallback)
    : (ensureLocalFile(DATA_FILE, BUNDLED_DATA_FILE, fallback), JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  return { ...data, revision: Number(data.revision) || 0 };
}

async function writeData(data) {
  if (!Array.isArray(data.vehicles) || !Array.isArray(data.records)) {
    const error = new Error("資料格式不正確");
    error.statusCode = 400;
    throw error;
  }
  const current = await readData();
  if ((Number(data.revision) || 0) !== current.revision) {
    const error = new Error("資料已被其他裝置更新，請重新整理後再儲存");
    error.statusCode = 409;
    throw error;
  }
  // ponytail: stale-write detection; use transactional storage if simultaneous writes become common.
  const next = { ...data, revision: current.revision + 1 };
  if (hasBlobStore()) return writeBlobJson(BLOB_DATA_PATH, next).then(() => next);
  ensureLocalFile(DATA_FILE, BUNDLED_DATA_FILE, { selectedVehicleId: "", vehicles: [], records: [] });
  fs.writeFileSync(DATA_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function normalizeUsers(users) {
  if (!Array.isArray(users)) return [];
  const seen = new Set();
  return users
    .map(user => ({
      username: String(user.username || "").trim(),
      password: String(user.password || ""),
      role: user.role === "admin" ? "admin" : "user"
    }))
    .filter(user => user.username && user.password)
    .filter(user => {
      if (seen.has(user.username)) return false;
      seen.add(user.username);
      return true;
    });
}

async function readUsers() {
  const fallback = [{ username: "admin", password: "admin", role: "admin" }];
  const users = hasBlobStore()
    ? await readBlobJson(BLOB_USERS_PATH, BUNDLED_USERS_FILE, fallback)
    : (() => {
        ensureLocalFile(USERS_FILE, BUNDLED_USERS_FILE, fallback);
        return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
      })();
  const normalized = normalizeUsers(users);
  if (!normalized.some(user => user.username === "admin" && user.role === "admin")) {
    normalized.unshift({ username: "admin", password: "admin", role: "admin" });
  }
  return normalized;
}

async function writeUsers(users) {
  const normalized = normalizeUsers(users);
  if (!normalized.some(user => user.username === "admin" && user.role === "admin")) {
    normalized.unshift({ username: "admin", password: "admin", role: "admin" });
  }
  if (hasBlobStore()) return writeBlobJson(BLOB_USERS_PATH, normalized);
  ensureLocalFile(USERS_FILE, BUNDLED_USERS_FILE, [{ username: "admin", password: "admin", role: "admin" }]);
  fs.writeFileSync(USERS_FILE, JSON.stringify(normalized, null, 2), "utf8");
}

function sendJson(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) reject(new Error("資料過大"));
    });
    req.on("end", () => resolve(JSON.parse(body || "{}")));
    req.on("error", reject);
  });
}

function currentUser() {
  return { username: "admin", role: "admin" };
}

module.exports = {
  currentUser,
  readBody,
  readData,
  readUsers,
  sendJson,
  writeData,
  writeUsers
};
