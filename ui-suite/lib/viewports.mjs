export const DEFAULT_VIEWPORTS = [
  { width: 1440, height: 960 },
  { width: 1280, height: 960 },
  { width: 1024, height: 960 },
  { width: 1200, height: 1000 },
  { width: 1366, height: 768 },
];
export function auditViewports(env) {
  if (env.UI_AUDIT_VIEWPORTS && env.UI_AUDIT_WIDTHS) throw Error('CONFLICTING_VIEWPORT_FILTERS');
  const viewports = env.UI_AUDIT_VIEWPORTS
    ? JSON.parse(env.UI_AUDIT_VIEWPORTS)
    : env.UI_AUDIT_WIDTHS
      ? JSON.parse(env.UI_AUDIT_WIDTHS).map((width) => ({ width, height: 960 }))
      : DEFAULT_VIEWPORTS.map((viewport) => ({ ...viewport }));
  if (
    !Array.isArray(viewports) ||
    !viewports.length ||
    viewports.some(
      (v) =>
        !Number.isInteger(v.width) ||
        !Number.isInteger(v.height) ||
        v.width < 320 ||
        v.width > 3840 ||
        v.height < 320 ||
        v.height > 2160,
    )
  )
    throw Error('UNSUPPORTED_VIEWPORT');
  if (new Set(viewports.map((v) => `${v.width}x${v.height}`)).size !== viewports.length)
    throw Error('DUPLICATE_VIEWPORT');
  return viewports;
}
