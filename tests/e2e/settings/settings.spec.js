import { test, expect } from '../../fixtures/perch.fixture.js';

test.describe('Настройки', () => {
  const panel = (page) => page.getByRole('dialog', { name: 'Настройки' });

  test('открываются кнопкой и закрываются Esc', async ({ page, library }) => {
    await library.settingsButton.click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: 'Настройки' })).toBeVisible();
    await library.press('Escape');
    await expect(panel(page)).toBeHidden();
  });

  test('«Через API» показывает ключ Voyage и модель для тегов', async ({ page, library }) => {
    await library.settingsButton.click();
    const voyage = panel(page).getByLabel('Ключ API Voyage');
    await expect(voyage).toBeHidden();
    await panel(page).getByRole('button', { name: /Где работает ИИ/ }).click();
    await page.getByRole('option', { name: /Через API/ }).click();
    await expect(voyage).toBeVisible();
    await expect(panel(page).getByText(/за 1000 картинок/)).toBeVisible();
  });

  test('ключ Anthropic не показывается целиком после сохранения', async ({ page, library }) => {
    await library.settingsButton.click();
    const key = panel(page).getByLabel('Ключ API Anthropic');
    await key.fill('sk-ant-test-1234');
    await key.press('Tab');
    await library.press('Escape');
    await library.settingsButton.click();
    await expect(panel(page).getByLabel('Ключ API Anthropic')).toHaveValue(/^•+1234$/);
  });
});
