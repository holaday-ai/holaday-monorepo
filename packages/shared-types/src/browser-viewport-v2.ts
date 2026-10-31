/** Pixel observations are scoped to one transport connection and one tab. */
export interface BrowserFrameGeometry {
  frameId: string;
  tabId: string;
  viewportRevision: number;
  cssWidth: number;
  cssHeight: number;
  imageWidth: number;
  imageHeight: number;
  pageScaleFactor: number;
  offsetTop: number;
  scrollOffset: { x: number; y: number };
  capturedAt: number;
}
export type BrowserFrameReference = Pick<
  BrowserFrameGeometry,
  'frameId' | 'tabId' | 'viewportRevision'
>;
export interface BrowserActionRequest {
  taskId: string;
  runId: string;
  actor: 'human' | 'agent';
  lane: 'cdp' | 'vnc';
  tabId: string;
  origin: string;
  observationRevision: number;
  /** Server-derived digest of the action AND exact target object. */
  actionDigest: string;
  lease: string;
}
export type BrowserActionDecision =
  | { kind: 'allow'; sensitive: boolean }
  | { kind: 'deny' | 'awaiting_user'; reason: string };
