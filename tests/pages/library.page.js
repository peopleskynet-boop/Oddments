import { expect } from '@playwright/test';
import { BasePage } from './base.page.js';

// The main screen: search, the wall of files, the properties panel, the selection bar
export class LibraryPage extends BasePage {
  constructor(page) {
    super(page);
    this.files = page.getByRole('listbox', { name: 'Файлы' });
    this.cards = this.files.getByRole('option');
    this.search = page.getByPlaceholder(/Найти/);
    this.properties = page.getByRole('complementary', { name: 'Свойства файла' });
    this.selectionBar = page.getByRole('toolbar', { name: 'Действия с выделенными' });
    this.settingsButton = page.getByRole('button', { name: 'Настройки' }).first();
    this.aiChip = page.locator('#aiChip'); // inside the search <label>: its name is the state, it changes on purpose
  }

  async goto(query = '') {
    await this.navigate('/' + query);
    if (!query.includes('empty')) await expect(this.cards.first()).toBeVisible();
  }

  card(name) {
    return this.files.getByRole('option', { name: new RegExp('^' + name + ',') });
  }

  async searchFor(text) {
    await this.search.fill(text);
  }

  async select(...names) {
    await this.card(names[0]).click();
    for (const n of names.slice(1)) await this.card(n).click({ modifiers: ['Control'] });
  }

  async visibleNames() {
    return this.cards.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').split(',')[0]));
  }
}
