/*
 * ログインの統一（統合アプリ完成 D。設計 3章）。作業（sagyou.html）と管理（kanri.html ほか）で同じ記憶を使う。
 * 先に js/common.js（TougouCommon）を読み込んでおくこと。
 *
 * localStorage（新しいキーはすべて sg. で始める。旧画面のキー sagyou.* ・tougou.* には書かない）
 *   sg.person        { id, surname, role, entry }  覚えている人。entry＝マスタの入口列（'haitatsu'|'sagyou'|''）
 *   sg.employees     [{ id, name, surname, role, site, entry }]  名簿の控え（next.employees の結果）
 *   sg.session.work  { token, role, name, empId }  作業のトークン（auth.login app:'sagyou'。パスコードなし。権限は従業員に固定）
 *   sg.session.kanri { token, role, name, empId }  管理のトークン（auth.login＋パスコード。role は 代表／管理者）
 *   sg.entry         前回の入口（入口 index.html が書く。ここでは読み書きしない）
 * 初回だけ、sg.person が無く旧作業記録の sagyou.person（{id, surname}）があればそれを使う（旧キーは読むだけ）。
 *
 * SgLogin
 *   person()               覚えている人（無ければ null）
 *   setPerson(p)           覚える。人が変わったら両方のセッションを消す
 *   forget()               人と両方のセッションを消す（名簿の控え・sg.entry は残す）
 *   employees()            名簿の控え（すぐ返す。sg.employees → 旧 sagyou.employees → 埋め込み）
 *   refreshEmployees()     Promise(list)。next.employees（無い古い GAS なら auth.employees）で取り直し、
 *                          控えと覚えている人の surname・role・entry を更新する。通信失敗は reject（控えはそのまま）
 *   pickPerson(opts)       Promise(person)。名字のボタンの一覧（モーダル）。opts.cancelable なら「やめる」（reject code 'CANCEL'）
 *   initWork(opts)         Promise(session|null)。作業のセッション（sg.session.work）で TougouCommon を設定し、
 *                          人がいなければ名字を選ばせる。トークンが無ければログインする（opts.lazy なら待たずに null で返し、
 *                          最初の api 呼び出しのときに裏でログインする）。トークン切れは自動で取り直す
 *   initKanri()            Promise(session)。管理のセッション（sg.session.kanri）で TougouCommon を設定し、
 *                          無ければ覚えている人のパスコードを聞く。代表・管理者でない人は「管理は代表のみ使えます」を出して
 *                          reject（code 'NOT_KANRI'）。トークン切れはパスコードを聞き直して1回だけ呼び直す
 *   logoutKanri()          管理のセッションだけ消す
 *   isKanriRole(role)      代表・管理者か
 *   backLink(el)           「入口へ戻る」。el が <a> なら href を入口にする。それ以外なら中にリンクを足す
 *   ENTRY_URL              'index.html?pick=1'（各画面の「入口へ戻る」の行き先）
 *   KEYS                   上のキーの一覧
 *   ui                     画面の部品（pick・passcode・denied）。テストで差し替える
 *
 * 各画面には js が壊れても動くよう、静的に <a href="index.html?pick=1">入口へ戻る</a> を置く（デモでは common.js が ?demo=1 を足す）。
 */
