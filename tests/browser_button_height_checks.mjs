import assert from 'node:assert/strict';

// Checkbox/radio/switch/slider thumbs are form indicators, not action buttons.
export const actionSelector = 'button:not([role="checkbox"]):not([role="radio"]):not([role="switch"]), a[role="button"], .app-topbar a:not(.app-topbar-brand), .ui-button, .button-primary, .button-secondary, [data-slot="button"], [role="tab"]';

export async function measureActionButtons(page) {
  // Radix dialogs mount at scale(.95); measure after their entrance animation.
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    await Promise.all(document.getAnimations()
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations))
      .map(animation => animation.finished.catch(() => {})));
  });
  return page.locator(actionSelector).evaluateAll(elements => [...new Set(elements)]
    .filter(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
    .map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { name: element.getAttribute('aria-label') || element.textContent.trim().replace(/\s+/g, ' ').slice(0, 100),
        height: rect.height, width: rect.width, x: rect.x, y: rect.y, className: element.className,
        scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
        lineHeight: style.lineHeight, slot: element.getAttribute('data-slot'),
        topbar: !!element.closest('.app-topbar'), viewport: innerWidth };
    }));
}

export async function verifyActionButtons(page, touch, scope = '') {
  const buttons = await measureActionButtons(page);
  const limit = touch ? 44 : 32;
  const oversized = buttons.filter(button => button.height > limit + 0.1);
  const undersizedTouch = touch ? buttons.filter(button => button.height < limit - 0.1) : [];
  assert.deepEqual(oversized, [], `${scope}: action buttons exceed ${limit}px`);
  assert.deepEqual(undersizedTouch, [], `${scope}: touch buttons must be ${limit}px`);
  assert.deepEqual(buttons.filter(button => button.topbar && (button.x < 0 || button.x + button.width > button.viewport + 0.1)),
    [], `${scope}: topbar buttons must fit within the viewport`);
  return buttons;
}
