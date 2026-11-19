import {
  login,
  signup,
  getUser,
  refreshSession,
  logout,
} from "@netlify/identity";
let checking;
export function sessionReady() {
  if (!checking)
    checking = (async () => {
      await refreshSession();
      return getUser();
    })().finally(() => {
      checking = null;
    });
  return checking;
}
export async function signIn(email, password) {
  return login(email.trim(), password);
}
export async function signOut() {
  return logout();
}
export async function registerIdentity(input) {
  // A verified email can hold separate Candidate and HR profiles. Identity owns credentials.
  try {
    await signup(input.email.trim(), input.password, {
      full_name: input.fullName,
      username: input.username,
      workspace: input.role,
    });
  } catch (error) {
    try {
      await login(input.email.trim(), input.password);
    } catch {
      throw error;
    }
  }
  const user = await sessionReady();
  if (user && user.email?.toLowerCase() !== input.email.trim().toLowerCase()) {
    await logout();
    return null;
  }
  return user;
}
