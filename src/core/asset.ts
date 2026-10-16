// Asset URLs are written root-relative ("/assets/…"); resolve them against the
// deploy base so the game also works from a sub-path (e.g. GitHub Pages).
export const assetUrl = (url: string) => (url.startsWith('/') ? import.meta.env.BASE_URL + url.slice(1) : url);
