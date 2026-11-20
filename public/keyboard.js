// iPhone app keyboard fixes (Capacitor). No-op in a normal browser.
// - Shows iOS's ‹ › Done toolbar above the keyboard: number pads have no
//   Return key, so without it the keypad can't be closed.
// - Tapping empty space (not a field or control) closes the keyboard.
// - Keeps the focused field visible once the keyboard finishes opening.
// Same pattern as CrossOff/KinHQ native-app.js.
(function () {
  var Cap = window.Capacitor;
  var Keyboard = Cap && Cap.isNativePlatform && Cap.isNativePlatform() && Cap.Plugins && Cap.Plugins.Keyboard;
  if (!Keyboard) return;

  try { Promise.resolve(Keyboard.setAccessoryBarVisible({ isVisible: true })).catch(function () {}); } catch (e) {}

  var FIELD = /^(INPUT|TEXTAREA|SELECT)$/;
  document.addEventListener('touchend', function (e) {
    var active = document.activeElement;
    if (!active || !FIELD.test(active.tagName)) return;
    if (e.target.closest && e.target.closest('input,textarea,select,button,a,label,[onclick],[contenteditable],[role="button"]')) return;
    active.blur();
  }, { passive: true });

  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (!FIELD.test(el.tagName)) return;
    setTimeout(function () { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300);
  });
})();
