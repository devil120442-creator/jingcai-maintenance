const { currentUser, sendJson } = require("./_store");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, { error: "Method not allowed" }, 405);
  return sendJson(res, currentUser());
};
