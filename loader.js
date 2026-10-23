/* loader.js — ローディング画面（リング＋アイコン）。<body>直後で読み込む */
(function () {
  'use strict';
  var el = document.getElementById('pl');
  if (!el) return;
  var bar = document.getElementById('plbar');
  var pct = document.getElementById('plpct');
  var logo = el.querySelector('.pl-logo');
  var CIRC = 2 * Math.PI * 70;

  var seen = false;
  try { seen = sessionStorage.getItem('pl_seen') === '1'; } catch (e) {}
  if (seen) el.classList.add('short');

  // 文字を1文字ずつ跳ねさせる
  Array.prototype.forEach.call(el.querySelectorAll('.pl-label span'), function (s, i) {
    s.style.setProperty('animation-delay', (i * 0.08) + 's');
  });
  // ふわふわ飾りの位置をばらつかせる
  Array.prototype.forEach.call(el.querySelectorAll('.pl-fl-wrap span'), function (s, i) {
    s.style.setProperty('left', (6 + Math.random() * 88) + '%');
    s.style.setProperty('font-size', (14 + Math.random() * 18) + 'px');
    s.style.setProperty('animation-duration', (5 + Math.random() * 5) + 's');
    s.style.setProperty('animation-delay', (-Math.random() * 8) + 's');
  });

  // 準備完了の判定：HTML解析完了＋アイコン表示。最長 MAX_WAIT で必ず進む
  var domOk = document.readyState !== 'loading', logoOk = false, forced = false;
  if (!domOk) document.addEventListener('DOMContentLoaded', function () { domOk = true; });
  function logoDone() { logoOk = true; }
  if (logo.complete) logoOk = true;
  logo.addEventListener('load', logoDone);
  logo.addEventListener('error', logoDone);
  var MAX_WAIT = seen ? 1800 : 3200;
  setTimeout(function () { forced = true; }, MAX_WAIT);

  var minMs = seen ? 500 : 1500, creep = seen ? 500 : 1400;
  var p = 0, t0 = performance.now(), last = t0, done = false, holdCap = null;

  function draw() {
    bar.setAttribute('stroke-dashoffset', String(CIRC * (1 - p / 100)));
    pct.textContent = Math.round(p) + '%';
  }
  function finish() {
    done = true;
    try { sessionStorage.setItem('pl_seen', '1'); } catch (e) {}
    el.classList.add('out');
    setTimeout(function () {
      el.classList.add('hidden');
      document.body.classList.remove('pl-lock');
      window.__plDone = true;
      window.dispatchEvent(new Event('pl:done'));
    }, 650);
  }
  function frame(now) {
    if (done) return;
    var t = Math.max(0, now - t0);
    var dt = Math.min(Math.max(0, now - last), 100);
    last = now;
    var ready = (forced || (domOk && logoOk)) && t >= minMs;
    var target = ready ? 100 : 96 * (1 - Math.exp(-t / creep));
    if (holdCap !== null) { target = Math.min(target, holdCap); if (target < p) target = p; }  // bot認証待ちなどで止める間
    var tau = ready ? 140 : 220;
    p += (target - p) * (1 - Math.exp(-dt / tau));
    if (ready && p > 99.5) p = 100;
    draw();
    if (p >= 100) return finish();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 外部（gate.js）から、ローディングを途中で止めたり再開したりするためのAPI
  window.PageLoader = {
    hold: function (cap) { holdCap = cap; },
    release: function () { holdCap = null; },
    progress: function () { return p; },
    root: function () { return el; },
    isActive: function () { return !done && !el.classList.contains('hidden'); }
  };
})();
