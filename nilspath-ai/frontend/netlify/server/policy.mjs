export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function requireThat(condition, status, message, code) {
  if (!condition) throw new ApiError(status, message, code);
}
export function text(value, name, max = 255, required = true) {
  requireThat(
    typeof value === "string" &&
      value.length <= max &&
      (!required || value.trim()),
    400,
    `${name} is required and must contain at most ${max} characters.`,
  );
  return required ? value.trim() : value;
}
export function profile(input) {
  requireThat(
    ["CANDIDATE", "HR"].includes(input.role),
    400,
    "Choose Candidate or HR.",
  );
  const username = text(input.username, "Username", 100);
  requireThat(/^[A-Za-z0-9_.@-]+$/.test(username), 400, "Invalid username.");
  return {
    username,
    role: input.role,
    fullName: text(input.fullName, "Full name", 200),
    approved: input.role === "CANDIDATE",
  };
}
export function futureDate(value) {
  requireThat(
    typeof value === "string" && /(Z|[+-]\d\d:\d\d)$/i.test(value),
    400,
    "Choose an interview time with a timezone.",
  );
  const d = new Date(value);
  requireThat(
    Number.isFinite(d.getTime()) && d.getTime() > Date.now(),
    400,
    "Choose a future interview time.",
  );
  return d.toISOString();
}
const aliases = {
  js: "javascript",
  "react.js": "react",
  reactjs: "react",
  springboot: "spring boot",
  postgres: "postgresql",
  nodejs: "node.js",
  node: "node.js",
};
const variants = {
  javascript: ["javascript", "js"],
  react: ["react", "react.js", "reactjs"],
  "spring boot": ["spring boot", "springboot"],
  postgresql: ["postgresql", "postgres"],
  "node.js": ["node.js", "nodejs", "node"],
};
const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function scoreResume(resume, jobs) {
  text(resume, "Resume text", 150000);
  const content = normalize(resume);
  return jobs
    .map((job) => {
      const required = [
        ...new Set(
          (job.skills || "")
            .split(",")
            .map(normalize)
            .filter(Boolean)
            .map((s) => aliases[s] || s),
        ),
      ].slice(0, 40);
      const matchedSkills = required.filter((s) =>
        (variants[s] || [s]).some((t) =>
          new RegExp("(?<![a-z0-9+#])" + escape(t) + "(?![a-z0-9+#])").test(
            content,
          ),
        ),
      );
      const missingSkills = required.filter((s) => !matchedSkills.includes(s));
      const score = required.length
        ? Math.round((100 * matchedSkills.length) / required.length)
        : 0;
      return {
        jobId: job.id,
        title: job.title,
        score,
        level: score >= 70 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW",
        matched: matchedSkills.length,
        total: required.length,
        matchedSkills,
        missingSkills,
        recommendation: !required.length
          ? "No required skills listed."
          : !missingSkills.length
            ? "All listed skills found."
            : "Consider learning: " + missingSkills.join(", "),
      };
    })
    .sort((a, b) => b.score - a.score || a.jobId - b.jobId);
}
