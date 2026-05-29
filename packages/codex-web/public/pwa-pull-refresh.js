(function () {
  const DEFAULT_THRESHOLD = 112;
  const MAX_PULL = 156;

  function init(options) {
    const root = options?.root || document.body;
    const onRefresh = options?.onRefresh;
    const getScrollContainer = options?.getScrollContainer;
    const threshold = Number(options?.threshold) > 0 ? Number(options.threshold) : DEFAULT_THRESHOLD;
    if (!root || typeof onRefresh !== 'function') {
      return () => {};
    }

    const indicator = document.createElement('div');
    indicator.className = 'pull-refresh-indicator';
    indicator.textContent = 'Pull to refresh';
    document.body.appendChild(indicator);

    let startY = 0;
    let startTarget = null;
    let distance = 0;
    let pulling = false;
    let refreshing = false;

    function currentScrollContainer(target = null) {
      if (typeof getScrollContainer === 'function') {
        return getScrollContainer({
          target,
        });
      }
      return document.scrollingElement || document.documentElement;
    }

    function isAtTop(target = null) {
      const container = currentScrollContainer(target);
      if (container === false) {
        return false;
      }
      return !container || container.scrollTop <= 0;
    }

    function setIndicator(nextDistance, ready) {
      indicator.classList.toggle('is-visible', nextDistance > 8 || refreshing);
      indicator.classList.toggle('is-ready', ready);
      indicator.classList.toggle('is-refreshing', refreshing);
      indicator.textContent = refreshing ? 'Refreshing' : ready ? 'Release to refresh' : 'Pull to refresh';
      indicator.style.transform = `translate(-50%, ${Math.round(-48 + Math.min(nextDistance, MAX_PULL) * 0.7)}px)`;
    }

    function resetIndicator() {
      startTarget = null;
      distance = 0;
      pulling = false;
      indicator.classList.remove('is-visible', 'is-ready', 'is-refreshing');
      indicator.textContent = 'Pull to refresh';
      indicator.style.transform = 'translate(-50%, -48px)';
    }

    function handleTouchStart(event) {
      const target = event.target;
      if (refreshing || event.touches.length !== 1 || !isAtTop(target)) {
        return;
      }
      startY = event.touches[0].clientY;
      startTarget = target;
      distance = 0;
      pulling = true;
    }

    function handleTouchMove(event) {
      if (!pulling || event.touches.length !== 1) {
        return;
      }
      const nextDistance = event.touches[0].clientY - startY;
      if (nextDistance <= 0 || !isAtTop(startTarget)) {
        resetIndicator();
        return;
      }
      distance = Math.min(nextDistance, MAX_PULL);
      setIndicator(distance, distance >= threshold);
      if (distance > 8) {
        event.preventDefault();
      }
    }

    function handleTouchEnd() {
      if (!pulling) {
        return;
      }
      const shouldRefresh = distance >= threshold;
      const target = startTarget;
      resetIndicator();
      if (!shouldRefresh) {
        return;
      }
      refreshing = true;
      setIndicator(threshold, true);
      Promise.resolve(onRefresh({
        target,
      })).finally(() => {
        refreshing = false;
        resetIndicator();
      });
    }

    root.addEventListener('touchstart', handleTouchStart, { passive: true });
    root.addEventListener('touchmove', handleTouchMove, { passive: false });
    root.addEventListener('touchend', handleTouchEnd, { passive: true });
    root.addEventListener('touchcancel', resetIndicator, { passive: true });

    return () => {
      root.removeEventListener('touchstart', handleTouchStart);
      root.removeEventListener('touchmove', handleTouchMove);
      root.removeEventListener('touchend', handleTouchEnd);
      root.removeEventListener('touchcancel', resetIndicator);
      indicator.remove();
    };
  }

  window.CodexPullToRefresh = { init };
}());
