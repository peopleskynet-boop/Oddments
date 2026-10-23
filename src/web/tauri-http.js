// @tauri-apps/plugin-http for the browser build: plain fetch (subject to CORS).
// Forbidden headers such as Referer are dropped so the browser does not reject the request.
// The design feed's RSS cannot be read from a web page (CORS): those requests get demo feeds (feeddemo.js).
// Pages asked for as HTML (saved articles) get a demo article the same way.
import { demoFeed, demoArticle, demoTelegram } from './feeddemo.js';
export async function fetch(url, init = {}) {
  const { headers = {}, ...rest } = init;
  const h = { ...headers };
  delete h.Referer; delete h['User-Agent'];
  const accept = String(headers.Accept || '');
  const demo = !/^(data|blob):/.test(String(url)) && (/xml/.test(accept) || /^text\/html/.test(accept)) && (!init.method || init.method === 'GET');
  if (demo) {
    try { return await window.fetch(url, { ...rest, headers: h }); } catch (e) {
      if (/t\.me\/s\//.test(String(url))) return new Response(demoTelegram(String(url)), { status: 200, headers: { 'content-type': 'text/html' } });
      return /^text\/html/.test(accept)
        ? new Response(demoArticle(String(url)), { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response(demoFeed(String(url)), { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    }
  }
  return window.fetch(url, { ...rest, headers: h });
}
