// The common part of every Oddments screen in the browser build
export class BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.toasts = page.locator('#toast'); // role=status region of the toast stack
  }

  async navigate(path = '/') {
    await this.page.goto(path);
  }

  // «Новости» and «Инструменты» in the left panel fold away (closed by default): open the group before its row
  async sideRow(name, group = 'Новости') {
    const row = this.page.getByRole('button', { name: new RegExp('^' + name) }).first();
    if (!(await row.isVisible())) {
      const g = this.page.locator(`.grp.fold`, { hasText: group });
      if ((await g.getAttribute('aria-expanded')) !== 'true') await g.click();
    }
    return row;
  }

  async press(keys) {
    await this.page.keyboard.press(keys);
  }
}
