import { test, expect } from '../../fixtures/perch.fixture.js';
import { PreviewPage } from '../../pages/preview.page.js';

test.describe('Просмотр файла', () => {
  /** @type {PreviewPage} */ let pv;
  test.beforeEach(async ({ page }) => { pv = new PreviewPage(page); });

  test('Пробел открывает выделенный файл, Esc закрывает', async ({ library }) => {
    const card = library.cards.first();
    const name = (await card.getAttribute('aria-label')).split(',')[0];
    await card.click();
    await library.press('Space');
    await expect(pv.dialog).toBeVisible();
    await expect(pv.title).toContainText(name);
    await library.press('Escape');
    await expect(pv.dialog).toBeHidden();
  });

  test('двойной клик открывает просмотр', async ({ library }) => {
    await library.cards.nth(1).dblclick();
    await expect(pv.dialog).toBeVisible();
  });

  test('стрелка вправо листает к следующему файлу', async ({ library }) => {
    await library.cards.first().click();
    await library.press('Space');
    const first = await pv.title.textContent();
    await library.press('ArrowRight');
    await expect(pv.title).not.toHaveText(first);
  });

  test('крестик закрывает просмотр', async ({ library }) => {
    await library.cards.first().dblclick();
    await pv.close.click();
    await expect(pv.dialog).toBeHidden();
  });
});
