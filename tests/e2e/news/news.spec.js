import { test, expect } from '../../fixtures/perch.fixture.js';
import { NewsPage, offline } from '../../pages/news.page.js';

const say = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

test.describe('Новости: сводка дня', () => {
  test('без ключа — сводка по популярности, два раздела @smoke', async ({ page, library }) => {
    await offline(page);
    const news = new NewsPage(page);
    await news.open('Сводка дня');
    await news.dialog.getByRole('button', { name: 'Собрать сводку' }).click();
    await expect(news.dialog.getByRole('heading', { name: /^Сводка · Сегодня/ })).toBeVisible({ timeout: 30_000 });
    await expect(news.dialog.getByText(/Без ИИ: подборка по популярности/)).toBeVisible();
    await expect(news.dialog.getByRole('button', { name: /Подключить ИИ/ })).toBeVisible();
    await expect(news.dialog.getByRole('heading', { name: 'ИИ', level: 2 })).toBeVisible();
    await expect(news.dialog.getByRole('heading', { name: 'Дизайн', level: 2 })).toBeVisible();
  });

  test('с ключом — Claude отбирает и пересказывает по-русски', async ({ page, library }) => {
    await page.evaluate(() => localStorage.setItem('perch.iconai', JSON.stringify({ key: 'sk-ant-test' })));
    await offline(page, (body) => say({
      ai: [{ i: 0, title: 'Открытая модель собирает 3D-сцены по тексту', summary: 'Коротко о главном.', why: 'пишут три издания' }],
      design: [{ i: 0, title: 'Айдентика пекарни в северном стиле', summary: 'Проект недели.', why: 'избранное Behance' }],
    }));
    const news = new NewsPage(page);
    await news.open('Сводка дня');
    await news.dialog.getByRole('button', { name: 'Собрать сводку' }).click();
    await expect(news.dialog.getByText(/пересказал по-русски Claude/)).toBeVisible({ timeout: 30_000 });
    await expect(news.dialog.getByRole('heading', { name: 'Открытая модель собирает 3D-сцены по тексту' })).toBeVisible();
  });

  test('«Читать здесь» сохраняет статью и открывает читалку', async ({ page, library }) => {
    await offline(page);
    const news = new NewsPage(page);
    await news.open('Сводка дня');
    await news.dialog.getByRole('button', { name: 'Собрать сводку' }).click();
    await news.dialog.getByRole('button', { name: 'Читать здесь' }).first().click();
    await expect(news.back).toBeVisible();
    await expect(news.dialog.getByRole('article').getByRole('paragraph').first()).toBeVisible();
  });
});

test.describe('Новости: сохранённые статьи', () => {
  test('по ссылке — в список, читается, удаляется', async ({ page, library }) => {
    await offline(page);
    const news = new NewsPage(page);
    await news.open('Сохранённое');
    await news.dialog.getByLabel('Ссылка на статью').fill('https://example.com/demo/1');
    await news.dialog.getByRole('button', { name: 'Сохранить' }).click();
    const card = news.dialog.getByRole('button', { name: /Demo article/ });
    await expect(card).toBeVisible();
    await card.click();
    await expect(news.dialog.getByRole('heading', { name: 'Motion with a purpose' })).toBeVisible();
    await news.dialog.getByRole('button', { name: 'Удалить' }).click();
    await expect(card).toHaveCount(0);
  });

  test('перевод через Claude подменяет текст и возвращается к оригиналу', async ({ page, library }) => {
    await page.evaluate(() => localStorage.setItem('perch.iconai', JSON.stringify({ key: 'sk-ant-test' })));
    await offline(page, (body) => say(JSON.parse(body.messages[0].content).map((t) => 'RU: ' + t)));
    const news = new NewsPage(page);
    await news.open('Сохранённое');
    await news.dialog.getByLabel('Ссылка на статью').fill('https://example.com/demo/2');
    await news.dialog.getByRole('button', { name: 'Сохранить' }).click();
    await news.dialog.getByRole('button', { name: /Demo article/ }).click();
    await news.dialog.getByRole('button', { name: 'Перевести' }).click();
    await expect(news.dialog.getByRole('heading', { name: 'RU: Motion with a purpose' })).toBeVisible();
    await news.dialog.getByRole('button', { name: 'Оригинал', exact: true }).click();
    await expect(news.dialog.getByRole('heading', { name: 'Motion with a purpose' })).toBeVisible();
  });

  test('из ленты: «Читать» открывает статью сразу, «Назад» — в ту же ленту', async ({ page, library }) => {
    await offline(page);
    await (await new NewsPage(page).sideRow('Лента')).click();
    const feed = page.getByRole('dialog', { name: 'Лента' });
    const first = feed.getByRole('article').filter({ hasNot: page.locator('.reel-post') }).first();
    await first.getByRole('button', { name: /^Читать/ }).click();
    const news = page.getByRole('dialog', { name: 'Новости' });
    await expect(news.getByRole('button', { name: 'Назад к списку' })).toBeVisible();
    await expect(feed).toBeHidden();
    await news.getByRole('button', { name: 'Назад к списку' }).click();
    await expect(feed).toBeVisible();
    await expect(news).toBeHidden();
  });
});
