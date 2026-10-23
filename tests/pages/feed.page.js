import { expect } from '@playwright/test';
import { BasePage } from './base.page.js';

// The design feed (reels)
export class FeedPage extends BasePage {
  constructor(page) {
    super(page);
    this.dialog = page.getByRole('dialog', { name: 'Лента' });
    this.reels = this.dialog.getByRole('article');
    this.topics = this.dialog.getByRole('tablist', { name: 'Темы' });
    this.counter = this.dialog.locator('.fd-count'); // «3 / 62»: plain text, no role
  }

  async open() {
    await (await this.sideRow('Лента')).click();
    await expect(this.dialog).toBeVisible();
    await expect(this.reels.first()).toBeVisible();
  }

  reel(i) { return this.reels.nth(i); }
}
