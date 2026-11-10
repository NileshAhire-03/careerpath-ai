import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobFilterOptions, filterJobs, filterApplications, applicationEmptyMessage, jobBadge, saveAndRefresh, hasApplied, createSubmissionGuard, createWorkspaceLoader, basicAuthToken, accessPath, getAccessPage, loginPayload, registrationPayload } from './workspace.js';

const jobs = [
  { id: 1, title: 'Developer', company: 'One', city: 'Bengaluru', type: 'Contract', distanceKm: 175, skills: 'java', active: true },
  { id: 2, title: 'Designer', company: 'Two', city: 'Pune', type: 'Remote', distanceKm: 25, skills: 'css', active: false },
  { id: 3, title: 'Engineer', company: 'Three', city: ' Bengaluru ', type: 'Contract', distanceKm: 1200, skills: 'sql', active: true }
];

test('distance limits exclude unknown and invalid distances while retaining zero', () => {
  const entries = [null, undefined, '', -1, NaN, Infinity, 0, 10].map((distanceKm, id) => ({ id, distanceKm }));
  assert.equal(filterJobs(entries).length, entries.length);
  assert.deepEqual(filterJobs(entries, { distance: 10 }).map(job => job.id), [6, 7]);
  assert.deepEqual(filterJobs(entries, { distance: 0 }).map(job => job.id), [6]);
});

test('filters include all distances by default and support any supplied city and type', () => {
  assert.deepEqual(jobFilterOptions(jobs), { cities: ['Bengaluru', 'Pune'], types: ['Contract', 'Remote'] });
  assert.equal(filterJobs(jobs).length, 3);
  assert.deepEqual(filterJobs(jobs, { city: 'Bengaluru', type: 'Contract' }).map(job => job.id), [1, 3]);
  assert.deepEqual(filterJobs(jobs, { distance: 200 }).map(job => job.id), [1, 2]);
  assert.equal(filterJobs(jobs, { distance: 0 }).length, 0);
  assert.deepEqual(filterJobs(jobs, { search: 'bengaluru' }).map(job => job.id), [1, 3]);
});

test('empty HR lists use the displayed subset even when applications exist', () => {
  const applications = [{ id: 1, status: 'APPLIED' }, { id: 2, status: 'REJECTED' }];
  assert.equal(filterApplications(applications, 'Shortlist Candidates').length, 0);
  assert.equal(filterApplications(applications, 'Schedule Interviews').length, 0);
  assert.match(applicationEmptyMessage('Shortlist Candidates'), /No shortlisted/);
  assert.match(applicationEmptyMessage('Schedule Interviews'), /No shortlisted/);
  assert.deepEqual(filterApplications(applications, 'View Candidates'), applications);
  assert.equal(filterApplications([...applications, { status: 'INTERVIEW' }], 'Schedule Interviews').length, 1);
});

test('closed status takes precedence over cached match scores and OPEN fallback', () => {
  assert.equal(jobBadge(jobs[1], []), 'CLOSED');
  assert.equal(jobBadge(jobs[1], [{ jobId: 2, level: 'HIGH' }]), 'CLOSED');
  assert.equal(jobBadge(jobs[0], []), 'OPEN');
  assert.equal(jobBadge(jobs[0], [{ jobId: 1, level: 'HIGH' }]), 'HIGH');
});

test('save failure propagates without reloading or reporting success', async () => {
  let reloaded = false;
  await assert.rejects(saveAndRefresh(async () => { throw new Error('Write failed'); }, async () => { reloaded = true; }), /Write failed/);
  assert.equal(reloaded, false);
});

test('reload failure preserves the saved outcome without success or a second write', async () => {
  let writes = 0;
  const result = await saveAndRefresh(async () => { writes++; }, async () => { throw new Error('Read failed'); });
  assert.equal(result.refreshed, false);
  assert.equal(result.error.message, 'Read failed');
  assert.equal(writes, 1);
});

test('success waits for both write and reload', async () => {
  const order = [];
  const result = await saveAndRefresh(async () => { order.push('write'); }, async () => { order.push('reload'); });
  assert.deepEqual(order, ['write', 'reload']);
  assert.equal(result.refreshed, true);
});

