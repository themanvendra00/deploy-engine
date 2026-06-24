import crypto from "node:crypto";
import jwt from "jsonwebtoken";

// Use JWT_SECRET from environment or generate a secure random one on startup
export const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.JWT_SECRET) {
    console.warn("WARNING: JWT_SECRET environment variable is not defined. A temporary secret has been generated. Sessions will not persist across restarts.");
}

export function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
}