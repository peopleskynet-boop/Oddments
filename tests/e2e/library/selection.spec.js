import { test, expect } from '../../fixtures/perch.fixture.js';

test.describe('Выделение файлов', () => {
  test('клик выделяет файл и открывает панель свойств', async ({ library }) => {
    const first = library.cards.first();
    await first.click();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(library.properties).toBeVisible();
    await expect(library.selectionBar).toBeHidden(); // one file has the properties panel instead
  });

  test('два файла — плашка действий над выделенным', async ({ library }) => {
    await library.cards.nth(0).click();
    await library.cards.nth(1).click({ modifiers: ['Control'] });
    await expect(library.selectionBar).toBeVisible();
    await expect(library.selectionBar).toContainText('2 выбрано');
  });

  test('«В избранное» с плашки ставит сердечко обоим', async ({ library }) => {
    const a = library.cards.nth(0), b = library.cards.nth(1);
    await a.click();
    await b.click({ modifiers: ['Control'] });
    const fav = library.selectionBar.getByRole('button', { name: /избранн/ });
    await fav.click();
    await expect(a).toHaveAttribute('aria-label', /в избранном/);
    await expect(b).toHaveAttribute('aria-label', /в избранном/);
  });

  test('Esc снимает выделение и прячет плашку', async ({ library }) => {
    await library.cards.nth(0).click();
    await library.cards.nth(1).click({ modifiers: ['Control'] });
    await expect(library.selectionBar).toBeVisible();
    await library.press('Escape');
    await expect(library.files.getByRole('option', { selected: true })).toHaveCount(0);
    await expect(library.selectionBar).toBeHidden();
  });

  test('Ctrl+A выделяет всё', async ({ library }) => {
    await library.cards.first().click();
    await library.press('Control+a');
    await expect(library.selectionBar).toContainText(/\d+ выбрано/);
  });
});
