import express from "express";
import multer from "multer";
import { and, eq, sql, count } from "drizzle-orm";
import {
  accounts,
  companies,
  jobs,
  applications,
  interviews,
  settings,
} from "../../db/schema.ts";
import {
  ApiError,
  requireThat,
  text,
  profile,
  futureDate,
  scoreResume,
} from "./policy.mjs";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
});
const one = async (query) => (await query)[0];
const publicAccount = ({ identityId, ...a }) => a;
export function createApp(db, verifyIdentity) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "650kb" }));
  app.use("/api", (req, res, next) => {
    req.body ||= {};
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if (origin && origin !== `${req.protocol}://${req.get("host")}`)
        return res
          .status(403)
          .json({ error: "Request origin is not allowed." });
    }
    next();
  });
  app.param("id", (req, res, next, value) => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
      return res.status(400).json({ error: "Invalid record ID." });
    next();
  });
  app.get("/api/health", async (req, res) => {
    await db.select({ n: count() }).from(settings);
    res.json({ status: "ok", database: "connected" });
  });
  app.use("/api", async (req, res, next) => {
    try {
      req.identity = await verifyIdentity(req);
      requireThat(req.identity?.id, 401, "Sign in to continue.");
      next();
    } catch (e) {
      next(e);
    }
  });
  const currentSettings = async () =>
    (await one(db.select().from(settings).where(eq(settings.id, 1)))) || {
      id: 1,
      registrationAllowed: true,
      jobPostingAllowed: true,
    };
  app.post("/api/auth/register", async (req, res) => {
    requireThat(
      (await currentSettings()).registrationAllowed,
      403,
      "Registration is currently disabled.",
    );
    const input = profile(req.body);
    const existing = await one(
      db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.identityId, req.identity.id),
            eq(accounts.role, input.role),
          ),
        ),
    );
    if (existing) return res.json(publicAccount(existing));
    const [a] = await db
      .insert(accounts)
      .values({ ...input, identityId: req.identity.id })
      .returning();
    res.status(201).json(publicAccount(a));
  });
  app.use("/api", async (req, res, next) => {
    try {
      const role = req.get("x-workspace");
      requireThat(
        ["CANDIDATE", "HR", "ADMIN"].includes(role),
        400,
        "Choose a valid workspace.",
      );
      if (role === "ADMIN")
        requireThat(
          (req.identity.app_metadata?.roles || []).includes("admin"),
          403,
          "Administrator access is required.",
        );
      let account = await one(
        db
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.identityId, req.identity.id),
              eq(accounts.role, role),
            ),
          ),
      );
      if (!account && role === "ADMIN") {
        [account] = await db
          .insert(accounts)
          .values({
            identityId: req.identity.id,
            username: req.identity.email,
            fullName: "Administrator",
            role: "ADMIN",
            approved: true,
          })
          .onConflictDoNothing()
          .returning();
        account ||= await one(
          db
            .select()
            .from(accounts)
            .where(
              and(
                eq(accounts.identityId, req.identity.id),
                eq(accounts.role, role),
              ),
            ),
        );
      }
      requireThat(
        account,
        403,
        "Register a profile in this workspace first.",
        "PROFILE_REQUIRED",
      );
      requireThat(
        account.approved,
        403,
        "Your HR account is awaiting administrator approval.",
        "HR_APPROVAL_PENDING",
      );
      req.account = account;
      next();
    } catch (e) {
      next(e);
    }
  });
  const role = (expected) => (req, res, next) => {
    try {
      requireThat(
        req.account.role === expected,
        403,
        "You do not have access to this workspace.",
      );
      next();
    } catch (e) {
      next(e);
    }
  };
  app.use("/api/candidate", role("CANDIDATE"));
  app.use("/api/hr", role("HR"));
  app.use("/api/admin", role("ADMIN"));
  app.get("/api/auth/me", (req, res) => res.json(publicAccount(req.account)));
  app.post("/api/auth/login", (req, res) =>
    res.json(publicAccount(req.account)),
  );
  app.get("/api/jobs", async (req, res) =>
    res.json(await db.select().from(jobs).where(eq(jobs.active, true))),
  );
  app.get("/api/hr/jobs", async (req, res) =>
    res.json(await db.select().from(jobs).where(eq(jobs.hrId, req.account.id))),
  );
  app.get("/api/admin/jobs", async (req, res) =>
    res.json(await db.select().from(jobs)),
  );
  async function companyFor(tx, name) {
    await tx.insert(companies).values({ name }).onConflictDoNothing();
    return one(
      tx
        .select()
        .from(companies)
        .where(sql`lower(${companies.name}) = lower(${name})`),
    );
  }
  app.post("/api/hr/jobs", async (req, res) => {
    requireThat(
      (await currentSettings()).jobPostingAllowed,
      403,
      "New job posting is disabled.",
    );
    const b = req.body;
    const input = {
      title: text(b.title, "Title", 200),
      company: text(b.company, "Company", 200),
      city: text(b.city, "City", 100),
      type: text(b.type, "Type", 100),
      skills: text(b.skills ?? "", "Skills", 255, false),
      distanceKm: Number(b.distanceKm),
      hrId: req.account.id,
    };
    requireThat(
      Number.isInteger(input.distanceKm) &&
        input.distanceKm >= 0 &&
        input.distanceKm <= 2147483647,
      400,
      "Distance must be a non-negative integer.",
    );
    res.status(201).json(
      await db.transaction(async (tx) => {
        const company = await companyFor(tx, input.company);
        return one(
          tx
            .insert(jobs)
            .values({ ...input, company: company.name, companyId: company.id })
            .returning(),
        );
      }),
    );
  });
  for (const workspace of ["hr", "admin"])
    app.put(`/api/${workspace}/jobs/:id/close`, async (req, res) => {
      const condition =
        workspace === "hr"
          ? and(
              eq(jobs.id, Number(req.params.id)),
              eq(jobs.hrId, req.account.id),
            )
          : eq(jobs.id, Number(req.params.id));
      const job = await one(
        db.update(jobs).set({ active: false }).where(condition).returning(),
      );
      requireThat(job, 404, "Job not found.");
      res.json(job);
    });
  app.post("/api/candidate/jobs/:id/apply", async (req, res) => {
    const b = req.body || {};
    const input = {
      objective: text(b.objective ?? "", "Objective", 255, false),
      previousWork: text(b.previousWork ?? "", "Previous work", 255, false),
      expectedSalary: text(
        b.expectedSalary ?? "",
        "Expected salary",
        255,
        false,
      ),
    };
    const result = await db.transaction(async (tx) => {
      const job = await one(
        tx
          .select()
          .from(jobs)
          .where(eq(jobs.id, Number(req.params.id)))
          .for("update"),
      );
      requireThat(job, 404, "Job not found.");
      requireThat(job.active, 409, "This job is closed.");
      return one(
        tx
          .insert(applications)
          .values({ ...input, jobId: job.id, candidateId: req.account.id })
          .returning(),
      );
    });
    res.status(201).json(result);
  });
  async function applicationViews(condition) {
    const rows = await db
      .select({
        application: applications,
        job: jobs.title,
        candidate: accounts.fullName,
      })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(accounts, eq(accounts.id, applications.candidateId))
      .where(condition);
    return Promise.all(
      rows.map(async (row) => ({
        ...row.application,
        job: row.job,
        candidate: row.candidate,
        interviews: await db
          .select()
          .from(interviews)
          .where(eq(interviews.applicationId, row.application.id)),
      })),
    );
  }
  app.get("/api/candidate/applications", async (req, res) =>
    res.json(
      await applicationViews(eq(applications.candidateId, req.account.id)),
    ),
  );
  app.get("/api/hr/applications", async (req, res) =>
    res.json(await applicationViews(eq(jobs.hrId, req.account.id))),
  );
  async function ownedApplication(tx, id, owner) {
    const row = await one(
      tx
        .select({ application: applications })
        .from(applications)
        .innerJoin(jobs, eq(jobs.id, applications.jobId))
        .where(and(eq(applications.id, Number(id)), eq(jobs.hrId, owner))),
    );
    requireThat(row, 404, "Application not found.");
    return row.application;
  }
  app.put("/api/hr/applications/:id/status", async (req, res) => {
    const status = String(req.body.status).toUpperCase();
    requireThat(
      ["APPLIED", "SHORTLISTED", "REJECTED"].includes(status),
      400,
      "Choose APPLIED, SHORTLISTED or REJECTED.",
    );
    await ownedApplication(db, req.params.id, req.account.id);
    res.json(
      await one(
        db
          .update(applications)
          .set({ status })
          .where(eq(applications.id, Number(req.params.id)))
          .returning(),
      ),
    );
  });
  app.post("/api/hr/applications/:id/interviews", async (req, res) => {
    const scheduledAt = futureDate(req.body.scheduledAt);
    const notes = text(req.body.notes ?? "", "Notes", 255, false);
    res.status(201).json(
      await db.transaction(async (tx) => {
        const a = await ownedApplication(tx, req.params.id, req.account.id);
        const interview = await one(
          tx
            .insert(interviews)
            .values({ applicationId: a.id, scheduledAt, notes })
            .returning(),
        );
        await tx
          .update(applications)
          .set({ status: "INTERVIEW" })
          .where(eq(applications.id, a.id));
        return interview;
      }),
    );
  });
  const visibleJobs = (req) =>
    db
      .select()
      .from(jobs)
      .where(
        req.account.role === "HR"
          ? eq(jobs.hrId, req.account.id)
          : eq(jobs.active, true),
      );
  for (const workspace of ["candidate", "hr"]) {
    app.post(`/api/${workspace}/resume/match-text`, async (req, res) =>
      res.json({
        matches: scoreResume(req.body.resume, await visibleJobs(req)),
      }),
    );
    app.post(
      `/api/${workspace}/resume/upload`,
      upload.single("file"),
      async (req, res) => {
        requireThat(
          req.file?.size,
          400,
          "Choose a non-empty PDF or DOCX file.",
        );
        const name = req.file.originalname.toLowerCase();
        let content;
        try {
          if (name.endsWith(".pdf")) {
            requireThat(
              req.file.buffer.subarray(0, 5).toString() === "%PDF-",
              400,
              "Upload a valid PDF.",
            );
            const { PDFParse } = await import("pdf-parse");
            const parser = new PDFParse({
              data: new Uint8Array(req.file.buffer),
            });
            try {
              const info = await parser.getInfo();
              requireThat(
                info.total <= 30,
                400,
                "Resume must contain at most 30 pages.",
              );
              content = (await parser.getText()).text;
            } finally {
              await parser.destroy();
            }
          } else if (name.endsWith(".docx")) {
            const { default: mammoth } = await import("mammoth");
            content = (
              await mammoth.extractRawText({ buffer: req.file.buffer })
            ).value;
          } else
            throw new ApiError(400, "Only PDF and DOCX files are supported.");
        } catch (e) {
          if (e instanceof ApiError) throw e;
          throw new ApiError(
            400,
            "Could not read resume. Upload a valid, unencrypted PDF or DOCX.",
          );
        }
        requireThat(
          content.trim(),
          400,
          "No selectable text found. Scanned-image resumes require OCR.",
        );
        res.json({
          fileName: name,
          characters: content.length,
          matches: scoreResume(content, await visibleJobs(req)),
        });
      },
    );
  }
  app.post("/api/candidate/analyze", async (req, res) =>
    res.json(scoreResume(req.body.resume, await visibleJobs(req))),
  );
  app.get("/api/admin/accounts", async (req, res) =>
    res.json((await db.select().from(accounts)).map(publicAccount)),
  );
  app.put("/api/admin/hr/:id/approve", async (req, res) => {
    const a = await one(
      db
        .update(accounts)
        .set({ approved: true })
        .where(
          and(eq(accounts.id, Number(req.params.id)), eq(accounts.role, "HR")),
        )
        .returning(),
    );
    requireThat(a, 404, "HR account not found.");
    res.json(publicAccount(a));
  });
  app.get("/api/admin/reports", async (req, res) => {
    const total = async (table, where) =>
      Number((await one(db.select({ n: count() }).from(table).where(where))).n);
    res.json({
      candidates: await total(accounts, eq(accounts.role, "CANDIDATE")),
      hrAccounts: await total(accounts, eq(accounts.role, "HR")),
      pendingHR: await total(
        accounts,
        and(eq(accounts.role, "HR"), eq(accounts.approved, false)),
      ),
      jobs: await total(jobs),
      applications: await total(applications),
      interviews: await total(interviews),
    });
  });
  app.get("/api/admin/companies", async (req, res) =>
    res.json(await db.select().from(companies)),
  );
  const companyInput = (b) => {
    const input = {
      name: text(b.name, "Company name", 200),
      city: text(b.city ?? "", "City", 100, false),
      website: text(b.website ?? "", "Website", 500, false),
    };
    requireThat(
      !input.website || /^https?:\/\/[^\s]+$/.test(input.website),
      400,
      "Enter an HTTP or HTTPS website.",
    );
    return input;
  };
  app.post("/api/admin/companies", async (req, res) =>
    res
      .status(201)
      .json(
        await one(
          db.insert(companies).values(companyInput(req.body)).returning(),
        ),
      ),
  );
  app.put("/api/admin/companies/:id", async (req, res) => {
    const input = companyInput(req.body);
    res.json(
      await db.transaction(async (tx) => {
        const company = await one(
          tx
            .update(companies)
            .set(input)
            .where(eq(companies.id, Number(req.params.id)))
            .returning(),
        );
        requireThat(company, 404, "Company not found.");
        await tx
          .update(jobs)
          .set({ company: input.name })
          .where(eq(jobs.companyId, company.id));
        return company;
      }),
    );
  });
  app.delete("/api/admin/companies/:id", async (req, res) => {
    const c = await one(
      db
        .delete(companies)
        .where(eq(companies.id, Number(req.params.id)))
        .returning(),
    );
    requireThat(c, 404, "Company not found.");
    res.status(204).end();
  });
  app.get("/api/admin/settings", async (req, res) =>
    res.json(await currentSettings()),
  );
  app.put("/api/admin/settings", async (req, res) => {
    const { registrationAllowed, jobPostingAllowed } = req.body;
    requireThat(
      typeof registrationAllowed === "boolean" &&
        typeof jobPostingAllowed === "boolean",
      400,
      "Both settings must be true or false.",
    );
    const input = { id: 1, registrationAllowed, jobPostingAllowed };
    res.json(
      await one(
        db
          .insert(settings)
          .values(input)
          .onConflictDoUpdate({ target: settings.id, set: input })
          .returning(),
      ),
    );
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API endpoint not found." }),
  );
  app.use((err, req, res, next) => {
    let code = err.code || err.cause?.code;
    const status =
      err.status ||
      (code === "23505" || code === "23503"
        ? 409
        : err instanceof multer.MulterError
          ? 413
          : 500);
    res
      .status(status)
      .json({
        error:
          status === 500
            ? "The request could not be completed. Please try again."
            : code === "23505"
              ? "This record already exists."
              : code === "23503"
                ? "This company has job listings and cannot be deleted."
                : err.type === "entity.parse.failed"
                  ? "Invalid JSON request."
                  : err.message,
        ...(err instanceof ApiError && err.code ? { code: err.code } : {}),
      });
  });
  return app;
}
