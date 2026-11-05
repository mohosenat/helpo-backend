import { createRemoteJWKSet, jwtVerify } from "jose";

let jwks;

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Please log in",
      });
    }

    const base = process.env.BETTER_AUTH_URL || "http://localhost:5000";

    jwks ||= createRemoteJWKSet(new URL(`${base}/api/auth/jwks`));

    const { payload } = await jwtVerify(header.slice(7), jwks);

    const email = payload.email || payload.sub;

    if (!email) {
      return res.status(401).json({
        message: "Invalid token",
      });
    }

    req.user = {
      email,
      name: payload.name || "Community member",
      image: payload.image || "",
    };

    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired session token",
    });
  }
}
