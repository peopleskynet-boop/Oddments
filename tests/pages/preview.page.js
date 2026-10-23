import { BasePage } from './base.page.js';

// The full-screen preview of one file
export class PreviewPage extends BasePage {
  constructor(page) {
    super(page);
    this.dialog = page.locator('#pv'); // role=dialog, named by its title
    this.title = page.locator('#pvT');
    this.close = this.dialog.getByRole('button', { name: 'Закрыть' }).first();
  }
}
