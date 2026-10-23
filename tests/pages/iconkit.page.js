import { expect } from '@playwright/test';
import { BasePage } from './base.page.js';

// The icon constructor (Figma-like editor for icons)
export class IconKitPage extends BasePage {
  constructor(page) {
    super(page);
    this.dialog = page.getByRole('dialog', { name: 'Конструктор иконок' });
    this.canvas = this.dialog.getByLabel('Холст');
    this.layers = this.dialog.getByRole('complementary', { name: 'Слои' });
    this.tools = this.dialog.getByRole('toolbar', { name: 'Инструменты' });
  }

  async open() {
    await this.page.keyboard.press('Control+Space');
    await this.page.getByRole('combobox').fill('Конструктор иконок');
    await this.page.keyboard.press('Enter');
    await expect(this.dialog).toBeVisible();
  }

  // drag a shape on the canvas from one fraction of it to another
  async drawWith(key, from = [0.4, 0.4], to = [0.6, 0.6]) {
    await this.page.keyboard.press(key);
    const b = await this.canvas.boundingBox();
    await this.page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1]);
    await this.page.mouse.down();
    await this.page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps: 8 });
    await this.page.mouse.up();
  }
}
