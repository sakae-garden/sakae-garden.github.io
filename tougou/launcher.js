/*
 * 統合アプリ ランチャー（指示 20260925-092900）
 *
 * - 最初の画面はホーム画面のようなアイコンの並び。横にめくると種類が切り替わる（3ページ）。
 * - 何をどのページに置くか・だれに見せるかは下の LAUNCHER_PAGES 1か所で決める。
 * - ログインは統合API（GAS doPost）の auth.employees／auth.login。トークンは URL ではなく localStorage に持つ。
 * - 既存の配達アプリ（配達日報など）は作り直さず、同じ窓でそのまま開く。
 *   manifest の scope を "/" にしてあるので、sakae-garden.github.io 配下へ移っても全画面のまま。
 *
 * Node からも読めるように（tests/launcher_test.js）、DOM に触るのは init() の中だけ。
 */
(function (root) {
  'use strict';

  // API・セッションは全画面共通の js/common.js（指示 20260925-093100）
  var C = (typeof module !== 'undefined' && module.exports) ? require('./js/common.js') : root.TougouCommon;
  var API_URL = C.API_URL;
  var LS_PAGE = 'tougou.lastPage';

  var ALL = ['従業員', '管理者', '代表'];
  var MGR = ['管理者', '代表'];
  var REP = ['代表'];

  /*
   * ページとアイコンの割り当て（杉さんが確認して直す前提の案）。
   *   roles … そのページ／アイコンを見せる権限。ページの roles に入っていない人にはページごと出さない。
   *   url   … 無いものは「準備中」。
   *   note  … アイコンの下の小さい注記。
   */
  //   配達系の3つは既存の画面を同じ窓でそのまま開く（作り直さない）。
  //   別タブ（target=_blank）はホーム画面アプリから外のブラウザに飛び、埋め込み（iframe）は各画面の
  //   固定フッター・「🏠 ホームに戻る」が枠の中で動くので採らない（結果報告 20260925_Pages方式への変更_結果.md）。
  //   袋出し記録（/nippo/fukurodashi.html）は休止中なので置かない。
  var LAUNCHER_PAGES = [
    {
      id: 'haitatsu', label: '配達', roles: ALL,
      apps: [
        { id: 'nippo',    name: '配達日報',         icon: 'ti-clipboard-list', color: 'green',  url: '/nippo/',              roles: ALL },
        { id: 'summary',  name: '配達日報サマリー', icon: 'ti-chart-bar',      color: 'blue',   url: '/nippo/summary.html',  roles: ALL },
        { id: 'shouhin',  name: '配達商品情報',     icon: 'ti-package',        color: 'purple', url: '/nippo/haitatsu.html', roles: ALL }
      ]
    },
    {
      id: 'kanri', label: '管理', roles: MGR,
      apps: [
        { id: 'oroshi',   name: '卸販売',       icon: 'ti-building-store', color: 'orange', url: '/oroshi.html',                      roles: MGR },
        { id: 'shift',    name: '袋詰めシフト', icon: 'ti-calendar-user',  color: 'teal',   url: '/eigarden-shift-app/',              roles: MGR },
        { id: 'saibai',   name: '栽培シフト',   icon: 'ti-calendar',       color: 'green',  url: '/eigarden-shift-app/saibai.html',   roles: MGR },
        { id: 'keiei',    name: '経営',         icon: 'ti-report-money',   color: 'blue',   url: null,                                roles: REP },
        { id: 'settei',   name: '設定',         icon: 'ti-settings',       color: 'gray',   url: null,                                roles: REP }
      ]
    },
    {
      id: 'saibai', label: '栽培・収穫', roles: ALL,
      apps: [
        { id: 'kyou',     name: '今日',         icon: 'ti-sun',            color: 'teal',   url: 'kyou.html',   roles: ALL, note: 'やること・入力・出勤' },
        { id: 'seisan',   name: '生産入力',     icon: 'ti-plant-2',        color: 'green',  url: 'seisan.html', roles: ALL, note: '袋出し・浸水・収穫' },
        { id: 'keikaku',  name: '計画',         icon: 'ti-calendar-event', color: 'orange', url: null,      roles: ALL },
        { id: 'yosoku',   name: '予測',         icon: 'ti-trending-up',    color: 'blue',   url: 'yosoku.html', roles: ALL, note: '見込み・警告' },
        { id: 'kinshou',  name: '菌床',         icon: 'ti-mushroom',       color: 'purple', url: null,      roles: REP }
      ]
    }
  ];

  /** その権限で見えるページとアイコンだけに絞る。空になったページは出さない。 */
  function visiblePages(role) {
    var out = [];
    LAUNCHER_PAGES.forEach(function (p) {
      if (p.roles.indexOf(role) < 0) return;
      var apps = p.apps.filter(function (a) { return a.roles.indexOf(role) >= 0; });
      if (!apps.length) return;
      out.push({ id: p.id, label: p.label, apps: apps });
    });
    return out;
  }

  var callApi = C.callApi, loadSession = C.loadSession, saveSession = C.saveSession, clearSession = C.clearSession, esc = C.esc;

  function isStandalone() {
    return (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) || root.navigator.standalone === true;
  }

  // ---------------------------------------------------------------- 画面

  function init() {
    var doc = root.document;
    var $ = function (id) { return doc.getElementById(id); };
    var session = loadSession();
    var pages = [];
    var installEvt = null;

    startClock($);

    root.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      installEvt = e;
      renderInstallHint();
    });

    if (session && session.token) {
      renderLauncher();
      // 画面はすぐ出し、裏でセッションを確かめる（切れていたらログインへ）。通信できないときは手元の情報のまま。
      callApi({ action: 'auth.whoami', token: session.token }).then(function (res) {
        if (res && res.ok) {
          session.role = res.session.role || session.role;
          session.name = res.session.name || session.name;
          saveSession(session);
          renderLauncher();
        } else if (res && res.code === 'AUTH') {
          clearSession(); session = null;
          showLogin('ログインの有効期限が切れました。もう一度名前を選んでください。');
        }
      }).catch(function () { /* 圏外など。手元の権限で表示を続ける */ });
    } else {
      showLogin('');
    }

    // --- ランチャー
    function renderLauncher() {
      $('login').hidden = true;
      $('launcher').hidden = false;
      pages = visiblePages(session.role);

      $('who').textContent = session.name + '（' + session.role + '）';

      var track = $('pages');
      track.innerHTML = pages.map(function (p) {
        return '<section class="page" data-page="' + esc(p.id) + '" aria-label="' + esc(p.label) + '">' +
          '<div class="grid">' + p.apps.map(appHtml).join('') + '</div></section>';
      }).join('');

      $('tabs').innerHTML = pages.map(function (p, i) {
        return '<button type="button" class="ptab" data-i="' + i + '">' + esc(p.label) + '</button>';
      }).join('');
      $('dots').innerHTML = pages.map(function () { return '<span class="dot"></span>'; }).join('');

      Array.prototype.forEach.call($('tabs').querySelectorAll('.ptab'), function (b) {
        b.onclick = function () { goPage(Number(b.dataset.i), true); };
      });
      Array.prototype.forEach.call(track.querySelectorAll('.app'), bindApp);

      track.onscroll = onScroll;
      var last = localStorage.getItem(LS_PAGE);
      var idx = 0;
      pages.forEach(function (p, i) { if (p.id === last) idx = i; });
      goPage(idx, false);
      renderInstallHint();
    }

    function appHtml(a) {
      var wip = !a.url;
      return '<a class="app' + (wip ? ' wip' : '') + '" data-color="' + esc(a.color) + '" href="' + (wip ? '#' : esc(a.url)) + '"' +
        ' data-name="' + esc(a.name) + '">' +
        '<i class="icon ti ' + esc(a.icon) + '" aria-hidden="true"></i>' +
        '<span class="name">' + esc(a.name) + '</span>' +
        (a.note ? '<span class="note">' + esc(a.note) + '</span>' : '') +
        (wip ? '<div class="overlay"><span>準備中</span></div>' : '') +
        '</a>';
    }

    function bindApp(a) {
      a.addEventListener('click', function (e) {
        ripple(a, e);
        if (a.classList.contains('wip')) {
          e.preventDefault();
          toast(a.dataset.name + 'は準備中です');
        }
      });
    }

    function goPage(i, smooth) {
      var track = $('pages');
      var w = track.clientWidth;
      if (track.scrollTo) track.scrollTo({ left: i * w, behavior: smooth ? 'smooth' : 'auto' });
      else track.scrollLeft = i * w;
      markPage(i);
    }

    var scrollTimer = null;
    function onScroll() {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () {
        var track = $('pages');
        var i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        markPage(Math.max(0, Math.min(pages.length - 1, i)));
      }, 60);
    }

    function markPage(i) {
      Array.prototype.forEach.call($('tabs').children, function (b, k) { b.classList.toggle('on', k === i); });
      Array.prototype.forEach.call($('dots').children, function (d, k) { d.classList.toggle('on', k === i); });
      if (pages[i]) localStorage.setItem(LS_PAGE, pages[i].id);
    }

    // 画面の向きや幅が変わったら今のページに合わせ直す
    root.addEventListener('resize', function () {
      if (!pages.length) return;
      var i = 0;
      Array.prototype.forEach.call($('tabs').children, function (b, k) { if (b.classList.contains('on')) i = k; });
      goPage(i, false);
    });

    $('logout').onclick = function () {
      if (!root.confirm('ログアウトしますか？')) return;
      var t = session && session.token;
      clearSession(); session = null;
      if (t) callApi({ action: 'auth.logout', token: t }).catch(function () {});
      showLogin('ログアウトしました。');
    };

    // --- ログイン
    var selected = null;
    function showLogin(msg) {
      $('launcher').hidden = true;
      $('login').hidden = false;
      $('loginMsg').textContent = msg || '';
      $('loginMsg').hidden = !msg;
      $('names').innerHTML = '<div class="loading">名前を読み込んでいます…</div>';
      $('passWrap').hidden = true;
      $('loginBtn').disabled = true;
      selected = null;
      callApi({ action: 'auth.employees' }).then(function (res) {
        if (!res || !res.ok) throw new Error(res && res.error || '読み込めませんでした');
        $('names').innerHTML = res.employees.map(function (e) {
          return '<button type="button" class="name-btn" data-id="' + esc(e.id) + '" data-pass="' + (e.needsPasscode ? '1' : '') + '">' +
            esc(e.name) + (e.needsPasscode ? '<span class="lock">パスコード</span>' : '') + '</button>';
        }).join('');
        Array.prototype.forEach.call($('names').querySelectorAll('.name-btn'), function (b) {
          b.onclick = function () {
            Array.prototype.forEach.call($('names').children, function (x) { x.classList.remove('sel'); });
            b.classList.add('sel');
            selected = { id: b.dataset.id, pass: b.dataset.pass === '1' };
            $('passWrap').hidden = !selected.pass;
            $('pass').value = '';
            $('loginBtn').disabled = false;
            if (selected.pass) $('pass').focus();
          };
        });
      }).catch(function (err) {
        $('names').innerHTML = '<div class="loading err">名前の一覧を読み込めませんでした。電波の良い所で開き直してください。<br>' + esc(err.message) + '</div>';
      });
    }

    $('loginBtn').onclick = function () {
      if (!selected) return;
      var btn = $('loginBtn');
      btn.disabled = true;
      btn.textContent = '確認しています…';
      callApi({ action: 'auth.login', empId: selected.id, passcode: selected.pass ? $('pass').value : '' }).then(function (res) {
        if (!res || !res.ok) throw new Error(res && res.error || 'ログインできませんでした');
        session = { token: res.token, role: res.role, name: res.name };
        saveSession(session);
        renderLauncher();
      }).catch(function (err) {
        $('loginMsg').textContent = err.message;
        $('loginMsg').hidden = false;
      }).then(function () {
        btn.disabled = false;
        btn.textContent = 'はじめる';
      });
    };

    // --- ホーム画面への追加の案内（全画面で開いているときは出さない）
    function renderInstallHint() {
      var box = $('install');
      if (isStandalone()) { box.hidden = true; return; }
      box.hidden = false;
      $('installBtn').hidden = !installEvt;
      $('installBtn').onclick = function () {
        if (!installEvt) return;
        installEvt.prompt();
        installEvt = null;
      };
    }

    function ripple(a, e) {
      var rect = a.getBoundingClientRect();
      var r = doc.createElement('span');
      r.className = 'ripple';
      var size = Math.max(rect.width, rect.height) * 2;
      r.style.width = r.style.height = size + 'px';
      r.style.left = (e.clientX - rect.left - size / 2) + 'px';
      r.style.top = (e.clientY - rect.top - size / 2) + 'px';
      a.appendChild(r);
      setTimeout(function () { r.remove(); }, 500);
    }

    var toastTimer;
    function toast(msg) {
      var t = $('toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2500);
    }
  }

  function startClock($) {
    function tick() {
      var now = new Date();
      var p2 = function (n) { return String(n).padStart(2, '0'); };
      var wd = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
      $('clock-date').textContent = now.getFullYear() + '.' + p2(now.getMonth() + 1) + '.' + p2(now.getDate()) + ' (' + wd + ')';
      $('clock-time').textContent = p2(now.getHours()) + ':' + p2(now.getMinutes());
    }
    tick();
    setInterval(tick, 10000);
  }

  var api = { LAUNCHER_PAGES: LAUNCHER_PAGES, visiblePages: visiblePages, API_URL: API_URL, init: init };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TougouLauncher = api;
})(typeof window !== 'undefined' ? window : globalThis);
