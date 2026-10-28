// A collection's links to Jira, Confluence, Figma and its text for a page (src/lib/worklinks.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { linkLabel, linkKind, collectionMd } from '../../src/lib/worklinks.js';

test('links are named by what they are', () => {
  assert.equal(linkLabel('https://jira.example.com/browse/DES-4512'), 'DES-4512');
  assert.equal(linkKind('https://jira.example.com/browse/DES-4512'), 'jira');
  assert.equal(linkLabel('https://wiki.example.com/display/DES/Онбординг+кредитки'), 'Confluence: Онбординг кредитки');
  assert.equal(linkKind('https://x.atlassian.net/wiki/spaces/D/pages/123/Title'), 'confluence');
  assert.equal(linkLabel('https://www.figma.com/design/AbC123/Банк-приложение?node-id=1'), 'Figma: Банк приложение');
  assert.equal(linkLabel('https://dribbble.com/shots/1'), 'dribbble.com');
});

test('a collection as Markdown: links, a table, pipes escaped', () => {
  const md = collectionMd({ name: 'Перевод', links: [{ url: 'https://jira.example.com/browse/DES-1' }] }, [
    { name: 'a|b.png', url: 'https://x.com/1', tags: ['конкуренты'], scr: { app: 'Т-Банк', type: 'Перевод' }, notes: [{ text: 'отступ' }] },
  ]);
  assert.match(md, /\[DES-1\]\(https:\/\/jira\.example\.com\/browse\/DES-1\)/);
  assert.match(md, /\| a\\\|b\.png \(Т-Банк · Перевод\) \| \[ссылка\]\(https:\/\/x\.com\/1\) \| конкуренты \| 1\. отступ \|/);
});
