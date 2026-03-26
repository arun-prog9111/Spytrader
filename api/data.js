module.exports = function handler(req, res) {
  res.status(200).json({ test: "hello", time: new Date().toISOString() });
};