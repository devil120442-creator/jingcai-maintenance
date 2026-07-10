const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4173);
const LOGIN_REQUIRED = process.env.LOGIN_REQUIRED === "true";
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ROOT;
fs.mkdirSync(DATA_DIR, { recursive: true });
const BUNDLED_DATA_FILE = path.join(ROOT, "jingcai-logistics-maintenance-data.json");
const BUNDLED_USERS_FILE = path.join(ROOT, "jingcai-users.json");
const DATA_FILE = path.join(DATA_DIR, "jingcai-logistics-maintenance-data.json");
const USERS_FILE = path.join(DATA_DIR, "jingcai-users.json");
const INDEX_FILE = path.join(ROOT, "car-maintenance-records.html");
const sessions = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

ensureDataFile();
ensureUsersFile();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/login" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const users = readUsers();
      const user = users.find(item => item.username === String(body.username || "").trim());
      if (!user || user.password !== String(body.password || "")) {
        return sendJson(res, { error: "帳號或密碼錯誤" }, 401);
      }
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, {
        username: user.username,
        role: user.role || "user",
        createdAt: Date.now()
      });
      res.setHeader("Set-Cookie", `jc_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
      return sendJson(res, { username: user.username, role: user.role || "user" });
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      const token = getSessionToken(req);
      if (token) sessions.delete(token);
      res.setHeader("Set-Cookie", "jc_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
      return sendJson(res, { ok: true });
    }

    if (url.pathname === "/api/me" && req.method === "GET") {
      const user = currentUser(req);
      return user ? sendJson(res, user) : sendJson(res, { error: "尚未登入" }, 401);
    }

    if (url.pathname === "/api/users" && req.method === "GET") {
      const user = requireUser(req, res);
      if (!user) return;
      if (user.role !== "admin") return sendJson(res, { error: "只有管理員可以查看帳號" }, 403);
      return sendJson(res, readUsers().map(({ password, ...item }) => item));
    }

    if (url.pathname === "/api/users" && req.method === "POST") {
      const user = requireUser(req, res);
      if (!user) return;
      if (user.role !== "admin") return sendJson(res, { error: "只有管理員可以更改帳號" }, 403);
      const body = JSON.parse((await readBody(req)) || "{}");
      const users = normalizeUsers(body.users);
      if (!users.some(item => item.username === "admin" && item.role === "admin")) {
        users.unshift({ username: "admin", password: "admin", role: "admin" });
      }
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
      return sendJson(res, { ok: true });
    }

    if (url.pathname === "/api/data" && req.method === "GET") {
      if (!requireUser(req, res)) return;
      return sendJson(res, readData());
    }

    if (url.pathname === "/api/data" && req.method === "POST") {
      if (!requireUser(req, res)) return;
      const data = JSON.parse((await readBody(req)) || "{}");
      if (!Array.isArray(data.vehicles) || !Array.isArray(data.records)) {
        return sendJson(res, { error: "資料格式不正確" }, 400);
      }
      const current = readData() || { revision: 0 };
      if ((Number(data.revision) || 0) !== (Number(current.revision) || 0)) {
        return sendJson(res, { error: "資料已被其他裝置更新，請重新整理後再儲存" }, 409);
      }
      const next = { ...data, revision: (Number(current.revision) || 0) + 1 };
      fs.writeFileSync(DATA_FILE, JSON.stringify(next, null, 2), "utf8");
      return sendJson(res, next);
    }

    return serveStatic(url, res);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`伺服器發生錯誤：${error.message}`);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const addresses = getLanAddresses();
  console.log("");
  console.log("晶彩物流保養紀錄系統已啟動");
  console.log(`本機網址：http://localhost:${PORT}`);
  if (addresses.length) {
    console.log("同一個 Wi-Fi / 區網可使用：");
    addresses.forEach(address => console.log(`http://${address}:${PORT}`));
  }
  console.log("管理員帳號：admin");
  console.log("管理員密碼：admin");
  console.log("");
  console.log("請保持這個視窗開啟，關閉後手機與其他電腦就無法連線。");
});

function serveStatic(url, res) {
  const requested = url.pathname === "/" ? INDEX_FILE : path.join(ROOT, decodeURIComponent(url.pathname));
  const resolved = path.resolve(requested);
  if (!resolved.startsWith(ROOT) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("找不到頁面");
  }

  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(resolved).pipe(res);
}

function ensureDataFile() {
  if (fs.existsSync(DATA_FILE)) return;
  if (fs.existsSync(BUNDLED_DATA_FILE)) {
    fs.copyFileSync(BUNDLED_DATA_FILE, DATA_FILE);
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    selectedVehicleId: "",
    vehicles: [],
    records: []
  }, null, 2), "utf8");
}

function ensureUsersFile() {
  if (!fs.existsSync(USERS_FILE)) {
    if (fs.existsSync(BUNDLED_USERS_FILE)) {
      fs.copyFileSync(BUNDLED_USERS_FILE, USERS_FILE);
      return;
    }
    fs.writeFileSync(USERS_FILE, JSON.stringify([
      { username: "admin", password: "admin", role: "admin" }
    ], null, 2), "utf8");
    return;
  }
  const users = normalizeUsers(readUsers());
  if (!users.some(user => user.username === "admin" && user.role === "admin")) {
    users.unshift({ username: "admin", password: "admin", role: "admin" });
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

function readUsers() {
  try {
    return normalizeUsers(JSON.parse(fs.readFileSync(USERS_FILE, "utf8")));
  } catch {
    return [{ username: "admin", password: "admin", role: "admin" }];
  }
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

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) sendJson(res, { error: "請先登入" }, 401);
  return user;
}

function currentUser(req) {
  if (!LOGIN_REQUIRED) {
    return { username: "admin", role: "admin" };
  }
  const token = getSessionToken(req);
  if (!token) return null;
  return sessions.get(token) || null;
}

function getSessionToken(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)jc_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function readData() {
  if (!fs.existsSync(DATA_FILE)) return null;
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  return { ...data, revision: Number(data.revision) || 0 };
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
        reject(new Error("資料太大"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function getLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(item => item && item.family === "IPv4" && !item.internal)
    .map(item => item.address);
}
