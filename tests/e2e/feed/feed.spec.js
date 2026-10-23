// The feed without the internet: real feeds are blocked, the browser build's demo feeds answer instead
import { test, expect } from '../../fixtures/perch.fixture.js';
import { FeedPage } from '../../pages/feed.page.js';

test.describe('Лента новостей', () => {
  /** @type {FeedPage} */ let feed;
  test.beforeEach(async ({ page, library }) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    feed = new FeedPage(page);
    await feed.open();
  });

  test('собирается из источников и листается стрелкой @smoke', async ({ page }) => {
    expect(await feed.reels.count()).toBeGreaterThan(20);
    await expect(feed.counter).toHaveText(/^1 \/ \d+$/);
    await page.keyboard.press('ArrowDown');
    await expect(feed.counter).toHaveText(/^2 \/ \d+$/);
  });

  test('«Нравится» отмечается', async () => {
    const like = feed.reel(0).getByRole('button', { name: /Нравится/ });
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
  });

  test('«В Oddments» добавляет картинку в библиотеку с названием статьи', async ({ page, library }) => {
    // an article card (a Telegram post may be a clip — «В Oddments» saves the clip itself there)
    const card = feed.reels.filter({ has: page.locator('.reel-src b', { hasText: /^Behance$/ }) }).first();
    await card.scrollIntoViewIfNeeded();
    const title = await card.getByRole('heading').textContent();
    await card.getByRole('button', { name: /В Oddments/ }).click();
    await page.keyboard.press('Escape');
    // the card's accessible name starts with the file name — the article's title
    await expect(library.files.getByRole('option', { name: title.trim() })).toBeVisible();
  });

  test('тема «3D» оставляет только 3D-источники', async () => {
    await feed.topics.getByRole('tab', { name: '3D' }).click();
    await expect(feed.topics.getByRole('tab', { name: '3D' })).toHaveAttribute('aria-selected', 'true');
    const sources = await feed.dialog.locator('.reel-src b').allTextContents();
    expect(new Set(sources)).toEqual(new Set(['80 Level', 'CG Channel', 'BlenderNation']));
  });

  test('«Скрыть» убирает источник, «Вернуть» возвращает', async ({ library }) => {
    await feed.topics.getByRole('tab', { name: '3D' }).click();
    await feed.reel(0).getByRole('button', { name: /Скрыть/ }).click();
    await expect(feed.dialog.locator('.reel-src b', { hasText: '80 Level' })).toHaveCount(0);
    await library.toasts.getByRole('button', { name: 'Вернуть' }).click();
    await expect(feed.dialog.locator('.reel-src b', { hasText: '80 Level' }).first()).toBeVisible();
  });

  test('Esc закрывает ленту', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(feed.dialog).toBeHidden();
  });
});
