// AI through the API with the network mocked: no real key, no money, no pictures leave the computer.
import { test, expect } from '../../fixtures/perch.fixture.js';
import { DEMO } from '../../utils/test-data.js';

const claudeAnswer = (n, first) => ({
  content: [{ type: 'text', text: JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({
    n: i + 1, desc: first && i === 0 ? DEMO.aiDescription : 'Абстрактная форма, 3D-рендер.', tags: ['3d-рендер'] })) }) }],
});

test.describe('ИИ через API', () => {
  test.beforeEach(async ({ page, library }) => {
    await page.evaluate(() => {
      localStorage.setItem('perch.iconai', JSON.stringify({ key: 'sk-ant-test' }));
      localStorage.setItem('perch.ai', JSON.stringify({ on: true, paused: false, engine: 'api' }));
    });
  });

  test('спрашивает сумму, описывает картинки и находит по описанию', async ({ page, library }) => {
    let calls = 0;
    await page.route('https://api.anthropic.com/**', async (route) => {
      const n = route.request().postDataJSON().messages[0].content.filter((c) => c.type === 'image').length;
      await route.fulfill({ json: claudeAnswer(n, ++calls === 1) });
    });
    await library.goto();
    const pill = page.locator('.aibar'); // role=status: its text is the whole state
    await expect(pill).toContainText(/ИИ через API: \d+ картин\S* ≈ \$/);
    expect(calls, 'до «Начать» запросов нет').toBe(0);
    await pill.getByRole('button', { name: 'Начать' }).click();
    await expect(pill).toContainText('ИИ готов', { timeout: 30_000 });
    expect(calls).toBeGreaterThan(1);
    await library.searchFor(DEMO.aiQuery);
    await expect(library.cards).toHaveCount(1);
    await expect(library.aiChip).toContainText('по смыслу: 1');
  });

  test('«Не сейчас» ставит на паузу без запросов', async ({ page, library }) => {
    let calls = 0;
    await page.route('https://api.anthropic.com/**', (route) => { calls++; return route.abort(); });
    await library.goto();
    const pill = page.locator('.aibar');
    await pill.getByRole('button', { name: 'Не сейчас' }).click();
    await expect(pill).toContainText('на паузе');
    expect(calls).toBe(0);
  });

  test('неверный ключ — понятная ошибка и «Повторить»', async ({ page, library }) => {
    await page.route('https://api.anthropic.com/**', (route) => route.fulfill({ status: 401, json: { error: { message: 'invalid x-api-key' } } }));
    await library.goto();
    const pill = page.locator('.aibar');
    await pill.getByRole('button', { name: 'Начать' }).click();
    await expect(pill).toContainText('ключ не подошёл');
    await expect(pill.getByRole('button', { name: 'Повторить' })).toBeVisible();
    await expect(library.aiChip).toContainText('ИИ !');
  });
});
