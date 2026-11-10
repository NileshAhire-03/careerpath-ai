export function jobFilterOptions(jobs) {
  const unique = key => [...new Set(jobs.map(job => job[key]?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { cities: unique('city'), types: unique('type') };
}

export function filterJobs(jobs, { search = '', city = 'All', type = 'All', distance = '', skill = '', level = 'All', matches = [] } = {}) {
  return jobs.filter(job =>
    [job.title, job.company, job.city, job.skills].join(' ').toLowerCase().includes(search.toLowerCase()) &&
    (city === 'All' || job.city?.trim() === city) &&
    (type === 'All' || job.type?.trim() === type) &&
    (distance === '' || (typeof job.distanceKm === 'number' && Number.isFinite(job.distanceKm) && job.distanceKm >= 0 && job.distanceKm <= Number(distance))) &&
    (!skill || job.skills?.toLowerCase().includes(skill.toLowerCase())) &&
    (level === 'All' || matches.some(match => match.jobId === job.id && match.level === level.toUpperCase()))
  );
}

export function filterApplications(applications, page) {
  if (page === 'Shortlist Candidates') return applications.filter(application => application.status === 'SHORTLISTED');
  if (page === 'Schedule Interviews') return applications.filter(application => ['SHORTLISTED', 'INTERVIEW'].includes(application.status));
  return applications;
}

export function applicationEmptyMessage(page) {
  if (page === 'Shortlist Candidates') return 'No shortlisted candidates yet.';
  if (page === 'Schedule Interviews') return 'No shortlisted candidates or scheduled interviews yet.';
  return 'No candidate applications yet. Post a job and wait for applications.';
}

export function jobBadge(job, matches) {
  if (!job.active) return 'CLOSED';
  return matches.find(match => match.jobId === job.id)?.level || 'OPEN';
}

export function hasApplied(jobId, applications) {
  return applications.some(application => application.jobId === jobId);
}

export function basicAuthToken(role, username, password) {
  const bytes = new TextEncoder().encode(role + '/' + username + ':' + password);
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
}

export function accessPath(role, mode = 'login') {
  if (!['CANDIDATE', 'HR', 'ADMIN'].includes(role) || !['login', 'register'].includes(mode) || (role === 'ADMIN' && mode === 'register'))
    throw new Error('Invalid account access page.');
  return '/' + role.toLowerCase() + '/' + mode;
}

export function getAccessPage(pathname) {
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  for (const role of ['CANDIDATE', 'HR', 'ADMIN']) {
    if (path === accessPath(role, 'login') || (role === 'ADMIN' && path === '/admin'))
      return { screen: 'login', role, mode: 'login' };
    if (role !== 'ADMIN' && path === accessPath(role, 'register'))
      return { screen: 'login', role, mode: 'register' };
  }
  return { screen: 'welcome', role: 'CANDIDATE', mode: 'login' };
}

export function loginPayload(role, username, password) {
  if (!['CANDIDATE', 'HR', 'ADMIN'].includes(role)) throw new Error('Choose a valid workspace.');
  if (!username.trim() || !password) throw new Error('Enter your username and password.');
  // A password is exact, including spaces, symbols and capitalization.
  return { role, username: username.trim(), password };
}

export function registrationPayload(role, values) {
  if (!['CANDIDATE', 'HR'].includes(role)) throw new Error('Admin accounts are provisioned separately.');
  if (!values.fullName.trim()) throw new Error('Enter your full name.');
  const input = loginPayload(role, values.username, values.password);
  if (input.username.length > 100 || !/^[A-Za-z0-9_.@-]+$/.test(input.username))
    throw new Error('Username can contain letters, numbers, dots, underscores, @ and hyphens (up to 100 characters).');
  if (values.password.length < 8) throw new Error('Use a password with at least 8 characters.');
  if (new TextEncoder().encode(values.password).length > 72) throw new Error('Password is too long. Please use a shorter password.');
  if (values.password !== values.confirmPassword) throw new Error('Passwords do not match. Re-enter the confirmation password.');
  return { ...input, fullName: values.fullName.trim(), confirmPassword: values.confirmPassword };
}

// Repeated clicks share the in-flight request rather than issuing another write.
// Clear the guard on either outcome so a failed request can be retried.
export function createSubmissionGuard() {
  let pending = null;
  return operation => {
    if (pending) return pending;
    const request = Promise.resolve().then(operation);
    pending = request;
    const clear = () => { if (pending === request) pending = null; };
    request.then(clear, clear);
    return request;
  };
}

// Publish complete snapshots only. A previous request (or previous session)
// must never replace a newer result, including when it fails late.
export function createWorkspaceLoader(publish) {
  let revision = 0;
  let status = 'idle';
  return {
    getStatus: () => status,
    cancel() { revision++; status = 'idle'; },
    async load(read) {
      const request = ++revision;
      status = 'loading';
      publish({ status });
      try {
        const data = await read();
        if (request !== revision) return false;
        status = 'ready';
        publish({ status, data });
        return true;
      } catch (error) {
        if (request !== revision) return false;
        status = 'error';
        publish({ status, error });
        throw error;
      }
    }
  };
}

// A successful write and a successful reload are distinct outcomes. Never ask
// the user to repeat a write merely because the following read failed.
export async function saveAndRefresh(save, refresh) {
  await save();
  try {
    await refresh();
    return { refreshed: true };
  } catch (error) {
    return { refreshed: false, error };
  }
}
