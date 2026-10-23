(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

    // --- 右クリック・文字選択・ドラッグ・コピーを禁止 ---
  ['contextmenu', 'selectstart', 'dragstart', 'copy', 'cut'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); });
  });

  // --- 背景動画（YouTube。設定エラー等で再生できないときは予備のmp4に自動で切り替え） ---
  var YT_ID = 'yqatnoV_nQY';
  var FALLBACK_MP4 = 'https://files.catbox.moe/67hpdp.mp4';
  var v = $('bgv');
  var fbDone = false;
  function bgFallback() {
    if (fbDone || !v) return;
    fbDone = true;
    var el = document.createElement('video');
    el.className = 'bg-video-fb';
    el.src = FALLBACK_MP4;
    el.autoplay = true; el.loop = true; el.muted = true; el.controls = false;
    el.setAttribute('playsinline', '');
    el.setAttribute('disablePictureInPicture', '');
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    v.replaceWith(el);
    var p = el.play();
    if (p && p.catch) p.catch(function () {
      document.addEventListener('click', function () { el.play(); }, { once: true });
      document.addEventListener('touchstart', function () { el.play(); }, { once: true });
    });
  }
  if (v) {
    if (location.protocol === 'file:') {
      // file:// だとYouTubeは必ず設定エラーになるので最初から予備を使う
      bgFallback();
    } else {
      var params = {
        autoplay: '1', mute: '1', controls: '0', loop: '1', playlist: YT_ID,
        modestbranding: '1', rel: '0', playsinline: '1', disablekb: '1',
        fs: '0', iv_load_policy: '3', cc_load_policy: '0', enablejsapi: '1'
      };
      if (/^https?:$/.test(location.protocol)) params.origin = location.origin;
      // YouTube側のエラー通知(153など)を受け取って予備に切り替える
      window.addEventListener('message', function (e) {
        try {
          if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname)) return;
          var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
          if (d && d.event === 'onError') bgFallback();
        } catch (err) {}
      });
      v.addEventListener('load', function () {
        try { v.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch (err) {}
      });
      v.src = 'https://www.youtube.com/embed/' + YT_ID + '?' + new URLSearchParams(params).toString();
    }
  }

  // --- 一言の表示（Worker API があればそれ、なければ hitokoto.json） ---
  (function () {
    var cfg = (typeof SITE_CONFIG !== 'undefined' && SITE_CONFIG.hitokoto) || {};
    var box = $('hitokoto'), at = $('hitokoto-at');
    if (!box) return;
    var z = function (n) { return String(n).padStart(2, '0'); };
    var url = cfg.api ? cfg.api : (cfg.file || 'hitokoto.json') + '?t=' + Date.now();
    var ctl = new AbortController();
    var to = setTimeout(function () { ctl.abort(); }, 6000);
    fetch(url, { cache: 'no-store', signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        box.textContent = (j && typeof j.text === 'string' && j.text) ? j.text : (cfg.fallback || '');
        var d = j && j.updatedAt ? new Date(j.updatedAt) : null;
        if (d && !isNaN(d)) at.textContent = '更新: ' + d.getFullYear() + '/' + z(d.getMonth() + 1) + '/' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
      })
      .catch(function () { box.textContent = cfg.fallback || ''; })
      .then(function () { clearTimeout(to); });
  })();

  // --- トースト ---
  var toast = $('toast'), tt;
  function say(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(tt);
    tt = setTimeout(function () { toast.classList.remove('show'); }, 2600);
  }

  // --- きらきら爆発 ---
  function burst(n) {
    for (var i = 0; i < n; i++) {
      var d = document.createElement('span');
      d.className = 'pop';
      d.style.setProperty('--x', (Math.random() * 100 - 50) + 'vw');
      d.style.setProperty('--y', (Math.random() * -80 - 10) + 'vh');
      d.style.setProperty('--h', Math.floor(Math.random() * 360));
      document.body.appendChild(d);
      setTimeout(function (el) { el.remove(); }.bind(null, d), 1600);
    }
  }

  // 1. アイコンを5回連続クリック → くるくる＋爆発
  var iconClicks = 0, iconTimer;
  $('icon').addEventListener('click', function () {
    iconClicks++;
    clearTimeout(iconTimer);
    iconTimer = setTimeout(function () { iconClicks = 0; }, 1200);
    if (iconClicks >= 5) {
      iconClicks = 0;
      this.classList.add('spin');
      var el = this;
      setTimeout(function () { el.classList.remove('spin'); }, 1200);
      burst(40);
      say('hi');
    }
  });

  // 2. 「10億歳」をクリック
  var ageMsgs = ['10億歳', 'ははは', '永遠の10億歳', 'ババアって言った？', 'hahahahhaha'];
  var ai = 0;
  $('age').addEventListener('click', function () {
    say(ageMsgs[ai++ % ageMsgs.length]);
  });

  // 3. 推しをクリック → ハート
  $('oshi').addEventListener('click', function () {
    say('ふへへへへ');
    burst(14);
  });

  // 4. 名前を長押し(1秒) → レインボー切替
  var press;
  var title = $('title');
  function startPress() {
    press = setTimeout(function () {
      document.body.classList.toggle('rainbow');
      say(document.body.classList.contains('rainbow') ? 'レインボーモード ON 🌈' : 'レインボーモード OFF');
    }, 1000);
  }
  function endPress() { clearTimeout(press); }
  title.addEventListener('mousedown', startPress);
  title.addEventListener('touchstart', startPress, { passive: true });
  ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(function (e) {
    title.addEventListener(e, endPress);
  });

  // 5. コナミコマンド → 夜空モード＋爆発
  var konami = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  var kpos = 0;
  // 6. 文字入力で発動する合言葉
  var secrets = {
    hajime: function () { say('山田ハジメ'); burst(20); },
    sora: function () { say('そらぴよ'); },
    piyo: function () { say('ぴよぴよ'); burst(10); }
  };
  var typed = '';
  document.addEventListener('keydown', function (e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === konami[kpos]) {
      kpos++;
      if (kpos === konami.length) {
        kpos = 0;
        document.body.classList.toggle('night');
        burst(60);
        say('夜空モード');
      }
    } else {
      kpos = (k === konami[0]) ? 1 : 0;
    }
    if (e.key.length === 1) {
      typed = (typed + k).slice(-10);
      Object.keys(secrets).forEach(function (w) {
        if (typed.slice(-w.length) === w) { typed = ''; secrets[w](); }
      });
    }
  });

  // 7. 誕生日(3/23)当日はお祝いバナー
  var now = new Date();
  if (now.getMonth() === 2 && now.getDate() === 23) {
    $('bday').hidden = false;
    burst(30);
  }

  // 8. 開発者ツールのコンソールにもこっそりメッセージ
  console.log('%cやあクソ野郎ども', 'font-size:18px;color:#6cf');
})();