test('existing applications prevent reapplying regardless of recruitment status', () => {
  for (const status of ['APPLIED', 'SHORTLISTED', 'REJECTED', 'INTERVIEW']) {
    assert.equal(hasApplied(1, [{ jobId: 1, status }]), true);
    assert.equal(hasApplied(2, [{ jobId: 1, status }]), false);
  }
  assert.equal(hasApplied(1, []), false);
});

test('rapid submissions share one write and allow a later write after completion', async () => {
  const submit = createSubmissionGuard();
  let finish, calls = 0;
  const wait = new Promise(resolve => { finish = resolve; });
  const first = submit(async () => { calls++; await wait; return 'saved'; });
  const repeated = submit(async () => { calls++; return 'duplicate'; });
  assert.equal(first, repeated);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish();
  assert.equal(await repeated, 'saved');
  assert.equal(await submit(async () => { calls++; return 'next'; }), 'next');
  assert.equal(calls, 2);
});

test('failed submissions can be retried and do not leave the guard locked', async () => {
  const submit = createSubmissionGuard();
  await assert.rejects(submit(() => { throw new Error('Save failed'); }), /Save failed/);
  assert.equal(await submit(async () => 'retry saved'), 'retry saved');
});

test('workspace stays unavailable until the complete snapshot has loaded', async () => {
  const events = [];
  const loader = createWorkspaceLoader(state => events.push(state));
  let finishSettings;
  const settings = new Promise(resolve => { finishSettings = resolve; });
  const loading = loader.load(() => Promise.all([Promise.resolve(['job']), settings]));
  await Promise.resolve();
  assert.equal(loader.getStatus(), 'loading');
  assert.equal(events.some(state => state.data), false);
  finishSettings({ registrationAllowed: false, jobPostingAllowed: false });
  await loading;
  assert.equal(loader.getStatus(), 'ready');
  assert.equal(events.at(-1).data[1].registrationAllowed, false);
});

test('failed initial loads expose an error and can retry reads without resubmitting writes', async () => {
  const events = [];
  const loader = createWorkspaceLoader(state => events.push(state));
  let writes = 0, reads = 0;
  const save = () => { writes++; };
  await assert.rejects(loader.load(async () => { reads++; throw new Error('Unavailable'); }), /Unavailable/);
  assert.equal(loader.getStatus(), 'error');
  assert.equal(events.some(state => state.data), false);
  assert.equal(writes, 0);
  await loader.load(async () => { reads++; return { registrationAllowed: false }; });
  assert.equal(loader.getStatus(), 'ready');
  assert.equal(reads, 2);
  assert.equal(writes, 0);
  // A write is allowed by the caller only after the ready snapshot exists.
  if (loader.getStatus() === 'ready') save();
  assert.equal(writes, 1);
});

test('late results and errors cannot overwrite a newer workspace snapshot', async () => {
  const events = [];
  const loader = createWorkspaceLoader(state => events.push(state));
  let oldSuccess, oldFailure;
  const first = loader.load(() => new Promise(resolve => { oldSuccess = resolve; }));
  const second = loader.load(() => new Promise((resolve, reject) => { oldFailure = reject; }));
  await loader.load(async () => ({ version: 3 }));
  oldSuccess({ version: 1 });
  oldFailure(new Error('Old request failed'));
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(loader.getStatus(), 'ready');
  assert.deepEqual(events.at(-1), { status: 'ready', data: { version: 3 } });
});

test('cancelled sessions cannot publish pending workspace data', async () => {
  const events = [];
  const loader = createWorkspaceLoader(state => events.push(state));
  let finish;
  const loading = loader.load(() => new Promise(resolve => { finish = resolve; }));
  loader.cancel();
  finish({ privateCandidateData: 'old session' });
  assert.equal(await loading, false);
  assert.equal(events.some(state => state.data), false);
  assert.equal(loader.getStatus(), 'idle');
});

