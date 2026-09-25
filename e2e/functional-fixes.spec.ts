import { test, expect, type Page } from '@playwright/test';

// Set up scenarios using the application's own Demo panel, not a second
// imported store instance (Vite HMR can give dynamic imports a different URL).
async function demo(page: Page, action: 'start' | 'late' | 'deviate') {
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Demo controls' });
  if (action === 'start') {
    await panel.getByRole('button', { name: /Start journey \(10:42 PM\)/ }).click();
    await expect(page.getByRole('button', { name: "I'M SAFE", exact: true }).first()).toBeVisible();
    return;
  }
  await panel.getByRole('button', { name: action === 'late' ? /Shift planned arrival earlier/ : /Move off route/ }).click();
  await panel.getByRole('button', { name: 'Close demo controls' }).click();
}

test('Fake Call help dismisses without affecting the call; mute never cancels caller audio', async ({ page }) => {
  // Headless Chromium has no reliable OS voice. Observe Web Speech calls, not
  // speaker output; physical-device audio remains a manual verification step.
  await page.addInitScript(() => {
    const counts = { speak: 0, cancel: 0 };
    Object.assign(window, { speechCounts: counts });
    Object.defineProperty(window, 'speechSynthesis', { value: {
      speak: () => counts.speak++, cancel: () => counts.cancel++, resume: () => undefined,
    } });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(public text: string) {} } });
  });
  await page.goto('/traveller/exit');
  await page.getByRole('button', { name: 'Fake call help' }).click();
  await expect(page.getByRole('dialog', { name: 'How to use Fake Call' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /START EXIT/ }).click();
  await page.getByRole('button', { name: 'Ring now' }).click();
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  const before = await page.evaluate(() => (window as any).speechCounts.cancel);
  const spokenBefore = await page.evaluate(() => (window as any).speechCounts.speak);
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  expect(await page.evaluate(() => (window as any).speechCounts.cancel)).toBe(before);
  await page.getByRole('dialog', { name: /call in progress/ }).getByRole('button', { name: 'Fake call help' }).click();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).speechCounts.speak)).toBeGreaterThan(spokenBefore);
  await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Unmute', exact: true }).click();
  await page.getByRole('button', { name: 'End simulated call' }).click();
  await expect(page.getByRole('dialog', { name: /call in progress/ })).toHaveCount(0);
});

test('overdue risk and completed check-ins sync to the guardian tab automatically', async ({ page, context }) => {
  await page.goto('/traveller/journey');
  await demo(page, 'start');
  const guardian = await context.newPage();
  await guardian.goto('/guardian');
  await expect(guardian.getByText('Latest check-in', { exact: true })).toBeVisible();
  await demo(page, 'late');
  await expect.poll(() => guardian.evaluate(() => JSON.parse(localStorage.getItem('suraksha.v1.journey')!).risk.score)).toBe(30);
  await expect(guardian.getByText('score 30 / 100', { exact: true })).toBeVisible();
  await guardian.getByRole('button', { name: /Why this score/ }).click();
  await expect(guardian.getByText(/past the expected arrival time/).first()).toBeVisible();
  await page.getByRole('button', { name: "I'M SAFE", exact: true }).first().click();
  await expect(guardian.getByText('Traveller confirmed safe', { exact: true })).toBeVisible();
  await expect(guardian.getByText(/Last confirmed:/)).toBeVisible();
  await guardian.reload();
  await expect(guardian.getByText('Traveller confirmed safe', { exact: true })).toBeVisible();
  const count = await guardian.evaluate(() => JSON.parse(localStorage.getItem('suraksha.v1.events')!).filter((e: any) => e.type === 'checkin_completed').length);
  expect(count).toBe(1);
});

test('mark all read persists across reload and updates the navigation badge without acknowledging', async ({ page }) => {
  await page.goto('/traveller');
  await demo(page, 'start'); await demo(page, 'deviate');
  await page.goto('/guardian/alerts');
  await expect(page.getByText('1 unread', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByText('0 unread', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Alerts', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ACKNOWLEDGE', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('0 unread', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Alerts', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
});

test('evidence selected on a historical incident survives refresh and downloads identical bytes in both roles', async ({ page }) => {
  await page.goto('/traveller/incidents/inc-1038');
  await page.getByLabel('Attach evidence file').setInputFiles({ name: 'evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('Persistent evidence bytes') });
  await expect(page.getByText('Evidence attached and saved on this device.')).toBeVisible();
  await page.reload();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download evidence.txt' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe('Persistent evidence bytes');
  await page.goto('/guardian/incidents/inc-1038');
  await expect(page.getByRole('button', { name: 'Download evidence.txt' })).toBeVisible();
  await expect(page.getByLabel('Attach evidence file')).toHaveCount(0);
});
