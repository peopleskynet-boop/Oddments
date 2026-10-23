import { test, expect } from '../../fixtures/perch.fixture.js';
import { DEMO } from '../../utils/test-data.js';

test.describe('Палитра команд (Ctrl+Пробел)', () => {
  const palette = (page) => page.getByRole('dialog', { name: 'Команды и поиск' });

  test('открывается и закрывается', async ({ page, library }) => {
    await library.press('Control+Space');
    await expect(palette(page)).toBeVisible();
    await expect(palette(page).getByRole('combobox')).toBeFocused();
    await library.press('Escape');
    await expect(palette(page)).toBeHidden();
  });

  test('находит подборку и открывает её', async ({ page, library }) => {
    await library.press('Control+Space');
    await palette(page).getByRole('combobox').fill(DEMO.folder);
    await expect(palette(page).getByRole('option', { name: new RegExp(DEMO.folder) }).first()).toBeVisible();
    await library.press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect(page.getByRole('heading', { name: new RegExp(DEMO.folder) }).first()).toBeVisible();
  });

  test('пустое состояние, если ничего нет', async ({ page, library }) => {
    await library.press('Control+Space');
    await palette(page).getByRole('combobox').fill('ыыыыыыы');
    await expect(palette(page).getByText('Ничего не нашлось')).toBeVisible();
  });
});
