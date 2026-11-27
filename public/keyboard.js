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

// Keep pop-ups above the keyboard (iPhone app). The Keyboard plugin's
// "resize: body" shrinks <body>, but position:fixed overlays stay sized to the
// whole screen, so the keyboard covered the lower half of a sheet and the field
// being typed in. While the keyboard is open, end those overlays at its top.
(function () {
  var Cap = window.Capacitor;
  var Keyboard = Cap && Cap.isNativePlatform && Cap.isNativePlatform() && Cap.Plugins && Cap.Plugins.Keyboard;
  if (!Keyboard) return;
  var OVERLAYS = '.modal-overlay, .update-overlay';   // dimmed pop-ups: the sheet inside scrolls
  var PANELS = '#state-chat';     // full-screen panels with their own layout
  var css = 'html.kb-open :is(' + OVERLAYS + '){bottom:var(--kb-h,0px);padding-top:max(env(safe-area-inset-top),8px)}' +
    'html.kb-open :is(' + OVERLAYS + ')>*{max-height:100%;overflow-y:auto}';
  if (PANELS) css += 'html.kb-open :is(' + PANELS + '){bottom:var(--kb-h,0px);height:auto}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  var root = document.documentElement;
  try {
    Keyboard.addListener('keyboardWillShow', function (info) {
      root.style.setProperty('--kb-h', ((info && info.keyboardHeight) || 0) + 'px');
      root.classList.add('kb-open');
    });
    Keyboard.addListener('keyboardDidShow', function () {
      var el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    Keyboard.addListener('keyboardWillHide', function () {
      root.classList.remove('kb-open');
      root.style.removeProperty('--kb-h');
    });
  } catch (e) {}
})();
