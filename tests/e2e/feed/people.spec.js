// «Люди» in the feed, offline: real feeds blocked, the browser build's demo feeds answer
import { test, expect } from '../../fixtures/perch.fixture.js';
import { FeedPage } from '../../pages/feed.page.js';

test.describe('Лента: люди и подписки', () => {
  /** @type {FeedPage} */ let feed;
  test.beforeEach(async ({ page, library }) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    feed = new FeedPage(page);
    await feed.open();
  });
  const panel = () => feed.dialog.getByRole('complementary', { name: 'Подписки' });

  test('вкладка «Люди» показывает записи стартового списка', async () => {
    await feed.topics.getByRole('tab', { name: 'Люди' }).click();
    await expect(feed.dialog.locator('.reel-src b', { hasText: 'Andrew Price' }).first()).toBeAttached();
  });

  test('Instagram не добавляется — подсказка про расширение', async () => {
    await feed.dialog.getByRole('button', { name: 'Подписки' }).click();
    await panel().getByLabel('Ссылка на человека').fill('https://www.instagram.com/someone');
    await panel().getByRole('button', { name: 'Добавить' }).click();
    await expect(panel().getByText(/нет открытых лент.*расширением/)).toBeVisible();
  });

  test('ссылка на Bluesky добавляет человека, × убирает', async () => {
    await feed.dialog.getByRole('button', { name: 'Подписки' }).click();
    const before = await panel().getByRole('button', { name: /^Убрать / }).count();
    await panel().getByLabel('Ссылка на человека').fill('https://bsky.app/profile/someone.bsky.social');
    await panel().getByRole('button', { name: 'Добавить' }).click();
    await expect(panel().getByText(/^Добавлен:/)).toBeVisible();
    await expect(panel().getByRole('button', { name: /^Убрать / })).toHaveCount(before + 1);
    await panel().getByRole('button', { name: /^Убрать / }).first().click();
    await expect(panel().getByRole('button', { name: /^Убрать / })).toHaveCount(before);
  });

  test('убранного из стартового списка можно вернуть', async () => {
    await feed.dialog.getByRole('button', { name: 'Подписки' }).click();
    await panel().getByRole('button', { name: 'Убрать Andrew Price' }).click();
    await expect(panel().getByRole('button', { name: 'Убрать Andrew Price' })).toHaveCount(0);
    await panel().getByRole('button', { name: /Вернуть стартовый список/ }).click();
    await expect(panel().getByRole('button', { name: 'Убрать Andrew Price' })).toBeVisible();
  });
});
