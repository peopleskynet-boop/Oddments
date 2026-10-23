import { test, expect } from '../../fixtures/perch.fixture.js';
import { LibraryPage } from '../../pages/library.page.js';

test.describe('Пустая библиотека', () => {
  test('приглашает добавить первые референсы', async ({ page }) => {
    const lib = new LibraryPage(page);
    await lib.goto('?empty');
    await expect(page.getByRole('heading', { name: 'Соберите первые референсы' })).toBeVisible();
    await expect(lib.cards).toHaveCount(0);
  });
});
