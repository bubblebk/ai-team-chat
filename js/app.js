/* app.js — 시작 */
(function () {
  'use strict';
  const AIC = window.AIC;

  function boot() {
    try {
      AIC.store.load();
    } catch (e) {
      console.error('저장 데이터를 불러오지 못했습니다.', e);
    }
    AIC.ui.init();

    // PWA 서비스 워커 (http/https에서만)
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
          console.warn('서비스 워커 등록 실패:', err && err.message);
        });
      });
    }

    // 화면 회전·키보드 대응
    window.addEventListener('orientationchange', () => {
      setTimeout(() => window.scrollTo(0, 0), 120);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
