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
