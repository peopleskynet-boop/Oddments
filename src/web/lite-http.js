// @tauri-apps/plugin-http for Oddments Web: the browser's fetch. Other sites answer only if they allow it (CORS) — the
// link covers of YouTube and Vimeo (oEmbed) do, most pages do not; a picture is added by Ctrl+V or dragging the file.
// Headers the browser forbids a page to set (Referer, User-Agent) are dropped, or the request is refused whole.
export async function fetch(url, init = {}) {
  const { headers = {}, ...rest } = init;
  const h = { ...headers };
  delete h.Referer; delete h.referer; delete h['User-Agent']; delete h['user-agent'];
  return window.fetch(url, { ...rest, headers: h });
}
