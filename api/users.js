const { readBody, readUsers, sendJson, writeUsers } = require("./_store");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const users = await readUsers();
      return sendJson(res, users.map(({ password, ...user }) => user));
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      await writeUsers(body.users);
      return sendJson(res, { ok: true });
    }
    return sendJson(res, { error: "Method not allowed" }, 405);
  } catch (error) {
    return sendJson(res, { error: error.message || "Server error" }, error.statusCode || 500);
  }
};
