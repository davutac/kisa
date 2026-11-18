// Subframes in Kisa's windows exist only to display message HTML from `srcdoc`.
// Any other destination was chosen by a message, so main refuses it even if the
// renderer's link handling and page policy were bypassed.
const FRAME_DOCUMENT_URLS = new Set(["about:blank", "about:srcdoc"]);

export const isAllowedSubframeNavigation = (url: string): boolean =>
  FRAME_DOCUMENT_URLS.has(url);