test('the selected portal qualifies shared usernames without changing the visible username', () => {
  const decode = token => Buffer.from(token, 'base64').toString('utf8');
  assert.equal(decode(basicAuthToken('CANDIDATE', 'shared.name', 'Password@123')), 'CANDIDATE/shared.name:Password@123');
  assert.equal(decode(basicAuthToken('HR', 'shared.name', 'Password@123')), 'HR/shared.name:Password@123');
  assert.equal(decode(basicAuthToken('ADMIN', 'admin', 'TestOnly@2026!')), 'ADMIN/admin:TestOnly@2026!');
  assert.notEqual(basicAuthToken('HR', 'shared.name', 'Password@123'), basicAuthToken('CANDIDATE', 'shared.name', 'Password@123'));
});

test('role-qualified basic authentication preserves Unicode passwords and colons', () => {
  assert.equal(Buffer.from(basicAuthToken('CANDIDATE', 'candidate', 'pässword:123'), 'base64').toString('utf8'), 'CANDIDATE/candidate:pässword:123');
});

test('sign-in and registration are distinct pages for each public role', () => {
  for (const role of ['CANDIDATE', 'HR']) {
    assert.notEqual(accessPath(role, 'login'), accessPath(role, 'register'));
    assert.deepEqual(getAccessPage(accessPath(role, 'login')), { screen: 'login', role, mode: 'login' });
    assert.deepEqual(getAccessPage(accessPath(role, 'register')), { screen: 'login', role, mode: 'register' });
    assert.equal(getAccessPage(accessPath(role, 'login') + '/').mode, 'login');
  }
});

test('switching portals cannot carry registration state into another sign-in page', () => {
  assert.equal(getAccessPage('/hr/register').mode, 'register');
  assert.deepEqual(getAccessPage('/candidate/login'), { screen: 'login', role: 'CANDIDATE', mode: 'login' });
  assert.equal(getAccessPage('/candidate/register').mode, 'register');
  assert.deepEqual(getAccessPage('/hr/login'), { screen: 'login', role: 'HR', mode: 'login' });
});

test('admin keeps separate sign-in and has no public registration route', () => {
  assert.deepEqual(getAccessPage('/admin/login'), { screen: 'login', role: 'ADMIN', mode: 'login' });
  assert.deepEqual(getAccessPage('/admin'), getAccessPage('/admin/login'));
  assert.throws(() => accessPath('ADMIN', 'register'), /Invalid/);
  assert.equal(getAccessPage('/admin/register').screen, 'welcome');
});

test('login uses the selected role and username, never a display name, and preserves the exact password', () => {
  for (const role of ['CANDIDATE', 'HR', 'ADMIN']) {
    assert.deepEqual(loginPayload(role, ' Nilesh@701 ', ' Exact:Password '), { role, username: 'Nilesh@701', password: ' Exact:Password ' });
    assert.equal(Object.hasOwn(loginPayload(role, 'Nilesh@701', 'password'), 'fullName'), false);
  }
});

test('registration keeps names separate from usernames and requires matching passwords', () => {
  const values = { fullName: ' Nilesh Example ', username: ' Nilesh@701 ', password: 'Exact:Pass ', confirmPassword: 'Exact:Pass ' };
  assert.deepEqual(registrationPayload('CANDIDATE', values), { role: 'CANDIDATE', fullName: 'Nilesh Example', username: 'Nilesh@701', password: 'Exact:Pass ', confirmPassword: 'Exact:Pass ' });
  assert.equal(registrationPayload('HR', values).role, 'HR');
  assert.throws(() => registrationPayload('HR', { ...values, confirmPassword: 'Exact:Pass' }), /do not match/);
  assert.throws(() => registrationPayload('ADMIN', values), /provisioned separately/);
});

test('registration rejects short or unsupported password lengths before sending a request', () => {
  const values = { fullName: 'Example Name', username: 'example', password: 'short', confirmPassword: 'short' };
  assert.throws(() => registrationPayload('CANDIDATE', values), /at least 8/);
  assert.throws(() => registrationPayload('HR', { ...values, password: '界'.repeat(25), confirmPassword: '界'.repeat(25) }), /too long/);
});
