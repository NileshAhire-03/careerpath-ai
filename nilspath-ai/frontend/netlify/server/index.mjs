import { db } from "../../db/index.ts";
import { createApp } from "./app.mjs";
import { ApiError } from "./policy.mjs";
const identityURL = new URL(
  "/.netlify/identity/user",
  process.env.URL || "https://careerpathai03.netlify.app",
);
export async function verifyIdentity(req) {
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("nf_jwt="));
  if (!cookie) throw new ApiError(401, "Sign in to continue.");
  let token;
  try {
    token = decodeURIComponent(cookie.slice(7));
  } catch {
    throw new ApiError(401, "Sign in again.");
  }
  const response = await fetch(identityURL, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new ApiError(
      response.status >= 500 ? 503 : 401,
      "Your session could not be verified. Sign in again.",
    );
  return response.json();
}
const app = createApp(db, verifyIdentity);
app.set("trust proxy", 1);
export const config = { path: "/api/*" };
export default app;
