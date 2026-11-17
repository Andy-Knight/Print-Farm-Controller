const menus = new WeakSet();

// Keep the menu in its original DOM subtree for form event handling while
// rendering it above the scrollable Printer Details dialog.
export function bindFilamentColourPopup(dropdown) {
  if (!dropdown) return;
  const menu = dropdown.querySelector('.color-family-menu');
  const trigger = dropdown.querySelector('summary');
  if (typeof menu.showPopover !== 'function' || menus.has(menu)) return;

  menus.add(menu);
  menu.setAttribute('popover', 'auto');
  dropdown.addEventListener('toggle', () => {
    if (!dropdown.open) {
      if (menu.matches(':popover-open')) menu.hidePopover();
      return;
    }
    if (dropdown.dataset.disabled === '1' || trigger.getAttribute('aria-disabled') === 'true'
      || !menu.isConnected || !trigger.getClientRects().length) {
      dropdown.open = false;
      return;
    }
    positionMenu(menu, trigger);
    if (!menu.matches(':popover-open')) menu.showPopover({source:trigger});
  });
  menu.addEventListener('toggle', () => {
    if (!menu.matches(':popover-open')) dropdown.open = false;
  });
  dropdown.addEventListener('click', event => {
    if (trigger.contains(event.target)) return;
    if (event.target.closest('.color-family-option')) trigger.focus({preventScroll:true});
  });
}

function positionMenu(menu, trigger) {
  const box = trigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  const bottom = top + (viewport?.height ?? window.innerHeight);
  const gap = 5;
  const below = bottom - box.bottom - gap;
  const above = box.top - top - gap;
  const opensUp = below < 300 && above > below;
  menu.style.left = `${box.left}px`;
  menu.style.width = `${box.width}px`;
  menu.style.maxHeight = `${Math.max(0, Math.min(300, opensUp ? above : below))}px`;
  menu.style.top = opensUp ? 'auto' : `${box.bottom + gap}px`;
  menu.style.bottom = opensUp ? `${window.innerHeight - box.top + gap}px` : 'auto';
}

function repositionOpenMenu(event) {
  const menu = document.querySelector('.color-family-menu:popover-open');
  if (!menus.has(menu) || menu.contains(event.target instanceof Node ? event.target : null)) return;
  const trigger = menu.parentElement.querySelector('summary');
  const rect = trigger.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (trigger.contains(hit)) positionMenu(menu, trigger);
  else menu.hidePopover();
}

if (typeof HTMLElement.prototype.showPopover === 'function') {
  document.addEventListener('close', event => {
    const menu = event.target.querySelector?.('.color-family-menu:popover-open');
    if (menus.has(menu)) menu.hidePopover();
  }, true);
  window.addEventListener('resize', repositionOpenMenu);
  document.addEventListener('scroll', repositionOpenMenu, {capture:true, passive:true});
  window.visualViewport?.addEventListener('resize', repositionOpenMenu);
  window.visualViewport?.addEventListener('scroll', repositionOpenMenu);
}
