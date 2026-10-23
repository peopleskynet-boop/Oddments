import { expect } from '@playwright/test';
import { BasePage } from './base.page.js';

// «Новости»: the daily digest, saved articles and the reader
export class NewsPage extends BasePage {
  constructor(page) {
    super(page);
    this.dialog = page.getByRole('dialog', { name: 'Новости' });
    this.tabs = this.dialog.getByRole('tablist', { name: 'Разделы новостей' });
    this.back = this.dialog.getByRole('button', { name: 'Назад к списку' });
  }

  async open(row) {
    await (await this.sideRow(row)).click();
    await expect(this.dialog).toBeVisible();
  }

  tab(name) { return this.tabs.getByRole('tab', { name }); }
}

// no internet in tests: real sites are blocked, the browser build's demo feeds and pages answer instead;
// Claude is answered by `claude` when given
export async function offline(page, claude) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
    if (claude && route.request().url().startsWith('https://api.anthropic.com/')) return route.fulfill({ json: claude(route.request().postDataJSON()) });
    return route.abort();
  });
}
