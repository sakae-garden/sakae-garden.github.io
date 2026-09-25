/*
 * 統合アプリ 共通部品（指示 20260925-093100 B）
 *
 * 全画面で使い回す。配達日報・配達商品情報で実際に使っている作法をそのまま持ってきた。
 *   callApi / api    … 統合API（GAS doPost）を fetch で呼ぶ。text/plain なので CORS のプリフライトが起きない
 *   セッション        … ランチャーでログインしたトークンを localStorage（tougou.session）で共有
 *   requireSession   … 未ログインならランチャー（ログイン画面）へ戻す
 *   readNum          … 全角数字・カンマを直して数値に（空欄は null、読めなければ NaN）
 *   showLoading / toast … 日報と同じ「送信中...」の覆いとトースト
 *   runOnce          … 二重送信防止。実行中はボタンを止めて文言を変え、終わったら戻す
 *   guardUnsaved     … 未保存入力の保護（配達商品情報の3層と同じ考え方）
 *                        層1 下書きを端末に退避（入力のたび／visibilitychange hidden／pagehide）
 *                        層2 離脱の警告（アプリ内リンクは自前モーダル、タブを閉じる等は beforeunload）
 *                        常時 フッター直上の未保存バー（保存ボタン付き）
 *                        層3 次に開いたとき下書きがあれば「復元／破棄」のバナー
 *                      自動送信はしない（サーバに書くのは人が保存を押したときだけ。臨時品目の事故の教訓）。
 *
 * DOM に触るのは関数を呼んだときだけ。Node からも読める（tests/）。
 */
