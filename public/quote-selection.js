export function bindQuoteSelection(button, onQuote) {
  let selected = '';
  let dragging = false;
  let frame = 0;

  function hide() {
    cancelAnimationFrame(frame);
    frame = 0;
    const wasVisible = !button.hidden;
    button.hidden = true;
    selected = '';
    return wasVisible;
  }

  function show() {
    frame = 0;
    const selection = window.getSelection();
    if (dragging || !selection?.rangeCount || selection.isCollapsed) return hide();

    const range = selection.getRangeAt(0);
    const content = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)
      ?.closest('.messages article :is(.markdown, .message-bubble)');
    const message = content(range.startContainer);
    const scroller = message?.closest('#main-scroll');
    if (!scroller || message !== content(range.endContainer) || message.closest('[inert]')) return hide();

    const excerpt = selection.toString().trim();
    if (!excerpt) return hide();
    const bounds = scroller.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    const top = Math.max(bounds.top, rect.top);
    const bottom = Math.min(bounds.bottom, rect.bottom);
    if (top >= bottom || rect.right <= bounds.left || rect.left >= bounds.right) return hide();

    selected = excerpt;
    button.hidden = false;
    const {width, height} = button.getBoundingClientRect();
    const above = top - height - 8;
    const below = bottom + 8;
    const touch = matchMedia('(pointer: coarse)').matches;
    const y = (touch || above < 8) && below + height <= innerHeight - 8 ? below : above;
    button.style.top = `${Math.max(8, y)}px`;
    button.style.left = `${Math.min(innerWidth - width - 8, Math.max(8, bounds.left, rect.left))}px`;
  }

  function schedule() {
    if (!frame && !dragging) frame = requestAnimationFrame(show);
  }

  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => {
    if (!selected) return;
    const excerpt = selected;
    hide();
    window.getSelection()?.removeAllRanges();
    onQuote(excerpt);
  });
  document.addEventListener('selectionchange', schedule);
  document.addEventListener('pointerdown', event => {
    if (event.target === button) return;
    dragging = event.pointerType === 'mouse' && event.target.closest('.messages') !== null;
    hide();
  });
  document.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    schedule();
  });
  document.addEventListener('pointercancel', () => { dragging = false; hide(); });
  document.addEventListener('scroll', hide, {capture: true, passive: true});
  window.addEventListener('resize', hide);
  return hide;
}
