const { readBody, readData, sendJson, writeData } = require("./_store");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") return sendJson(res, await readData());
    if (req.method === "POST") {
      return sendJson(res, await writeData(await readBody(req)));
    }
    return sendJson(res, { error: "Method not allowed" }, 405);
  } catch (error) {
    return sendJson(res, { error: error.message || "Server error" }, error.statusCode || 500);
  }
};