(function (root) {
  'use strict';

  var KEYS = {
    person: 'sg.person', employees: 'sg.employees', work: 'sg.session.work', kanri: 'sg.session.kanri', entry: 'sg.entry',
    legacyPerson: 'sagyou.person', legacyEmployees: 'sagyou.employees'
  };
  var ENTRY_URL = 'index.html?pick=1';
  var KANRI_ROLES = { '代表': 1, '管理者': 1 };
  var ROLE_EMP = '従業員';

  // 開いた瞬間に名前を出すための控え（統合マスタ 従業員マスタの アプリ利用＝Y の7名。2026-09-26 時点。/sagyou/ と同じ）。
  // 本体はマスタで、裏で取り直して変わっていれば差し替える
  var EMBEDDED = [
    { id: 'EMP000', name: '杉', surname: '杉', role: '代表', site: '', entry: '' },
    { id: 'EMP006', name: '八島', surname: '八島', role: ROLE_EMP, site: '', entry: '' },
    { id: 'EMP007', name: '青柳', surname: '青柳', role: ROLE_EMP, site: '', entry: '' },
    { id: 'EMP008', name: '新井', surname: '新井', role: ROLE_EMP, site: '', entry: '' },
    { id: 'EMP009', name: '佐藤', surname: '佐藤', role: ROLE_EMP, site: '', entry: '' },
    { id: 'EMP014', name: '小林', surname: '小林', role: ROLE_EMP, site: '', entry: '' },
    { id: 'EMP015', name: '新保', surname: '新保', role: ROLE_EMP, site: '', entry: '' }
  ];

  function C() { return root.TougouCommon; }
  function ls() { return root.localStorage; }
  function lsGet(k) { try { return JSON.parse(ls().getItem(k) || 'null'); } catch (e) { return null; } }
  function lsPut(k, v) {
    try { if (v == null) ls().removeItem(k); else ls().setItem(k, JSON.stringify(v)); } catch (e) { /* 容量超など。記憶できないだけ */ }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function err(message, code) { var e = new Error(message); e.code = code; return e; }
  function isKanriRole(role) { return !!KANRI_ROLES[role]; }
  function normEntry(v) { return v === 'haitatsu' || v === 'sagyou' ? v : ''; }
  function surnameOf(e) { return e.surname || String(e.name || '').trim().split(/[\s　]+/)[0] || ''; }
  function entryHref() {
    var c = C();
    return c && c.DEMO && c.demoUrl ? c.demoUrl(ENTRY_URL) : ENTRY_URL;
  }

  // ---------------------------------------------------------------- 人・名簿

  function normPerson(p) {
    return { id: String(p.id), surname: p.surname || surnameOf(p), role: p.role || '', entry: normEntry(p.entry) };
  }

  function person() {
    var p = lsGet(KEYS.person);
    if (p && p.id) return p;
    // 初回だけ旧作業記録の記憶を使う（旧キーには書かない）
    var old = lsGet(KEYS.legacyPerson);
    if (old && old.id) {
      var known = employees().filter(function (e) { return e.id === old.id; })[0];
      p = normPerson({ id: old.id, surname: old.surname || (known && known.surname), role: (known && known.role) || '', entry: (known && known.entry) || '' });
      lsPut(KEYS.person, p);
      return p;
    }
    return null;
  }

  function setPerson(p) {
    var prev = lsGet(KEYS.person);
    var np = normPerson(p);
    if (!prev || prev.id !== np.id) { lsPut(KEYS.work, null); lsPut(KEYS.kanri, null); }
    lsPut(KEYS.person, np);
    return np;
  }

  function forget() {
    lsPut(KEYS.person, null);
    lsPut(KEYS.work, null);
    lsPut(KEYS.kanri, null);
  }

  function employees() {
    var list = lsGet(KEYS.employees);
    if (Array.isArray(list) && list.length) return list;
    var old = lsGet(KEYS.legacyEmployees);
    if (Array.isArray(old) && old.length) {
      return old.map(function (e) {
        var k = EMBEDDED.filter(function (x) { return x.id === e.id; })[0];
        return { id: e.id, name: e.name || e.surname, surname: e.surname || surnameOf(e), role: (k && k.role) || '', site: '', entry: '' };
      });
    }
    return EMBEDDED.slice();
  }

  var refreshP = null;
  function refreshEmployees() {
    if (refreshP) return refreshP;
    var c = C();
    var before = lsGet(KEYS.employees) || [];   // 前に取り直した名簿（埋め込みの控えの権限は推測なので使わない）
    var roleBefore = function (id) { var x = before.filter(function (e) { return e.id === id; })[0]; return x ? x.role : ''; };
    refreshP = c.callApi({ action: 'next.employees' }).then(function (res) {
      if (res && res.ok && Array.isArray(res.employees)) {
        return res.employees.map(function (e) {
          return { id: String(e.id), name: e.name || '', surname: surnameOf(e), role: e.role || ROLE_EMP, site: e.site || '', entry: normEntry(e.entry) };
        });
      }
      // 古い GAS（next.employees が無い）：トークンが無いので AUTH、またはBAD_REQUEST が返る → 今までの auth.employees で取る
      return c.callApi({ action: 'auth.employees' }).then(function (r2) {
        if (!r2 || !r2.ok || !Array.isArray(r2.employees)) throw err((r2 && r2.error) || '名簿を読めませんでした。', r2 && r2.code);
        return r2.employees.map(function (e) {
          // auth.employees は権限を返さない（needsPasscode だけ）。パスコードが要る人＝代表か管理者
          var prev = roleBefore(e.id);
          var role = e.needsPasscode ? (isKanriRole(prev) ? prev : '管理者') : ROLE_EMP;
          return { id: String(e.id), name: e.name || '', surname: surnameOf(e), role: role, site: '', entry: '' };
        });
      });
    }).then(function (list) {
      refreshP = null;
      lsPut(KEYS.employees, list);
      var p = lsGet(KEYS.person) || person();
      if (p) {
        var me = list.filter(function (e) { return e.id === p.id; })[0];
        if (me) lsPut(KEYS.person, normPerson({ id: p.id, surname: me.surname || p.surname, role: me.role, entry: me.entry }));
      }
      return list;
    }, function (e) {
      refreshP = null;
      throw e;
    });
    return refreshP;
  }

  // ---------------------------------------------------------------- 画面の部品（モーダル）

  var CSS = '' +
    '.sg-ov{position:fixed;inset:0;z-index:1000;background:var(--bg,#f5f3ee);overflow-y:auto;-webkit-overflow-scrolling:touch}' +
    '.sg-box{max-width:480px;margin:0 auto;padding:calc(20px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom))}' +
    '.sg-ttl{font-size:17px;font-weight:700;margin:4px 2px 14px;color:var(--ink,#1c1c1e)}' +
    '.sg-sub{font-size:13px;color:var(--sub,#6c6c70);margin:-6px 2px 14px;line-height:1.6}' +
    '.sg-names{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
    '.sg-name{padding:20px 8px;font-size:22px;font-weight:700;letter-spacing:.08em;background:#fff;border:1px solid var(--border,#e5e1d8);' +
      'border-radius:var(--r,12px);box-shadow:var(--shadow,0 2px 12px rgba(0,0,0,.06));font-family:inherit;color:var(--ink,#1c1c1e);cursor:pointer}' +
    '.sg-name:active,.sg-name.sel{background:#edf7f1;border-color:var(--green,#2d7a4f)}' +
    '.sg-card{background:#fff;border:1px solid var(--border,#e5e1d8);border-radius:var(--r,12px);box-shadow:var(--shadow,0 2px 12px rgba(0,0,0,.06));padding:16px}' +
    '.sg-who{font-size:20px;font-weight:700;margin-bottom:12px}' +
    '.sg-pass{width:100%;height:48px;border:1px solid var(--border,#e5e1d8);border-radius:var(--r-btn,8px);padding:0 12px;font-size:20px;font-family:inherit;margin-bottom:12px}' +
    '.sg-pass:focus{outline:none;border-color:var(--ink,#1c1c1e)}' +
    '.sg-go{width:100%;padding:15px;background:var(--green,#2d7a4f);color:#fff;border:none;border-radius:var(--r,12px);font-family:inherit;font-size:16px;font-weight:700;cursor:pointer}' +
    '.sg-go:disabled{opacity:.5}' +
    '.sg-err{background:#fdecea;color:#b71c1c;border:1px solid #ef9a9a;border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;line-height:1.6;margin-bottom:12px}' +
    '.sg-links{display:flex;justify-content:space-between;gap:10px;margin-top:16px;font-size:14px}' +
    '.sg-links a,.sg-links button{color:var(--sub,#6c6c70);background:none;border:none;font-family:inherit;font-size:14px;text-decoration:underline;cursor:pointer;padding:6px 0}' +
    '.sg-back{display:inline-block;color:var(--sub,#6c6c70);font-size:14px;text-decoration:underline;padding:6px 0}';

  function addCss(doc) {
    if (doc.getElementById('sg_login_css')) return;
    var s = doc.createElement('style');
    s.id = 'sg_login_css';
    s.textContent = CSS;
    doc.head.appendChild(s);
  }
  function overlay(html) {
    var doc = root.document;
    addCss(doc);
    var ov = doc.createElement('div');
    ov.className = 'sg-ov';
    ov.setAttribute('role', 'dialog');
    ov.innerHTML = '<div class="sg-box">' + html + '</div>';
    doc.body.appendChild(ov);
    return { el: ov, q: function (sel) { return ov.querySelector(sel); }, close: function () { if (ov.parentNode) ov.parentNode.removeChild(ov); } };
  }

  /** 名字のボタン一覧。resolve(employee) / reject(CANCEL) */
  function uiPick(opts) {
    return new Promise(function (resolve, reject) {
      var m = overlay('<div class="sg-ttl">' + esc(opts.title || '名前を選んでください') + '</div>' +
        (opts.note ? '<div class="sg-sub">' + esc(opts.note) + '</div>' : '') +
        '<div class="sg-names" data-el="names"></div>' +
        '<div class="sg-links"><a href="' + esc(entryHref()) + '">入口へ戻る</a>' +
        (opts.cancelable ? '<button type="button" data-el="cancel">やめる</button>' : '') + '</div>');
      function render(list) {
        var box = m.q('[data-el="names"]');
        box.innerHTML = list.map(function (e) {
          return '<button type="button" class="sg-name" data-id="' + esc(e.id) + '">' + esc(e.surname) + '</button>';
        }).join('');
        Array.prototype.forEach.call(box.children, function (b) {
          b.onclick = function () {
            var e = list.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0];
            m.close();
            resolve(e);
          };
        });
      }
      render(opts.list);
      if (opts.fresh) opts.fresh.then(function (list) { if (m.el.parentNode && list && list.length) render(list); }, function () { /* 控えのまま */ });
      var cb = m.q('[data-el="cancel"]');
      if (cb) cb.onclick = function () { m.close(); reject(err('やめました。', 'CANCEL')); };
    });
  }

  /**
   * パスコードの入力。opts.login(passcode) は Promise（成功で resolve、失敗はサーバの文言で reject）。
   * resolve(ログインの結果) / reject(CHANGE＝名前を変える)
   */
  function uiPasscode(opts) {
    return new Promise(function (resolve, reject) {
      var m = overlay('<div class="sg-ttl">管理に入る</div>' +
        (opts.note ? '<div class="sg-sub">' + esc(opts.note) + '</div>' : '') +
        '<div class="sg-card"><div class="sg-who">' + esc(opts.person.surname) + ' さん</div>' +
        '<div class="sg-err" data-el="err" hidden></div>' +
        '<form data-el="form" autocomplete="off"><input class="sg-pass" type="password" data-el="pass" placeholder="パスコード" autocomplete="current-password">' +
        '<button type="submit" class="sg-go" data-el="go">入る</button></form></div>' +
        '<div class="sg-links"><a href="' + esc(entryHref()) + '">入口へ戻る</a>' +
        '<button type="button" data-el="change">名前を変える</button></div>');
      var pass = m.q('[data-el="pass"]'), go = m.q('[data-el="go"]'), box = m.q('[data-el="err"]');
      try { pass.focus(); } catch (e) { /* 無視 */ }
      m.q('[data-el="form"]').onsubmit = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        go.disabled = true; go.textContent = '確認しています…';
        box.hidden = true;
        opts.login(pass.value).then(function (res) {
          m.close();
          resolve(res);
        }, function (e) {
          go.disabled = false; go.textContent = '入る';
          box.textContent = e.message;   // パスコード違い・ロック中などはサーバの文言のまま
          box.hidden = false;
          pass.value = '';
        });
      };
      m.q('[data-el="change"]').onclick = function () { m.close(); reject(err('名前を変えます。', 'CHANGE')); };
    });
  }

  /** 管理に入れない人。閉じられない（入口へ戻る・名前を変える だけ）。名前を変えたら resolve */
  function uiDenied(opts) {
    return new Promise(function (resolve) {
      var m = overlay('<div class="sg-ttl">管理</div>' +
        '<div class="sg-card"><div class="sg-err">管理は代表のみ使えます</div>' +
        '<div class="sg-sub" style="margin:0">' + esc(opts.person ? opts.person.surname + ' さんは管理の画面を使えません。' : '') + '</div></div>' +
        '<div class="sg-links"><a href="' + esc(entryHref()) + '">入口へ戻る</a>' +
        '<button type="button" data-el="change">名前を変える</button></div>');
      m.q('[data-el="change"]').onclick = function () { m.close(); resolve('change'); };
    });
  }

  var ui = { pick: uiPick, passcode: uiPasscode, denied: uiDenied };

  /** 名字を選ばせて覚える */
  function pickPerson(opts) {
    opts = opts || {};
    var fresh = refreshEmployees();
    fresh.catch(function () { /* 圏外など。控えで選ぶ */ });
    return api.ui.pick({ title: opts.title, note: opts.note, cancelable: !!opts.cancelable, list: employees(), fresh: fresh })
      .then(function (e) {
        // 名簿が取り直せていれば、その値（role・entry）で覚える
        var cur = employees().filter(function (x) { return x.id === e.id; })[0] || e;
        return setPerson(cur);
      });
  }

  // ---------------------------------------------------------------- 作業

  var workLoginP = null;
  function workLogin() {
    if (workLoginP) return workLoginP;
    var p = person();
    var start = p ? Promise.resolve(p) : pickPerson();
    workLoginP = start.then(function (pp) {
      return C().callApi({ action: 'auth.login', empId: pp.id, app: 'sagyou' }).then(function (res) {
        if (!res || !res.ok) throw err((res && res.error) || 'ログインできませんでした。', res && res.code);
        var s = { token: res.token, role: res.role, name: res.surname || pp.surname, empId: pp.id };
        lsPut(KEYS.work, s);
        return s;
      }, function (e) {
        var ne = err('通信できませんでした（' + (e && e.message || e) + '）');
        ne.network = true;
        throw ne;
      });
    }).then(function (s) { workLoginP = null; return s; }, function (e) { workLoginP = null; throw e; });
    return workLoginP;
  }

  function initWork(opts) {
    opts = opts || {};
    C().configure({ sessionKey: KEYS.work, reauth: workLogin, launcherUrl: ENTRY_URL });
    var p = person();
    var start = p ? Promise.resolve(p) : pickPerson();
    return start.then(function (pp) {
      var s = lsGet(KEYS.work);
      if (s && s.token && (!s.empId || s.empId === pp.id)) return s;
      lsPut(KEYS.work, null);
      if (opts.lazy) {
        workLogin().catch(function () { /* 保存・読み込みのときにもう一度取りに行く */ });
        return null;
      }
      return workLogin();
    });
  }

  // ---------------------------------------------------------------- 管理

  function kanriLoginFor(pp) {
    return function (passcode) {
      return C().callApi({ action: 'auth.login', empId: pp.id, passcode: passcode }).then(function (res) {
        if (!res || !res.ok) throw err((res && res.error) || 'ログインできませんでした。', res && res.code);
        if (!isKanriRole(res.role)) {
          // マスタで権限が外れていた（従業員はパスコードなしでログインできてしまう）。セッションは使わない
          var p2 = lsGet(KEYS.person);
          if (p2 && p2.id === pp.id) lsPut(KEYS.person, normPerson({ id: p2.id, surname: p2.surname, role: res.role || ROLE_EMP, entry: p2.entry }));
          throw err('管理は代表のみ使えます', 'NOT_KANRI');
        }
        var s = { token: res.token, role: res.role, name: res.name || pp.surname, empId: pp.id };
        lsPut(KEYS.kanri, s);
        return s;
      }, function (e) {
        var ne = err('通信できませんでした（' + (e && e.message || e) + '）');
        ne.network = true;
        throw ne;
      });
    };
  }

  /** 覚えている人が管理に入れるか確かめてパスコードを聞く。名前を変えたらやり直す */
  function kanriFlow(note) {
    var p = person();
    var start = p ? Promise.resolve(p) : pickPerson({ note: '管理に入る人を選んでください。' });
    return start.then(function (pp) {
      // 権限がまだ分からない（旧画面からの引き継ぎ・名簿を取り直していない）ときは名簿を取り直してから判断する
      var check = pp.role ? Promise.resolve(pp) : refreshEmployees().then(function () { return person() || pp; }, function () { return pp; });
      return check.then(function (p2) {
        if (p2.role && !isKanriRole(p2.role)) return denied(p2);
        return api.ui.passcode({ person: p2, note: note, login: kanriLoginFor(p2) }).then(null, function (e) {
          if (e && e.code === 'CHANGE') return pickPerson({ cancelable: true }).then(function () { return kanriFlow(note); }, function () { return kanriFlow(note); });
          throw e;
        });
      });
    });
  }
  function denied(p) {
    var shown = api.ui.denied({ person: p });
    // 画面は出したまま reject（呼び出し側は以降の読み込みをしない）。名前を変えたらページを読み直す
    Promise.resolve(shown).then(function (r) {
      if (r === 'change') pickPerson({ cancelable: true }).then(function () { if (root.location && root.location.reload) root.location.reload(); }, function () {
        if (root.location && root.location.reload) root.location.reload();
      });
    });
    return Promise.reject(err('管理は代表のみ使えます', 'NOT_KANRI'));
  }

  var kanriReauthP = null;
  function kanriReauth() {
    if (kanriReauthP) return kanriReauthP;
    kanriReauthP = kanriFlow('ログインの有効期限が切れました。もう一度パスコードを入れてください。')
      .then(function (s) { kanriReauthP = null; return s; }, function (e) { kanriReauthP = null; throw e; });
    return kanriReauthP;
  }

  function initKanri() {
    C().configure({ sessionKey: KEYS.kanri, reauth: kanriReauth, launcherUrl: ENTRY_URL });
    var p = person();
    var s = lsGet(KEYS.kanri);
    if (p && s && s.token && isKanriRole(s.role) && (!s.empId || s.empId === p.id) && (!p.role || isKanriRole(p.role))) {
      return Promise.resolve(s);
    }
    if (p && p.role && !isKanriRole(p.role)) { lsPut(KEYS.kanri, null); return denied(p); }
    lsPut(KEYS.kanri, null);
    return kanriFlow('');
  }

  function logoutKanri() { lsPut(KEYS.kanri, null); }

  // ---------------------------------------------------------------- 入口へ戻る

  function backLink(el) {
    if (!el) return null;
    if (String(el.tagName).toUpperCase() === 'A') { el.setAttribute('href', ENTRY_URL); return el; }
    var a = root.document.createElement('a');
    a.className = 'sg-back';
    a.setAttribute('href', ENTRY_URL);
    a.textContent = '入口へ戻る';
    el.appendChild(a);
    return a;
  }

  var api = {
    KEYS: KEYS, ENTRY_URL: ENTRY_URL, EMBEDDED: EMBEDDED,
    person: person, setPerson: setPerson, forget: forget,
    employees: employees, refreshEmployees: refreshEmployees, pickPerson: pickPerson,
    initWork: initWork, initKanri: initKanri, logoutKanri: logoutKanri,
    isKanriRole: isKanriRole, backLink: backLink, ui: ui
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SgLogin = api;
})(typeof window !== 'undefined' ? window : globalThis);
