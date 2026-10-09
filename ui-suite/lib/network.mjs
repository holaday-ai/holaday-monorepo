// A new popup navigation can arrive before Playwright has a Frame object.
// It is still fulfilled locally; popup URL assertions remain in observeControl.
export function isPopupNavigation(request, mainPage) {
  if (!request.isNavigationRequest()) return false;
  try {
    return request.frame().page() !== mainPage;
  } catch (error) {
    if (String(error.message).includes('Frame for this navigation request')) return true;
    throw error;
  }
}

// Kept narrow to the explicitly default-off editor contract.
export function isExpectedDisabledEditorFailure(scenario, url, status) {
  if (scenario !== '/video/edit/:projectId' || status !== 403) return false;
  try {
    return new URL(url).pathname === '/api/trpc/videoEditing.getProject';
  } catch {
    return false;
  }
}

export function isExpectedDisabledEditorConsole(scenario, url, message) {
  return (
    /^Failed to load resource: the server responded with a status of 403\b/.test(message) &&
    isExpectedDisabledEditorFailure(scenario, url, 403)
  );
}
