// Tracks, per browser tab, whether the onboarding-wizard landing check
// (Dashboard's "/" dispatcher) has already run for the current login --
// so navigating back to "/" mid-session doesn't re-trigger it. Keyed per
// account so switching users on the same tab doesn't reuse someone
// else's flag, and cleared explicitly on every real sign-in (see App.tsx)
// so logging out and back in re-evaluates it, matching "every_login".
function wizardLandingSessionKey(userId: string) {
  return `barburg:onboardingWizardChecked:${userId}`
}

export function hasCheckedWizardLandingThisSession(userId: string): boolean {
  try {
    return sessionStorage.getItem(wizardLandingSessionKey(userId)) === '1'
  } catch {
    return false
  }
}

export function markWizardLandingChecked(userId: string): void {
  try {
    sessionStorage.setItem(wizardLandingSessionKey(userId), '1')
  } catch {
    // Private-browsing or storage-disabled -- worst case the check just
    // re-runs on the next visit to "/", which is harmless.
  }
}

export function clearWizardLandingSession(userId: string): void {
  try {
    sessionStorage.removeItem(wizardLandingSessionKey(userId))
  } catch {
    // ignore
  }
}
