# CareerPath AI — Candidate Recruitment and Job Recommendation System

A Java Spring Boot + React role-based recruitment platform starter.

## Requirements
- Java 17+ and Maven 3.9+
- Node.js 20+ and npm
- MySQL 8+ for development and production

## Start backend
From the `nilspath-ai` folder in Windows Command Prompt, after configuring `.env`, run:
```cmd
start-backend.cmd
```
This launcher loads `.env` and runs Maven inside `backend`, where `pom.xml` is located. Running `mvn spring-boot:run` directly inside `nilspath-ai` fails because that folder is not a Maven project.

```bash
cd backend
# Set ADMIN_USERNAME and ADMIN_PASSWORD in your shell first.
# Password must be at least 12 characters; use a strong unique secret.
mvn spring-boot:run
```
Windows PowerShell:
```powershell
# From the nilspath-ai folder, after configuring .env:
powershell -ExecutionPolicy Bypass -File .\run-backend.ps1
```
Admin is created on first startup only when both environment variables are provided. Do not use example passwords in a real deployment.

## Start frontend
```bash
cd frontend
npm.cmd install
npm.cmd run dev
```
Open http://localhost:5173 for Candidate and HR access. Candidate can self-register. HR can register but needs Admin approval. Admin uses the separate http://localhost:5173/admin/login page with server-provisioned credentials; no admin registration is offered. All three workspaces have a sticky header Log out button. Admin logout returns to the admin login page, while Candidate and HR logout return to the public welcome page.

When serving the built frontend, configure SPA fallback to `index.html` so direct visits and refreshes at `/admin/login` work.

## What is implemented
- Spring Security HTTP Basic with bcrypt password hashes and role-based authorization
- Candidate and HR registration; Admin approval for HR
- Separate role dashboards and navigation
- Candidate job search and filters (city, type, skill, sample radius, match level)
- Candidate application form and application tracking
- Text-based skill matching against jobs, with Low / Medium / High labels
- HR job creation, listing closure, applications, shortlist/reject and interview scheduling
- Admin account lists, HR approval, job oversight and report counts
- Sample IT jobs and responsive dark-blue UI

## Important limitations / production checklist
- This is a runnable **starter**, not a fully audited production system. Company management, registration/job-posting settings, and HR resume screening are implemented.
- Resume analysis and HR screening use deterministic keyword matching, **not** an LLM or machine-learning model. Both support pasted text and PDF/DOCX uploads. HR screening only matches jobs owned by the signed-in HR account.
- Job radius uses sample distances stored with jobs, **not** real coordinates or map geocoding.
- Learning courses are suggestions, not connected to course providers.
- Basic credentials are held in React memory (not localStorage); refreshing logs out. For production, migrate to secure cookie-based sessions or short-lived tokens, HTTPS, CSRF protection where appropriate, rate limiting and account lockouts.
- Set CORS_ORIGIN to your actual frontend origin; configure TLS, secrets manager, audit logs, migrations (Flyway), backups, monitoring, and tests before public deployment.
- Production MySQL: set DB_URL=jdbc:mysql://host:3306/nilspath_ai, DB_USER and DB_PASSWORD. Use schema migrations rather than Hibernate ddl-auto=update.
- Sample seed jobs have no HR owner. They are visible to candidates and admin but not editable by HR.
- Never put passwords or credentials in source control. No default admin password is shipped.

## API endpoints
POST /api/auth/register, GET /api/auth/me, GET /api/jobs
POST /api/candidate/analyze, GET /api/candidate/applications, POST /api/candidate/jobs/{id}/apply
GET/POST /api/hr/jobs, PUT /api/hr/jobs/{id}/close, GET /api/hr/applications, PUT /api/hr/applications/{id}/status, POST /api/hr/applications/{id}/interviews
GET /api/admin/accounts, PUT /api/admin/hr/{id}/approve, GET /api/admin/jobs, PUT /api/admin/jobs/{id}/close, GET /api/admin/reports


