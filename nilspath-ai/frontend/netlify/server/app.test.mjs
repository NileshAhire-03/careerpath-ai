import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../db/schema.ts";
import { createApp } from "./app.mjs";
import { scoreResume } from "./policy.mjs";
let client, db, server, url;
const identities = {
  candidate: { id: "candidate", email: "candidate@example.test" },
  hr: { id: "hr", email: "hr@example.test" },
  stranger: { id: "stranger", email: "stranger@example.test" },
  admin: {
    id: "admin",
    email: "admin@example.test",
    app_metadata: { roles: ["admin"] },
  },
  fakeAdmin: {
    id: "fake",
    email: "fake@example.test",
    user_metadata: { roles: ["admin"] },
  },
};
before(async () => {
  client = new PGlite();
  db = drizzle({ client, schema });
  const root = new URL("../database/migrations/", import.meta.url);
  for (const entry of (await readdir(root)).sort()) {
    if (entry.endsWith(".sql"))
      await client.exec(await readFile(new URL(entry, root), "utf8"));
    else
      await client.exec(
        await readFile(new URL(entry + "/migration.sql", root), "utf8"),
      );
  }
  server = createApp(
    db,
    async (req) => identities[req.get("x-test-user")],
  ).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await client?.close();
});
async function request(path, { who, role, method = "GET", body, origin } = {}) {
  const res = await fetch(url + "/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(who ? { "x-test-user": who } : {}),
      ...(role ? { "x-workspace": role } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: res.status,
    data: res.status === 204 ? null : await res.json(),
  };
}
test("backend lifecycle enforces identity, approvals, ownership and persistent mutations", async () => {
  assert.equal((await request("/jobs")).status, 401);
  assert.equal(
    (await request("/admin/accounts", { who: "fakeAdmin", role: "ADMIN" }))
      .status,
    403,
  );
  assert.equal(
    (
      await request("/auth/register", {
        who: "candidate",
        method: "POST",
        body: { role: "ADMIN", username: "hacker", fullName: "Hacker" },
      })
    ).status,
    400,
  );
  for (const [who, role] of [
    ["candidate", "CANDIDATE"],
    ["hr", "HR"],
    ["stranger", "HR"],
  ])
    assert.equal(
      (
        await request("/auth/register", {
          who,
          method: "POST",
          body: { role, username: who, fullName: who },
        })
      ).status,
      201,
    );
  assert.equal(
    (await request("/hr/jobs", { who: "hr", role: "HR" })).status,
    403,
  );
  const listed = await request("/admin/accounts", {
    who: "admin",
    role: "ADMIN",
  });
  assert.equal(listed.status, 200);
  assert.equal("identityId" in listed.data[0], false);
  for (const a of listed.data.filter((a) => a.role === "HR"))
    assert.equal(
      (
        await request(`/admin/hr/${a.id}/approve`, {
          who: "admin",
          role: "ADMIN",
          method: "PUT",
        })
      ).status,
      200,
    );
  const posted = await request("/hr/jobs", {
    who: "hr",
    role: "HR",
    method: "POST",
    body: {
      title: "Developer",
      company: "Test Company",
      city: "Pune",
      type: "Remote",
      skills: "java,sql",
      distanceKm: 0,
    },
  });
  assert.equal(posted.status, 201);
  const job = posted.data;
  assert.equal(
    (
      await request(`/hr/jobs/${job.id}/close`, {
        who: "stranger",
        role: "HR",
        method: "PUT",
      })
    ).status,
    404,
  );
  const input = {
    who: "candidate",
    role: "CANDIDATE",
    method: "POST",
    body: { objective: "Build applications" },
  };
  const application = await request(`/candidate/jobs/${job.id}/apply`, input);
  assert.equal(application.status, 201);
  assert.equal(
    (await request(`/candidate/jobs/${job.id}/apply`, input)).status,
    409,
  );
  assert.equal(
    (
      await request(`/hr/applications/${application.data.id}/status`, {
        who: "stranger",
        role: "HR",
        method: "PUT",
        body: { status: "SHORTLISTED" },
      })
    ).status,
    404,
  );
  const interviewPath = `/hr/applications/${application.data.id}/interviews`;
  assert.equal(
    (
      await request(interviewPath, {
        who: "hr",
        role: "HR",
        method: "POST",
        body: { scheduledAt: "2000-01-01T12:00:00Z" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(interviewPath, {
        who: "hr",
        role: "HR",
        method: "POST",
        body: {
          scheduledAt: new Date(Date.now() + 86400000).toISOString(),
          notes: "Online",
        },
      })
    ).status,
    201,
  );
  const own = await request("/candidate/applications", {
    who: "candidate",
    role: "CANDIDATE",
  });
  assert.equal(own.data[0].status, "INTERVIEW");
  assert.equal(own.data[0].interviews.length, 1);
  const company = (
    await request("/admin/companies", { who: "admin", role: "ADMIN" })
  ).data.find((c) => c.name === "Test Company");
  assert.equal(
    (
      await request(`/admin/companies/${company.id}`, {
        who: "admin",
        role: "ADMIN",
        method: "DELETE",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/admin/companies/${company.id}`, {
        who: "admin",
        role: "ADMIN",
        method: "PUT",
        body: { name: "Renamed Company" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/jobs", { who: "candidate", role: "CANDIDATE" })).data.find(
      (j) => j.id === job.id,
    ).company,
    "Renamed Company",
  );
  assert.equal(
    (
      await request("/admin/settings", {
        who: "admin",
        role: "ADMIN",
        method: "PUT",
        body: { registrationAllowed: false, jobPostingAllowed: false },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/auth/register", {
        who: "candidate",
        method: "POST",
        body: { role: "HR", username: "candidate", fullName: "candidate" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/hr/jobs", {
        who: "hr",
        role: "HR",
        method: "POST",
        body: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/admin/jobs/${job.id}/close`, {
        who: "admin",
        role: "ADMIN",
        method: "PUT",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/candidate/jobs/${job.id}/apply`, input)).status,
    409,
  );
  assert.equal(
    (
      await request("/admin/settings", {
        who: "admin",
        role: "ADMIN",
        method: "PUT",
        origin: "https://untrusted.test",
        body: { registrationAllowed: true, jobPostingAllowed: true },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/admin/accounts", { who: "candidate", role: "ADMIN" }))
      .status,
    403,
  );
});
test("resume scoring preserves aliases, word boundaries and thresholds", () => {
  const jobs = [
    { id: 1, title: "Developer", skills: "java,javascript,react,spring boot" },
    { id: 2, title: "Other", skills: "" },
  ];
  const [match, empty] = scoreResume(
    "JavaScript, ReactJS and SpringBoot",
    jobs,
  );
  assert.equal(match.score, 75);
  assert.equal(match.level, "HIGH");
  assert.deepEqual(match.missingSkills, ["java"]);
  assert.equal(empty.score, 0);
  assert.throws(() => scoreResume(" ", jobs));
});

function pdfFixture() {
  const stream =
    "BT /F1 12 Tf 40 100 Td (Java developer with SQL experience) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(source));
    source += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const start = Buffer.byteLength(source);
  source += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return source;
}
test("resume uploads extract PDF text and reject unsupported files", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([pdfFixture()], { type: "application/pdf" }),
    "resume.pdf",
  );
  const response = await fetch(url + "/api/candidate/resume/upload", {
    method: "POST",
    headers: { "x-test-user": "candidate", "x-workspace": "CANDIDATE" },
    body: form,
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.fileName, "resume.pdf");
  assert.ok(result.characters > 0);
  assert.ok(result.matches.some((m) => m.matchedSkills.includes("java")));
  const invalid = new FormData();
  invalid.append("file", new Blob(["hello"]), "resume.txt");
  assert.equal(
    (
      await fetch(url + "/api/candidate/resume/upload", {
        method: "POST",
        headers: { "x-test-user": "candidate", "x-workspace": "CANDIDATE" },
        body: invalid,
      })
    ).status,
    400,
  );
  const screening = await request("/hr/resume/match-text", {
    who: "stranger",
    role: "HR",
    method: "POST",
    body: { resume: "java" },
  });
  assert.equal(screening.status, 200);
  assert.deepEqual(screening.data.matches, []);
});
