(function () {
  'use strict';
  var hk = (typeof SITE_CONFIG !== 'undefined' && SITE_CONFIG.hitokoto) || {};
  var API = (hk.api || '').replace(/\/+$/, '');
  var useApi = !!API;
  var MAX_HISTORY = 10;
  var data = { text: '', updatedAt: null, history: [] };
  var TOKEN = null;
  try { TOKEN = sessionStorage.getItem('adm'); } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  var z = function (n) { return String(n).padStart(2, '0'); };
  function fmt(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    return d.getFullYear() + '/' + z(d.getMonth() + 1) + '/' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  function say(id, msg, cls) { $(id).className = 'status ' + (cls || ''); $(id).textContent = msg; }

  // ---- base64url ----
  function b64uToBuf(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function bufToB64u(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ---- Worker への呼び出し ----
  function api(path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    return fetch(API + path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
      });
  }
  function dropSession() {
    TOKEN = null;
    try { sessionStorage.removeItem('adm'); } catch (e) {}
  }

  // ---- 画面の切り替え ----
  function show(which) {
    $('loginCard').hidden = which !== 'login';
    $('pkCard').hidden = which !== 'pk';
    $('editor').hidden = which !== 'editor';
  }

  // ---- 一言の表示まわり ----
  $('text').addEventListener('input', function () { $('count').textContent = $('text').value.length + ' / 120'; });

  function render() {
    $('current').textContent = data.updatedAt ? '最終更新: ' + fmt(data.updatedAt) : '';
    var pv = $('preview');
    pv.textContent = data.text || '（まだ一言がありません）';
    if (data.updatedAt) {
      var s = document.createElement('small');
      s.textContent = '更新: ' + fmt(data.updatedAt);
      pv.appendChild(s);
    }
    var ul = $('history');
    ul.textContent = '';
    if (!data.history.length) {
      var e = document.createElement('li');
      e.textContent = 'まだありません';
      ul.appendChild(e);
    }
    data.history.forEach(function (h, i) {
      var li = document.createElement('li');
      var box = document.createElement('div');
      box.appendChild(document.createTextNode(h.text));
      var small = document.createElement('small');
      small.textContent = fmt(h.at);
      box.appendChild(small);
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'ghost';
      del.textContent = '削除';
      del.addEventListener('click', function () { removeHistory(i); });
      li.appendChild(box);
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  function load() {
    var url = useApi ? API + '/' : (hk.file || 'hitokoto.json') + '?t=' + Date.now();
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        data = { text: j.text || '', updatedAt: j.updatedAt || null, history: Array.isArray(j.history) ? j.history : [] };
        $('text').value = data.text;
        $('count').textContent = data.text.length + ' / 120';
      })
      .catch(function () { say('status', '現在の一言を読み込めませんでした（新規として扱います）', 'info'); })
      .then(render);
  }

  function persist() {
    if (useApi) {
      return api('/', data).then(function (r) {
        if (r.status === 401) { dropSession(); show('login'); throw new Error('ログインの有効期限が切れました。もう一度ログインしてください'); }
        if (r.status === 429) throw new Error('試行回数が多すぎます。しばらく待ってね');
        if (r.status < 200 || r.status >= 300) throw new Error('保存に失敗しました (' + r.status + ')');
        return '更新しました。サイトに反映されています。';
      });
    }
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hitokoto.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    return Promise.resolve('hitokoto.json をダウンロードしました。サイトに上書きしてください。');
  }

  function run(mutate) {
    var backup = JSON.stringify(data);
    $('save').disabled = true;
    say('status', '処理中…', 'info');
    mutate();
    persist().then(function (msg) { render(); say('status', msg, 'ok'); })
      .catch(function (e) { data = JSON.parse(backup); render(); say('status', e.message || 'エラーが発生しました', 'err'); })
      .then(function () { $('save').disabled = false; });
  }

  $('save').addEventListener('click', function () {
    var text = $('text').value.trim();
    if (!text) return say('status', '一言を入力してください', 'err');
    if (text === data.text) return say('status', 'いまの一言と同じです', 'err');
    run(function () {
      if (data.text) data.history.unshift({ text: data.text, at: data.updatedAt || new Date().toISOString() });
      data.history = data.history.slice(0, MAX_HISTORY);
      data.text = text;
      data.updatedAt = new Date().toISOString();
    });
  });

  function removeHistory(i) {
    if (!confirm('この履歴を削除しますか？')) return;
    run(function () { data.history.splice(i, 1); });
  }

  // ---- パスキー管理 ----
  function loadPasskeys() {
    return api('/auth/pk/list').then(function (r) {
      var ul = $('pkList');
      ul.textContent = '';
      var keys = (r.body && r.body.keys) || [];
      if (!keys.length) {
        var e = document.createElement('li');
        e.textContent = 'まだ登録されていません（Googleログインだけで入れる状態です）';
        ul.appendChild(e);
      }
      keys.forEach(function (k) {
        var li = document.createElement('li');
        var box = document.createElement('div');
        box.appendChild(document.createTextNode('パスキー'));
        var small = document.createElement('small');
        small.textContent = '登録: ' + fmt(k.created);
        box.appendChild(small);
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'ghost';
        del.textContent = '削除';
        del.addEventListener('click', function () {
          if (!confirm('このパスキーを削除しますか？')) return;
          api('/auth/pk/delete', { id: k.id }).then(loadPasskeys);
        });
        li.appendChild(box);
        li.appendChild(del);
        ul.appendChild(li);
      });
    });
  }

  $('pkAdd').addEventListener('click', function () {
    if (!window.PublicKeyCredential) return say('pkMsg', 'このブラウザはパスキーに対応していません', 'err');
    say('pkMsg', 'デバイスの指示に従ってください…', 'info');
    api('/auth/pk/reg-options').then(function (r) {
      if (r.status !== 200) throw new Error('準備に失敗しました');
      var o = r.body;
      o.challenge = b64uToBuf(o.challenge);
      o.user.id = b64uToBuf(o.user.id);
      (o.excludeCredentials || []).forEach(function (c) { c.id = b64uToBuf(c.id); });
      return navigator.credentials.create({ publicKey: o });
    }).then(function (cred) {
      return api('/auth/pk/reg-verify', {
        credential: {
          clientDataJSON: bufToB64u(cred.response.clientDataJSON),
          attestationObject: bufToB64u(cred.response.attestationObject)
        }
      });
    }).then(function (r) {
      if (r.status !== 200) throw new Error((r.body && r.body.error) || '登録に失敗しました');
      say('pkMsg', 'パスキーを登録しました。次回からパスキー認証が必要になります。', 'ok');
      return loadPasskeys();
    }).catch(function (e) {
      say('pkMsg', e && e.name === 'NotAllowedError' ? 'キャンセルされました' : (e.message || '登録に失敗しました'), 'err');
    });
  });

  // ---- パスキーで認証（Googleログイン後） ----
  function authWithPasskey(pre) {
    say('pkStatus', 'デバイスの指示に従ってください…', 'info');
    api('/auth/pk/auth-options', { pre: pre }).then(function (r) {
      if (r.status === 401) throw new Error('時間切れです。最初からログインし直してください');
      if (r.status === 429) throw new Error('試行回数が多すぎます。しばらく待ってね');
      if (r.status !== 200) throw new Error('準備に失敗しました');
      var o = r.body;
      o.challenge = b64uToBuf(o.challenge);
      (o.allowCredentials || []).forEach(function (c) { c.id = b64uToBuf(c.id); });
      return navigator.credentials.get({ publicKey: o });
    }).then(function (cred) {
      return api('/auth/pk/auth-verify', {
        pre: pre,
        credential: {
          id: cred.id,
          authenticatorData: bufToB64u(cred.response.authenticatorData),
          clientDataJSON: bufToB64u(cred.response.clientDataJSON),
          signature: bufToB64u(cred.response.signature)
        }
      });
    }).then(function (r) {
      if (r.status !== 200 || !r.body.token) throw new Error('パスキー認証に失敗しました');
      TOKEN = r.body.token;
      try { sessionStorage.setItem('adm', TOKEN); } catch (e) {}
      enterEditor();
    }).catch(function (e) {
      say('pkStatus', e && e.name === 'NotAllowedError' ? 'キャンセルされました' : (e.message || '認証に失敗しました'), 'err');
    });
  }

  $('logout').addEventListener('click', function () {
    api('/auth/logout').then(function () {}, function () {}).then(function () {
      dropSession();
      show('login');
    });
  });

  function enterEditor() {
    show('editor');
    $('modeBadge').textContent = useApi ? '即時更新モード' : 'ファイル方式';
    $('note').textContent = useApi
      ? '「更新する」を押すとすぐにサイトへ反映されます。'
      : '「更新する」を押すと新しい hitokoto.json がダウンロードされます。サイトのファイルに上書きして再アップロードすると反映されます。';
    $('logout').hidden = !useApi;
    $('pkManage').hidden = !useApi;
    load();
    if (useApi) loadPasskeys();
  }

  // ---- 起動 ----
  (function start() {
    if (!useApi) return enterEditor();   // ファイル方式（API未設定）はログイン不要

    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    var s = h.get('s'), p = h.get('p'), err = h.get('error');
    if (location.hash) history.replaceState(null, '', location.pathname);   // URLからトークンを消す

    $('gbtn').href = API + '/auth/start';

    if (s) {
      TOKEN = s;
      try { sessionStorage.setItem('adm', s); } catch (e) {}
      return enterEditor();
    }
    if (p) {
      show('pk');
      $('pkBtn').addEventListener('click', function () { authWithPasskey(p); });
      return;
    }
    if (TOKEN) {
      // 保存済みのログインが有効か確認してから入る
      return api('/auth/pk/list').then(function (r) {
        if (r.status === 200) return enterEditor();
        dropSession();
        show('login');
      }).catch(function () { show('login'); });
    }
    show('login');
    if (err) {
      var msgs = {
        denied: 'このGoogleアカウントでは入れません',
        state: 'ログインの有効期限が切れました。もう一度お試しください',
        google: 'Googleとの通信に失敗しました。もう一度お試しください',
        blocked: '試行回数が多すぎます。しばらく待ってね'
      };
      say('loginStatus', msgs[err] || 'ログインに失敗しました', 'err');
    }
  })();
})();