## Resume upload and matching (upgrade)
Candidate Dashboard / Resume Analyzer now accepts PDF and DOCX uploads (5 MB, PDF max 30 pages), or pasted text. The Java Spring Boot API parses selectable PDF text with PDFBox and DOCX with Apache POI. It does **not** run OCR on scanned PDFs. Files and extracted text are processed in memory, not saved to the database. Endpoint: `POST /api/candidate/resume/upload` with multipart form field `file` and candidate Basic Auth. `POST /api/candidate/resume/match-text` accepts JSON `{ "resume": "..." }`. Both return per-job matched/missing skills, percent coverage, Low/Medium/High, and suggested skills to learn. This is deterministic explainable matching, **not a trained AI model** or a prediction of employment success.

### Deployment cautions
Use HTTPS, externalize secrets, add authentication rate limiting, malware scanning, file decompression limits, privacy/retention policies, audit logs, tests, and a proper session/token strategy before accepting real applicants. Do not expose HTTP Basic credentials over plain HTTP on a public server.


## MySQL 8.4 backend setup (new)

The backend now uses MySQL instead of H2/PostgreSQL. All accounts, jobs, applications and interviews are persisted through Spring Data JPA. Uploaded resume text is processed in memory, not saved.

1. Install **Java 17+**, **Maven 3.9+**, **Node.js 20+**, and Docker Desktop (or MySQL 8 manually).
2. Copy `.env.example` to `.env`, replace **all** example passwords, and run `docker compose up -d` from the project root. Docker exposes MySQL only to your local machine.
3. Set `DB_PASSWORD`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` in your backend terminal to match `.env`. In PowerShell:
   ```powershell
   $env:DB_PASSWORD='YOUR_MYSQL_PASSWORD'
   $env:ADMIN_USERNAME='admin'
   $env:ADMIN_PASSWORD='YOUR_LONG_UNIQUE_ADMIN_PASSWORD'
   cd backend
   mvn spring-boot:run
   ```
4. In another terminal: `cd frontend`, `npm install`, `npm run dev`. Visit http://localhost:5173.
5. To inspect records: `docker compose exec mysql mysql -u nilspath_app -p nilspath_ai` and then `SHOW TABLES;`.

For MySQL installed without Docker, create the `nilspath_ai` database and a least-privilege application user, then configure `DB_URL`, `DB_USER` and `DB_PASSWORD`. Local `ddl-auto=update` is intended **only for development**. Production profile uses `validate`; production requires version-controlled database migrations and a schema deployed in advance.

### Deployment security checklist

- Use HTTPS/TLS, restricted CORS origins, strong secrets from a secrets manager, database backups and a dedicated least-privilege database user.
- Replace HTTP Basic authentication with short-lived sessions or tokens plus CSRF protection before deploying a public web application.
- Add request rate limits, audit logs, structured validation, pagination and integration/security tests.
- This project is a development foundation, **not a production-certified system**.

## Bug fixes and management modules

- Signing out remounts the application, clearing resume text, uploads, results, filters, forms, and dashboard data. Pending responses from the old session cannot populate the new session.
- Recommendations show Medium/High matches in descending score order. Zero matches stays zero; before analysis, the dashboard prompts the candidate to analyze a resume.
- Candidate text, legacy analysis, file uploads, and HR screening share one scoring service and the same thresholds. Skill aliases and punctuation are handled consistently.
- Interview scheduling requires a future ISO date/time with a UTC offset. The browser sends UTC from a local date/time picker. Interview creation and application status update commit or roll back together. Candidates and HR can view scheduled interview times.
- Invalid/missing inputs receive structured validation errors. Duplicate/conflicting records receive HTTP 409.
- Admin can add, edit, and delete unused companies. Renaming updates existing job listings; companies with listings cannot be deleted.
- Admin settings persist in MySQL and control registration and new HR job posting. HR can screen pasted or uploaded resumes against its own jobs without storing the resumes.

New APIs: GET/POST /api/admin/companies, PUT/DELETE /api/admin/companies/{id}, GET/PUT /api/admin/settings, POST /api/hr/resume/upload, POST /api/hr/resume/match-text.

## Verification

Run `mvn.cmd test` from `backend` and `npm.cmd run build` from `frontend` on Windows. The backend suite uses isolated in-memory H2 databases, never the application's MySQL database. Tests cover matching, validation, permissions, company changes, settings enforcement, scheduling, and rollback after a database write failure.

Run `npm.cmd test` from `frontend` for regressions covering dynamic city/work-type filters, unrestricted distances, filtered HR empty states, closed-listing labels, and distinct save/reload outcomes. Resume analysis has explicit text/file modes that clear the other input and old results when switched. Application and interview forms use native modal dialogs to block background interaction and restore focus when closed.

The public homepage includes a platform overview, feature descriptions, Candidate/HR onboarding steps, and an explanation of keyword matching and resume handling. Job filters derive cities and work types from available jobs; an empty maximum-distance field includes every distance.

Candidate job cards mark existing applications as "Already applied". Application dialogs retain entered values and display failed-request errors inside the dialog. Login/registration and database mutations guard against repeated clicks while requests are pending. Applying for a job and closing it use the same database row lock so availability checks and application creation cannot race with closure; concurrent duplicate applications return a single successful application and a conflict response. The regression suite includes concurrent application/closure tests and request-retry checks.

DOCX extraction includes header, footer, paragraph and table text. Company records for seed or legacy jobs are backfilled during startup; listing companies is read-only and does not create or modify records.

Workspaces show a loading state until the complete data snapshot arrives. A failed load exposes a read-only retry flow instead of editable defaults, so existing settings cannot accidentally be overwritten before loading. Late responses are discarded when a newer load completes or the user signs out. Frontend regressions cover slow loads, retry after failure, stale results/errors, and cancellation on logout.

The shared job-search box opens the appropriate listing page for Candidate, HR or Admin and filters titles, companies, cities and skills. When simultaneous posts create the same company, the losing insert rolls back independently and reuses the committed company instead of failing the job post. Existing company names and metadata are preserved.

## Separate Candidate and HR usernames

Usernames are unique within each role. For example, Candidate `alex` and HR `alex` are separate accounts with independent passwords, approval flags, IDs and application/job ownership. HR registration does not create a Candidate account. A duplicate within the same role returns HTTP 409. HR approval is still required.

The UI automatically qualifies HTTP Basic login names as `CANDIDATE/alex`, `HR/alex` or `ADMIN/admin` according to the selected portal; users enter their usual username without the prefix. API clients must use the same role-qualified login name. Unqualified login names are rejected, even when currently unique. Authentication is stateless: every protected request must supply the selected role's credentials.

The browser first submits username, password and the selected role to `POST /api/auth/login`. Correct credentials for a pending HR account return HTTP 403 with `HR_APPROVAL_PENDING` and an explanation that Admin approval is required; incorrect credentials return a generic HTTP 401. Approval state is disclosed only after verifying the password. A pending HR account does not disable a separately registered Candidate account, and login never creates another role automatically.

Candidate access uses `/candidate/login` and `/candidate/register`; HR uses `/hr/login` and `/hr/register`. The pages have separate form handlers and state. Sign-in always calls `/api/auth/login`; only registration calls `/api/auth/register`. A duplicate-registration message is shown only on the registration page, beside a link to the corresponding sign-in page. Registration success is explicitly confirmed before continuing to sign-in. Admin continues to use `/admin/login` with no public registration page.

Registration labels full name, username, password and confirmation by role. Full name is a display value, never an authentication lookup. Usernames are looked up without case sensitivity within the selected role; passwords retain exact capitalization, spaces and symbols. The browser requires matching password confirmation and rejects unsupported lengths before making a request. API registration accepts an optional `confirmPassword` for compatibility with existing clients, validates it when provided, and rejects passwords beyond bcrypt's supported byte length. Sign-in shows only the role-specific username and password, with Show/Hide controls and role-specific autocomplete hints.

For an existing MySQL installation, stop the backend and run `scripts/MigrateRoleUsernames.java` with the MySQL JDBC connector on the Java classpath and `DB_URL`, `DB_USER`, `DB_PASSWORD` loaded from your environment. The idempotent migration adds the composite username/role constraint before removing username-only unique indexes, verifies the resulting indexes and account count, and does not alter account records. New databases receive the composite constraint from the entity mapping. Apply the equivalent schema migration before using the production `validate` profile.

The PowerShell launcher loads `.env` and supplies a short project-local socket temp directory to avoid Windows Unix-domain socket path limits. Start it from the project root with `powershell -ExecutionPolicy Bypass -File .\run-backend.ps1`.
