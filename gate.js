/* gate.js — アクセス時のbot認証（Cloudflare Turnstile）
   ローディングの途中で止めて、ローディングと同じデザインのポップアップで認証を出します。
   設定は config.js の SITE_CONFIG.turnstile。siteKey が空なら何もしません。 */
(function () {
  'use strict';
  var KEY = 'ts_pass';
  var root = document.documentElement;
  var cfg = (typeof SITE_CONFIG !== 'undefined' && SITE_CONFIG.turnstile) || null;
  if (!cfg || !cfg.siteKey) return;
  var ttl = cfg.ttlMinutes || 60;

  function passed() {
    try { var t = Number(localStorage.getItem(KEY)); return t > 0 && (Date.now() - t) < ttl * 60000; } catch (e) { return false; }
  }
  function mark() { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} }
  if (passed()) { window.__gatePassed = true; return; }

  var api = ((SITE_CONFIG.hitokoto && SITE_CONFIG.hitokoto.api) || '').replace(/\/+$/, '');
  var verifyUrl = api ? api + '/turnstile' : '';   // WorkerのURLがあればサーバー側でも確認

  function panelHTML() {
    return '<div class="gt-card">' +
      '<div class="gt-title"><i>♥</i> ロボット認証が必要です <i>♥</i></div>' +
      '<div class="gt-sub">ロボットではないことを確認させてね</div>' +
      '<div class="gt-box"></div>' +
      '<div class="gt-msg"></div>' +
      '</div>';
  }

  function mountWidget(panel, onPass) {
    var box = panel.querySelector('.gt-box');
    var msg = panel.querySelector('.gt-msg');
    var widgetId = null;
    function say(t, info) { msg.textContent = t || ''; msg.className = 'gt-msg' + (info ? ' info' : ''); }
    function retry(t) { say(t); try { if (widgetId !== null) turnstile.reset(widgetId); } catch (e) {} }

    function onToken(token) {
      if (!verifyUrl) return onPass();
      say('確認しています…', true);
      fetch(verifyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.success) onPass(); else retry('確認に失敗したよ。もう一度チェックしてね。'); })
        .catch(function () { retry('デバイスのセキュリティーを確認できませんでした。'); });
    }

    window.__tsLoaded = function () {
      say('');
      try {
        widgetId = turnstile.render(box, {
          sitekey: cfg.siteKey,
          theme: 'light',
          language: 'ja',
          callback: onToken,
          'expired-callback': function () { say('有効期限が切れたよ。もう一度チェックしてね。'); },
          'error-callback': function () { say('うまく表示できなかったよ。再読み込みしてみてね。'); }
        });
      } catch (e) { say('セキュリティチェックを表示できませんでした。'); }
    };

    say('読み込み中…', true);
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__tsLoaded';
    s.async = true;
    s.onerror = function () {
      say('セキュリティチェックを読み込めませんでした。通信状況や拡張機能（広告ブロック等）を確認してね。');
      if (!panel.querySelector('.gt-btn')) {
        var b = document.createElement('button');
        b.className = 'gt-btn';
        b.type = 'button';
        b.textContent = '再読み込み';
        b.addEventListener('click', function () { location.reload(); });
        panel.querySelector('.gt-card').appendChild(b);
      }
    };
    document.head.appendChild(s);
  }

  function done(panel, release) {
    mark();
    window.__gatePassed = true;
    panel.classList.remove('on');
    root.classList.remove('gate-lock');
    if (release) release();
    setTimeout(function () { panel.remove(); }, 700);
    window.dispatchEvent(new Event('gate:pass'));
  }

  function init() {
    var PL = window.PageLoader;
    var panel = document.createElement('div');
    panel.className = 'pl-gate';
    panel.innerHTML = panelHTML();

    if (PL && PL.isActive && PL.isActive()) {
      // ローディングの途中（70%）で止めて、半分くらい進んだらポップアップを出す
      PL.hold(70);
      PL.root().appendChild(panel);
      var timer = setInterval(function () {
        if (PL.progress() >= 40) { panel.classList.add('on'); clearInterval(timer); }
      }, 80);
      mountWidget(panel, function () { clearInterval(timer); done(panel, PL.release); });
    } else {
      // ローディングが無いときの予備（単独で画面を覆う）
      panel.classList.add('standalone');
      document.body.appendChild(panel);
      root.classList.add('gate-lock');
      requestAnimationFrame(function () { requestAnimationFrame(function () { panel.classList.add('on'); }); });
      mountWidget(panel, function () { done(panel, null); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
