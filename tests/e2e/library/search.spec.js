import { test, expect } from '../../fixtures/perch.fixture.js';
import { DEMO } from '../../utils/test-data.js';

test.describe('Поиск по библиотеке', () => {
  test('показывает демо-библиотеку при запуске @smoke', async ({ library }) => {
    expect(await library.cards.count()).toBeGreaterThan(20);
  });

  test('находит файл по названию', async ({ library }) => {
    await library.searchFor(DEMO.model);
    await expect(library.card(DEMO.model)).toBeVisible();
    // the wall is filtered a moment after typing: wait until only matching files are left
    await expect.poll(async () => (await library.visibleNames()).every((n) => n.toLowerCase().includes(DEMO.model.toLowerCase())),
      { message: 'в сетке остались только файлы с этим словом' }).toBe(true);
  });

  test('пустой результат объясняет, что делать', async ({ page, library }) => {
    await library.searchFor('ничего-такого-нет-12345');
    await expect(library.cards).toHaveCount(0);
    await expect(page.getByText(/Ничего не нашлось|не нашлось/i).first()).toBeVisible();
  });

  test('очистка поиска возвращает все файлы', async ({ library }) => {
    // the wall draws only what is on screen, so the same first screen of files must come back
    const firstScreen = async () => (await library.visibleNames()).slice(0, 12);
    const before = await firstScreen();
    await library.searchFor(DEMO.model);
    await expect.poll(firstScreen).not.toEqual(before);
    await library.searchFor('');
    await expect.poll(firstScreen).toEqual(before);
  });
});
