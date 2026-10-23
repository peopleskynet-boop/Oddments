import { test, expect } from '../../fixtures/perch.fixture.js';
import { IconKitPage } from '../../pages/iconkit.page.js';

test.describe('Конструктор иконок', () => {
  /** @type {IconKitPage} */ let ik;
  test.beforeEach(async ({ page, library }) => {
    ik = new IconKitPage(page);
    await ik.open();
  });

  test('рисует прямоугольник протягиванием — появляется слой', async () => {
    await ik.drawWith('r');
    await expect(ik.layers.getByRole('button', { name: /Скрыть/ })).toHaveCount(1);
    await expect(ik.tools.getByRole('button', { name: 'Выбор' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('Ctrl+Z убирает нарисованное, Ctrl+Shift+Z возвращает', async ({ page }) => {
    await ik.drawWith('o');
    const eyes = ik.layers.getByRole('button', { name: /Скрыть/ });
    await expect(eyes).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(eyes).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(eyes).toHaveCount(1);
  });

  test('клавиши Figma: Alt+H/V — по центру, Shift+H — отражение, Ctrl+C/V и Ctrl+] — слои', async ({ page }) => {
    await ik.drawWith('r', [0.3, 0.3], [0.45, 0.5]);
    const x = ik.dialog.locator('[data-k="x"]'), y = ik.dialog.locator('[data-k="y"]'), w = ik.dialog.locator('[data-k="w"]'), h = ik.dialog.locator('[data-k="h"]');
    await page.keyboard.press('Alt+h');
    await page.keyboard.press('Alt+v');
    // one shape centres in the live area 2–22 (on the 0.5 grid: an odd size leaves it a quarter off)
    expect(Math.abs(+(await x.inputValue()) + +(await w.inputValue()) / 2 - 12)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(+(await y.inputValue()) + +(await h.inputValue()) / 2 - 12)).toBeLessThanOrEqual(0.25);
    await page.keyboard.press('Alt+a');
    expect(+(await x.inputValue())).toBe(2);
    await page.keyboard.press('Shift+h');
    const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('perch.iconkit')));
    expect((await draft()).shapes[0].fx).toBe(true);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    const eyes = ik.layers.getByRole('button', { name: /Скрыть/ });
    await expect(eyes).toHaveCount(2);
    const ids = (await draft()).shapes.map((s) => s.id);
    await page.keyboard.press('Control+BracketLeft'); // the pasted (selected) shape one layer down
    expect((await draft()).shapes.map((s) => s.id)).toEqual([ids[1], ids[0]]);
    await page.keyboard.press('Control+Shift+h');
    expect((await draft()).shapes.find((s) => s.id === ids[1]).hidden).toBe(true);
  });

  test('Enter — правка точек: тянуть точку, добавить на контуре, удалить, Enter — готово', async ({ page }) => {
    await ik.drawWith('o', [0.35, 0.35], [0.65, 0.65]);
    await page.keyboard.press('Enter');
    await expect(ik.dialog.locator('#ikEditNote')).toBeVisible();
    const pts = ik.dialog.locator('[data-pt]');
    await expect(pts).toHaveCount(4); // an ellipse: four points
    const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('perch.iconkit')));
    expect((await draft()).shapes[0].type).toBe('path');
    // the top point dragged up: the shape grows
    const h0 = (await draft()).shapes[0].h;
    const boxes = await Promise.all((await pts.all()).map((p) => p.boundingBox()));
    const up = boxes.reduce((m, r) => (r.y < m.y ? r : m), boxes[0]);
    await page.mouse.move(up.x + up.width / 2, up.y + up.height / 2);
    await page.mouse.down();
    await page.mouse.move(up.x + up.width / 2, up.y - 60, { steps: 6 });
    await page.mouse.up();
    expect((await draft()).shapes[0].h).toBeGreaterThan(h0);
    // a click on the outline, half-way between two points, adds a point there
    const at = await page.evaluate(() => {
      const path = document.querySelector('.ik-epath'), svg = path.ownerSVGElement.getBoundingClientRect();
      const q = path.getPointAtLength(path.getTotalLength() * 0.125);
      return { x: svg.left + q.x, y: svg.top + q.y };
    });
    await page.mouse.click(at.x, at.y);
    await expect(pts).toHaveCount(5);
    await expect(ik.dialog.locator('[data-pt].on')).toHaveCount(1);
    // Delete removes the chosen (new) point
    await page.keyboard.press('Delete');
    await expect(pts).toHaveCount(4);
    // double-click on a point: smooth → sharp corner (its handles go)
    await pts.first().dblclick();
    const c = await page.evaluate(async () => {
      const K = await import('/src/lib/iconkit.js');
      return K.contoursOf(JSON.parse(localStorage.getItem('perch.iconkit')).shapes[0])[0];
    });
    expect(c.some((q) => Math.hypot(...q.i) + Math.hypot(...q.o) < 1e-6)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(ik.dialog.locator('#ikEditNote')).toBeHidden();
    await expect(pts).toHaveCount(0);
  });

  test('группы: Ctrl+G — клик по одной выделяет обе; скругление угла в правке точек', async ({ page }) => {
    await ik.drawWith('r', [0.3, 0.3], [0.4, 0.4]);
    await ik.drawWith('r', [0.55, 0.55], [0.65, 0.65]);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+g');
    const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('perch.iconkit')));
    const d = await draft();
    expect(d.shapes[0].g && d.shapes[0].g === d.shapes[1].g).toBe(true);
    await page.keyboard.press('Escape'); // nothing selected
    const b = await ik.canvas.boundingBox();
    await page.mouse.click(b.x + b.width * 0.35, b.y + b.height * 0.35);
    await expect(ik.dialog.getByText('Выбрано: 2')).toBeVisible();
    await page.keyboard.press('Control+Shift+g');
    expect((await draft()).shapes.some((s) => s.g)).toBe(false);
    // a triangle: its sharp points (no handles) get a radius
    await page.keyboard.press('Escape');
    await page.mouse.click(b.x + b.width * 0.35, b.y + b.height * 0.35);
    await page.keyboard.press('Enter');
    const pts = ik.dialog.locator('[data-pt]');
    const n0 = await pts.count();
    await pts.first().click({ force: true });
    // a squircle has no sharp points: make this one a corner first, then give it a radius
    await ik.dialog.getByRole('button', { name: 'Сделать углом' }).click();
    await ik.dialog.getByRole('button', { name: 'Скруглить' }).click();
    await expect(pts).toHaveCount(n0 + 1);
  });

  test('стилизатор: SVG-иконка Lucide на холсте становится иконкой по правилам', async ({ page }) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    await page.evaluate((text) => {
      const dt = new DataTransfer(); dt.items.add(new File([text], 'lock.svg', { type: 'image/svg+xml' }));
      const stage = document.querySelector('#ikStage');
      stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, svg);
    const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('perch.iconkit')));
    await expect.poll(async () => (await draft()).shapes.length).toBeGreaterThan(0);
    const d = await draft();
    expect(d.name).toBe('lock');
    // every shape on the 0.5 grid, inside the margins
    for (const s of d.shapes) for (const v of [s.x, s.y, s.w, s.h]) expect(Math.abs(v * 2 - Math.round(v * 2))).toBeLessThan(1e-6);
    await expect(ik.dialog.locator('.ik-chk.bad')).toHaveCount(0);
  });

  test('Esc закрывает конструктор', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(ik.dialog).toBeHidden();
  });

  test('генерация без ключа API подсказывает, где его взять', async ({ page, library }) => {
    await ik.dialog.getByPlaceholder('умная лампа с Wi-Fi').fill('замок');
    await ik.dialog.getByRole('button', { name: 'Сгенерировать' }).click();
    await expect(library.toasts).toContainText('ИИ для иконок');
  });
});
