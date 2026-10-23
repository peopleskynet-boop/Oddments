import { test, expect } from '../../fixtures/perch.fixture.js';

test.describe('Контекстное меню и корзина', () => {
  test('правый клик по карточке — меню действий с файлом', async ({ page, library }) => {
    await library.cards.first().click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Действия с файлом' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Просмотр/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /В корзину/ })).toBeVisible();
  });

  test('Esc закрывает меню', async ({ page, library }) => {
    await library.cards.first().click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Действия с файлом' });
    await expect(menu).toBeVisible();
    await library.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('«В корзину» убирает файл, «Отменить» возвращает', async ({ page, library }) => {
    const card = library.cards.first();
    const name = (await card.getAttribute('aria-label')).split(',')[0];
    await card.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /В корзину/ }).click();
    await expect(library.card(name)).toHaveCount(0);
    await library.toasts.getByRole('button', { name: 'Отменить' }).click();
    await expect(library.card(name)).toBeVisible();
  });

  test('Delete отправляет выделенное в корзину', async ({ library }) => {
    const card = library.cards.nth(2);
    const name = (await card.getAttribute('aria-label')).split(',')[0];
    await card.click();
    await library.press('Delete');
    await expect(library.card(name)).toHaveCount(0);
    await expect(library.toasts).toContainText('В корзину: 1');
  });
});
