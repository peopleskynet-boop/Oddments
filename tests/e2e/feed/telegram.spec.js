// Telegram channels in the feed, offline: t.me is blocked, the browser build's demo channel pages answer
import { test, expect } from '../../fixtures/perch.fixture.js';
import { FeedPage } from '../../pages/feed.page.js';

test.describe('Лента: каналы Telegram', () => {
  /** @type {FeedPage} */ let feed;
  test.beforeEach(async ({ page, library }) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    feed = new FeedPage(page);
    await feed.open();
  });

  test('ИИ-каналы во вкладке «ИИ», рекламные посты отсеяны', async () => {
    await feed.topics.getByRole('tab', { name: 'ИИ' }).click();
    await expect(feed.dialog.locator('.reel-src b', { hasText: 'Denis Sexy IT' }).first()).toBeAttached();
    // the demo channel has a post marked «Реклама. … erid: …» — it must not be in the feed
    await expect(feed.dialog.getByText(/erid|Курс по моушену со скидкой/)).toHaveCount(0);
  });

  test('«Подписки» говорят, сколько рекламы скрыто', async () => {
    await feed.dialog.getByRole('button', { name: 'Подписки' }).click();
    await expect(feed.dialog.getByText(/Скрыто рекламных постов в каналах Telegram: \d+/)).toBeVisible();
  });

  test('канал добавляется по @имени, стартовый не дублируется', async () => {
    await feed.dialog.getByRole('button', { name: 'Подписки' }).click();
    const panel = feed.dialog.getByRole('complementary', { name: 'Подписки' });
    await panel.getByLabel('Ссылка на человека').fill('@some_design_channel');
    await panel.getByRole('button', { name: 'Добавить' }).click();
    await expect(panel.getByText(/^Добавлен: .*\(Telegram\)/)).toBeVisible();
    await panel.getByLabel('Ссылка на человека').fill('https://t.me/refs_hi');
    await panel.getByRole('button', { name: 'Добавить' }).click();
    await expect(panel.getByText(/уже в ленте/)).toBeVisible();
  });
});
