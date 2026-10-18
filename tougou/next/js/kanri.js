/*
 * 管理の画面（next/kanri.html・yosoku.html・kyou.html・seisan.html・reizouko.html）の共通部品
 * （統合アプリ完成 B。設計 2・4章）
 *
 *   boot(start)       … SgLogin.initKanri()（js/login.js）で代表・管理者のセッションを得てから start(session)
 *   loadForecast(api) … 予測を事前計算（yosoku.precomputed）から読む。古い GAS（BAD_REQUEST）なら yosoku.forecast
 *   refresh(api)      … その場で計算し直す（yosoku.refresh）。古い GAS なら yosoku.forecast {fresh:true}
 *   needsRefresh(r)   … 30分を超えた／鮮度が分からない事前計算なら true（デモ・古い GAS は false）
 *   freshText(r, o)   … 「最終計算 M/D HH:MM（N分前・計算 S秒）」（o.short で「最終計算 HH:MM（N分前）」）
 *   hookSaves(C)      … 生産の保存が成功したら、裏で yosoku.refresh を1回だけ呼ぶ（入力直後はその画面だけ即時計算）
 *
 * DOM に触らない。Node からも読める（tests/next_kanri_test.js）。
 */
(function (root) {
  'use strict';

  var STALE_MIN = 30;   // 事前計算の間隔（30分おき）。これを超えたら裏で計算し直す

  // 予測に効く保存（成功したら裏で計算し直す）。today.setPlan は表示の上書きだけなので含めない
  var SAVE_ACTIONS = {
    'production.upsert': 1, 'production.upsertMany': 1, 'production.add': 1, 'production.none': 1,
    'production.cancel': 1, 'production.planSet': 1, 'production.planSetMany': 1
  };

  function isUnknownAction(err) { return !!(err && err.code === 'BAD_REQUEST'); }

  /** 事前計算を読む。新しい action を知らない GAS なら従来の yosoku.forecast（r.fallback=true）。 */
  function loadForecast(api) {
    return api('yosoku.precomputed').then(null, function (err) {
      if (!isUnknownAction(err)) throw err;
      return api('yosoku.forecast').then(function (r) { r.fallback = true; return r; });
    });
  }

  /** その場で計算し直す。古い GAS なら yosoku.forecast {fresh:true}。 */
  function refresh(api) {
    return api('yosoku.refresh').then(null, function (err) {
      if (!isUnknownAction(err)) throw err;
      return api('yosoku.forecast', { fresh: true }).then(function (r) { r.fallback = true; return r; });
    });
  }

  function needsRefresh(r, demo) {
    if (!r || r.fallback || demo) return false;
    var pre = r.pre;
    if (!pre || !pre.source) return true;
    if (pre.source === 'demo') return false;
    return !(typeof pre.ageMin === 'number' && isFinite(pre.ageMin)) || pre.ageMin > STALE_MIN;
  }

  function p2(n) { return ('0' + n).slice(-2); }
  function ago(min) {
    if (!(min >= 0)) return '';
    min = Math.round(min);
    if (min < 1) return '1分以内';
    if (min < 60) return min + '分前';
    if (min < 60 * 24) return Math.floor(min / 60) + '時間' + (min % 60 ? (min % 60) + '分' : '') + '前';
    return Math.floor(min / 1440) + '日前';
  }

  /**
   * 鮮度の一言。r は予測の応答（r.pre を見る。古い GAS なら r.generatedAt）。
   * o.short … 管理メニューの1行（日付・計算秒を省く）
   */
  function freshText(r, o) {
    o = o || {};
    if (!r) return '最終計算 不明';
    var pre = r.pre;
    if (!pre || !pre.at) {
      return r.generatedAt ? '計算 ' + r.generatedAt + (r.fallback ? '（事前計算なし）' : '') : '最終計算 不明';
    }
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(pre.at));
    var when = m ? (o.short ? '' : Number(m[2]) + '/' + Number(m[3]) + ' ') + m[4] + ':' + m[5] : String(pre.at);
    var parts = [];
    var a = ago(pre.ageMin);
    if (a) parts.push(a);
    if (!o.short && typeof pre.calcSec === 'number' && isFinite(pre.calcSec)) {
      parts.push('計算 ' + (pre.calcSec < 10 ? Math.round(pre.calcSec * 10) / 10 : Math.round(pre.calcSec)) + '秒');
    }
    if (pre.source === 'demo') parts.push('デモ');
    if (pre.busy) parts.push('ほかで計算中');
    return '最終計算 ' + when + (parts.length ? '（' + parts.join('・') + '）' : '');
  }

  /**
   * C.api を包み、SAVE_ACTIONS の保存が成功したら裏で yosoku.refresh を呼ぶ。
   * 続けて保存したときは最後の保存から delay ms 待って1回だけ。実行中にまた保存されたら終わってからもう1回。
   * 失敗は無視（画面を止めない）。デモでは呼ばない（デモの保存はサーバがキャッシュを消す。Api_handle_）。
   * 戻り値 { fire(), pending() }（テスト用）
   */
  function hookSaves(C, opts) {
    opts = opts || {};
    var delay = opts.delay == null ? 1500 : opts.delay;
    var setT = opts.setTimeout || setTimeout, clearT = opts.clearTimeout || clearTimeout;
    var orig = C.api;
    var timer = null, running = false, again = false;
    function run() {
      timer = null;
      if (running) { again = true; return; }
      running = true; again = false;
      var done = function () {
        running = false;
        if (opts.onDone) opts.onDone();
        if (again) fire();
      };
      refresh(orig).then(done, done);
    }
    function fire() {
      if (C.DEMO) return;
      if (timer) clearT(timer);
      timer = setT(run, delay);
    }
    C.api = function (action) {
      var p = orig.apply(this, arguments);
      if (SAVE_ACTIONS[action]) p.then(function () { fire(); }, function () { /* 保存の失敗は画面が出す */ });
      return p;
    };
    return { fire: fire, pending: function () { return !!timer || running; } };
  }

  /** ログインしてから start(session)。ログイン部品（js/login.js）が無いときは画面に一言出す。 */
  function boot(start) {
    var L = root.SgLogin;
    if (!L || !L.initKanri) {
      var doc = root.document, el = doc && (doc.getElementById('msg') || doc.body);
      if (el) el.insertAdjacentHTML('afterbegin', '<div class="notice ng">ログインの部品（js/login.js）を読み込めませんでした。再読み込みしてください。</div>');
      return;
    }
    L.initKanri().then(start, function () { /* 権限なし・中止は login.js が自分で表示する */ });
  }

  var api_ = {
    STALE_MIN: STALE_MIN, SAVE_ACTIONS: SAVE_ACTIONS,
    loadForecast: loadForecast, refresh: refresh, needsRefresh: needsRefresh, freshText: freshText, ago: ago,
    hookSaves: hookSaves, boot: boot
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api_;
  else root.SgKanri = api_;
})(typeof window !== 'undefined' ? window : globalThis);