(function (root) {
  'use strict';

  var API_URL = 'https://script.google.com/macros/s/AKfycbyBmn2pqcl8I_LYaCBzhDxStm10mW5cx-NLjUP4Ks4TOMQKTKjysdmcMZoWpNNvLXKr/exec';
  var LS_SESSION = 'tougou.session';   // { token, role, name }
  var LAUNCHER_URL = './';              // ランチャー（同じフォルダの index.html）

  // ---------------------------------------------------------------- API・セッション

  /** 統合API を呼ぶ。応答の JSON をそのまま返す（{ ok, ... }）。通信失敗は reject。 */
  function callApi(req) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(req),
      redirect: 'follow'
    }).then(function (r) { return r.json(); });
  }

  function loadSession() {
    try { return JSON.parse(root.localStorage.getItem(LS_SESSION) || 'null'); } catch (e) { return null; }
  }
  function saveSession(s) { root.localStorage.setItem(LS_SESSION, JSON.stringify(s)); }
  function clearSession() { root.localStorage.removeItem(LS_SESSION); }

  /** ログインしていなければランチャーへ。していればセッションを返す。 */
  function requireSession() {
    var s = loadSession();
    if (!s || !s.token) { root.location.replace(LAUNCHER_URL); return null; }
    return s;
  }

  /**
   * トークンを付けて呼ぶ。セッション切れ（code=AUTH）ならランチャーのログインへ戻す。
   * 応答が ok:false のときは Error（message=サーバの文言）で reject する。通信失敗は err.network=true。
   */
  function api(action, params) {
    var s = loadSession() || {};
    var req = { action: action, token: s.token };
    if (params) for (var k in params) req[k] = params[k];
    return callApi(req).then(function (res) {
      if (res && res.ok) return res;
      if (res && res.code === 'AUTH') {
        clearSession();
        root.location.replace(LAUNCHER_URL);
      }
      var e = new Error((res && res.error) || 'サーバがエラーを返しました。');
      e.code = res && res.code;
      throw e;
    }, function (err) {
      var e = new Error('通信できませんでした（' + (err && err.message || err) + '）');
      e.network = true;
      throw e;
    });
  }

  // ---------------------------------------------------------------- 小物

  function readNum(v) {
    var s = String(v == null ? '' : v)
      .replace(/[０-９．]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[,，\s]/g, '');
    if (s === '') return null;
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ymd(d) {
    var p2 = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function nowStamp() {
    var d = new Date(), p2 = function (n) { return String(n).padStart(2, '0'); };
    return ymd(d) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  /** 日報ヘッダーと同じ日付表記（2026年9月25日（木）） */
  function jpDate(d) {
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + '日月火水木金土'.charAt(d.getDay()) + '）';
  }

  // 日報の showLoading / hideLoading と同じ
  function showLoading(msg) {
    var doc = root.document, el = doc.getElementById('lo');
    if (el) return;
    el = doc.createElement('div');
    el.id = 'lo'; el.className = 'loading-overlay';
    el.innerHTML = '<div class="loading-box"><div class="spinner"></div><br>' + esc(msg || '送信中...') + '</div>';
    doc.body.appendChild(el);
  }
  function hideLoading() {
    var el = root.document.getElementById('lo');
    if (el) el.parentNode.removeChild(el);
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var doc = root.document, t = doc.getElementById('toast');
    if (!t) {
      var wrap = doc.createElement('div'); wrap.className = 'toast';
      t = doc.createElement('div'); t.className = 'toast-inner'; t.id = 'toast';
      wrap.appendChild(t); doc.body.appendChild(wrap);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2500);
  }

  /**
   * 二重送信防止。実行中にもう一度呼ばれても何もしない（false を返す）。
   * btn があれば止めて文言を busyText に変え、終わったら戻す。fn は Promise を返すこと。
   */
  var running = {};
  function runOnce(key, btn, busyText, fn) {
    if (running[key]) return false;
    running[key] = true;
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; if (busyText) btn.textContent = busyText; }
    var done = function () {
      running[key] = false;
      if (btn) { btn.disabled = false; btn.textContent = label; }
    };
    Promise.resolve().then(fn).then(done, function (e) { done(); throw e; });
    return true;
  }
  function isRunning(key) { return !!running[key]; }

  // ---------------------------------------------------------------- 未保存入力の保護

  /**
   * opts:
   *   key        … 下書きの localStorage キー
   *   isDirty()  … 未保存の変更があるか
   *   snapshot() … 下書きとして残す中身（JSON にできるもの）
   *   restore(d) … 下書きを画面の欄に戻す（サーバへは送らない）
   *   save()     … 保存。Promise。成功で resolve
   *   maxAgeDays … これより古い下書きは捨てる（既定 1＝当日・前日のみ。日報と同じ）
   *   bannerHost … 下書きバナーを差し込む要素
   *   linkSelector … 離脱を捕まえるアプリ内リンク（既定 '.footer a, .back-btn'）
   * 戻り値：{ changed(), setState(st), clearDraft(), leaving() }
   *   st … '' / 'saving' / 'failed' / 'unknown'（保存できない／確認できない を分ける。日報と同じ方針）
   */
  function guardUnsaved(opts) {
    var doc = root.document;
    var maxAge = opts.maxAgeDays == null ? 1 : opts.maxAgeDays;
    var state = '';
    var leavingNow = false;
    var timer = null;

    // 固定バー（フッター直上）
    var bar = doc.createElement('div');
    bar.className = 'unsaved-bar'; bar.hidden = true;
    bar.innerHTML = '<div class="unsaved-lbl"></div><button type="button" class="submit-btn">💾 保存する</button>';
    doc.body.appendChild(bar);
    var lbl = bar.querySelector('.unsaved-lbl');
    var barBtn = bar.querySelector('button');
    barBtn.onclick = function () { opts.save(); };

    function writeDraftNow() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (!opts.isDirty()) return;
      try {
        root.localStorage.setItem(opts.key, JSON.stringify({ day: ymd(new Date()), at: nowStamp(), data: opts.snapshot() }));
      } catch (e) { /* 容量超などは無視。バーと警告は残る */ }
    }
    function clearDraft() {
      if (timer) { clearTimeout(timer); timer = null; }
      try { root.localStorage.removeItem(opts.key); } catch (e) { /* 無視 */ }
    }
    function readDraft() {
      try {
        var o = JSON.parse(root.localStorage.getItem(opts.key) || 'null');
        if (!o || !o.data) return null;
        var age = (new Date(ymd(new Date())) - new Date(o.day)) / 86400000;
        if (!(age >= 0 && age <= maxAge)) { clearDraft(); return null; }
        return o;
      } catch (e) { return null; }
    }

    function render() {
      var dirty = opts.isDirty();
      var show = dirty || state !== '';
      bar.hidden = !show;
      bar.className = 'unsaved-bar' + (state ? ' sb-' + state : '');
      if (dirty) {
        lbl.textContent = state === 'saving' ? '● 保存中…'
          : state === 'failed' ? '⚠ 保存できませんでした・未保存'
          : state === 'unknown' ? '⚠ 保存を確認できませんでした'
          : '● 未保存';
        barBtn.hidden = state === 'saving';
        barBtn.textContent = (state === 'failed' || state === 'unknown') ? '🔄 再送する' : '💾 保存する';
      } else if (state === 'saving') {
        lbl.textContent = '● 保存中…'; barBtn.hidden = true;
      } else {
        bar.hidden = true;
      }
      doc.body.classList.toggle('has-unsaved', !bar.hidden);
    }

    /** 入力が変わるたびに呼ぶ。下書きは 300ms 間引いて書く。 */
    function changed() {
      if (state === 'failed' || state === 'unknown') state = '';
      if (opts.isDirty()) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(writeDraftNow, 300);
      } else {
        clearDraft();
      }
      render();
    }
    function setState(st) {
      state = st || '';
      if (!state && !opts.isDirty()) clearDraft();
      render();
    }

    // 層1：確実に発火するのは visibilitychange(hidden) だけ（Android PWA）。pagehide は保険
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') writeDraftNow(); else render();
    });
    root.addEventListener('pagehide', writeDraftNow);
    // 層2：タブを閉じる／戻る／再読み込み（標準ダイアログ。文言は変えられない）
    root.addEventListener('beforeunload', function (e) {
      if (leavingNow || !opts.isDirty()) return;
      writeDraftNow();
      e.preventDefault(); e.returnValue = ''; return '';
    });
    // 層2：アプリ内リンク（🏠 ホームに戻る・← 戻る）は自前モーダル（その場で保存できる）
    Array.prototype.forEach.call(doc.querySelectorAll(opts.linkSelector || '.footer a, .back-btn'), function (a) {
      a.addEventListener('click', function (e) {
        if (!opts.isDirty()) return;
        e.preventDefault();
        leaveModal(a.getAttribute('href'));
      });
    });
    function leaveModal(href) {
      var ov = doc.createElement('div');
      ov.className = 'modal-ov';
      ov.innerHTML = '<div class="modal"><div class="modal-ttl">保存していない入力があります</div>' +
        '<div class="leave-modal-msg">保存せずに移動すると、入力した内容はサーバに反映されません。<br>下書きは端末に残るので、次に開いたときに復元できます。</div>' +
        '<div class="leave-modal-btns">' +
        '<button type="button" class="leave-save">💾 保存してから移動</button>' +
        '<button type="button" class="leave-go">保存せずに移動</button>' +
        '<button type="button" class="leave-cancel">この画面に戻る</button></div></div>';
      doc.body.appendChild(ov);
      var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
      ov.querySelector('.leave-save').onclick = function () {
        close();
        Promise.resolve(opts.save()).then(function (ok) {
          if (ok !== false && !opts.isDirty()) { leavingNow = true; root.location.href = href; }
        });
      };
      ov.querySelector('.leave-go').onclick = function () { close(); writeDraftNow(); leavingNow = true; root.location.href = href; };
      ov.querySelector('.leave-cancel').onclick = close;
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    }

    // 層3：前回の下書き
    function showBanner() {
      var d = readDraft();
      var el = doc.getElementById('draft_notice');
      if (!d) { if (el) el.parentNode.removeChild(el); return; }
      if (!el) {
        el = doc.createElement('div');
        el.id = 'draft_notice'; el.className = 'draft-notice';
        var host = opts.bannerHost || doc.body;
        host.insertBefore(el, host.firstChild);
      }
      el.innerHTML = '📝 保存していない下書きがあります（' + esc(d.at) + '）<br>' +
        '<button type="button" class="dn-restore">復元する</button> <button type="button" class="dn-discard">破棄する</button>';
      el.querySelector('.dn-restore').onclick = function () { el.parentNode.removeChild(el); opts.restore(d.data); changed(); };
      el.querySelector('.dn-discard').onclick = function () { clearDraft(); el.parentNode.removeChild(el); };
    }

    return {
      changed: changed,
      setState: setState,
      clearDraft: clearDraft,
      showBanner: showBanner,
      /** 画面内の切り替え（日付・拠点）の前に。日報の confirmLeaveIfDirty と同じ文言の型 */
      confirmDiscard: function (what) {
        if (!opts.isDirty()) return true;
        return root.confirm('保存していない入力があります。\n保存せずに' + (what || '移動') + 'しますか？');
      }
    };
  }

  var api_ = {
    API_URL: API_URL, LAUNCHER_URL: LAUNCHER_URL, LS_SESSION: LS_SESSION,
    callApi: callApi, api: api, loadSession: loadSession, saveSession: saveSession, clearSession: clearSession,
    requireSession: requireSession, readNum: readNum, esc: esc, ymd: ymd, jpDate: jpDate,
    showLoading: showLoading, hideLoading: hideLoading, toast: toast,
    runOnce: runOnce, isRunning: isRunning, guardUnsaved: guardUnsaved
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api_;
  else root.TougouCommon = api_;
})(typeof window !== 'undefined' ? window : globalThis);
