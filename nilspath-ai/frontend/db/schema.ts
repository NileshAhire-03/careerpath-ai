import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    identityId: text("identity_id").notNull(),
    username: text("username").notNull(),
    role: text("role").notNull(),
    approved: boolean("approved").notNull().default(false),
    fullName: text("full_name").notNull(),
  },
  (t) => [
    uniqueIndex("account_identity_role").on(t.identityId, t.role),
    uniqueIndex("account_username_role").on(sql`lower(${t.username})`, t.role),
    check("account_role", sql`${t.role} IN ('CANDIDATE','HR','ADMIN')`),
  ],
);
export const companies = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    city: text("city").notNull().default(""),
    website: text("website").notNull().default(""),
  },
  (t) => [uniqueIndex("company_name").on(sql`lower(${t.name})`)],
);
export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    city: text("city").notNull(),
    type: text("type").notNull(),
    skills: text("skills").notNull().default(""),
    distanceKm: integer("distance_km").notNull().default(0),
    hrId: integer("hr_id").references(() => accounts.id),
    active: boolean("active").notNull().default(true),
  },
  (t) => [check("job_distance", sql`${t.distanceKm} >= 0`)],
);
export const applications = pgTable(
  "applications",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => accounts.id),
    status: text("status").notNull().default("APPLIED"),
    objective: text("objective").notNull().default(""),
    previousWork: text("previous_work").notNull().default(""),
    expectedSalary: text("expected_salary").notNull().default(""),
  },
  (t) => [
    uniqueIndex("application_candidate_job").on(t.candidateId, t.jobId),
    check(
      "application_status",
      sql`${t.status} IN ('APPLIED','SHORTLISTED','REJECTED','INTERVIEW')`,
    ),
  ],
);
export const interviews = pgTable("interviews", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id")
    .notNull()
    .references(() => applications.id),
  scheduledAt: timestamp("scheduled_at", {
    withTimezone: true,
    mode: "string",
  }).notNull(),
  notes: text("notes").notNull().default(""),
});
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  registrationAllowed: boolean("registration_allowed").notNull().default(true),
  jobPostingAllowed: boolean("job_posting_allowed").notNull().default(true),
});
