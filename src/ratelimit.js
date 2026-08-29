/**
 * Tiny per-IP fixed-window rate limiter for the FREE endpoints. Paid routes are
 * self-limiting (payment is the rate limit), so this only guards the unpaid,
 * DB-backed routes (/v1/sources, /v1/receipts) from abuse.
 *
 * Relies on Express `trust proxy` (set in server.js) so req.ip is the real
 * client IP behind Caddy. In-memory; single-instance — fine for this service.
 */
function rateLimiter({ windowMs, max }) {
  if (!max || max <= 0) return (req, res, next) => next(); // disabled

  const hits = new Map(); // ip -> { count, resetAt }

  // Periodic sweep so the map can't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of hits) if (now > e.resetAt) hits.delete(ip);
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || "unknown";
    let e = hits.get(ip);
    if (!e || now > e.resetAt) {
      e = { count: 0, resetAt: now + windowMs };
      hits.set(ip, e);
    }
    e.count++;
    if (e.count > max) {
      res.set("Retry-After", String(Math.ceil((e.resetAt - now) / 1000)));
      return res.status(429).json({ error: "rate limit exceeded; slow down" });
    }
    next();
  };
}

module.exports = { rateLimiter };
