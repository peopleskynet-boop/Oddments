// A collection tied to work: links to a Jira task, a Confluence page, a Figma file (optional field `links: [{ url,
// title }]` of the collection), and the collection as text for Confluence or Jira — names, sources, tags, comments,
// screens — to paste into a page or a ticket. Pure: no DOM.
const plural = (n, f) => f[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2];

// what a link is, by its address: «PROJ-123» for a Jira issue, the page title for Confluence, the file for Figma
export function linkLabel(url) {
  let u;
  try { u = new URL(url); } catch (e) { return url; }
  const jira = url.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/) || url.match(/[?&]selectedIssue=([A-Z][A-Z0-9_]+-\d+)/);
  if (jira) return jira[1];
  if (/confluence|\/wiki\/|\/display\/|pageId=/.test(url)) {
    const t = decodeURIComponent((url.match(/\/pages\/\d+\/([^/?#]+)/) || url.match(/\/display\/[^/]+\/([^/?#]+)/) || [])[1] || '').replace(/\+/g, ' ');
    return t ? 'Confluence: ' + t : 'Страница Confluence';
  }
  if (/figma\.com/.test(u.hostname)) return 'Figma: ' + decodeURIComponent((u.pathname.split('/')[3] || 'файл').replace(/-/g, ' '));
  return u.hostname.replace(/^www\./, '');
}
export const linkKind = (url) => (/\/browse\/[A-Z]|selectedIssue=|jira/i.test(url) ? 'jira' : /confluence|\/wiki\/|\/display\/|pageId=/.test(url) ? 'confluence' : /figma\.com/.test(url) ? 'figma' : 'link');

// the collection as Markdown (Confluence's editor and Jira take it as it is): a header with its links, then a table
export function collectionMd(f, items) {
  const L = [`## ${f.name}`, ''];
  if (f.links && f.links.length) { L.push(f.links.map((l) => `[${l.title || linkLabel(l.url)}](${l.url})`).join(' · '), ''); }
  L.push(`${items.length} ${plural(items.length, ['файл', 'файла', 'файлов'])} из Oddments.`, '', '| Файл | Источник | Теги | Комментарии |', '|---|---|---|---|');
  const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
  for (const it of items) {
    const scr = it.scr ? [it.scr.app, it.scr.type].filter(Boolean).join(' · ') : '';
    const notes = (it.notes || []).map((n, i) => `${i + 1}. ${n.text}`).join(' ');
    L.push(`| ${cell(it.name)}${scr ? ` (${cell(scr)})` : ''} | ${it.url ? `[ссылка](${it.url})` : ''} | ${cell((it.tags || []).join(', '))} | ${cell(notes)} |`);
  }
  return L.join('\n') + '\n';
}
