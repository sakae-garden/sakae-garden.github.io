/*
 * 本日の指示バーの枠（統合アプリ完成 E）。配達・作業の画面の最上部 <div id="shiji" class="shiji-slot"> に載せる。
 *
 * 中身（shiji-notice.js）は日報のチャットが作る部品。本番に来たら SHIJI_SRC にその URL を入れるだけで載る。
 *   SHIJI_SRC が空 … 何もしない（枠は高さ0のまま）。ただし枠に data-own="1" があれば下の「自前の表示」を出す
 *   ?shiji=test   … 確認用。/test/ の試作部品と見本 JSON で出す
 * 読み込みに失敗しても枠が消えるだけで、画面の他の部分には触らない。この js は他のどの js にも頼らない。
 *
 * 自前の表示（指示 20261112-0900。判断ボードの「今日の指示を出す」で杉さんが出したもの）
 *   Cloud Run nippo-api の boardSummary（ログイン不要・覚えた値を返すので速い）の sites[].shiji を、
 *   「寄居 左 ○○まで 22℃」の形で1行ずつ出す。指示が無ければ何も出さない。デモ（?demo=1）では出さない（本番の指示なので）
 */
(function () {
  'use strict';
  var SHIJI_SRC = '';        // 本番の部品の URL（例 '/nippo/shiji-notice.js'）。空なら載せない
  var SHIJI_OPTS = {};       // ShijiNotice.mount に渡す設定（src・load など。部品の本番化に合わせて入れる）
  var TEST_SRC = '/test/shiji-notice.js';
  var TEST_OPTS = { src: '/test/shiji-sample.json' };
  var BOARD_API = 'https://nippo-api-7lc5gs4g6q-an.a.run.app/api';
  var SITE_NAME = { yorii: '寄居', shinrin: '森林公園' };

  var el = document.getElementById('shiji');
  if (!el) return;
  var test = /[?&]shiji=test(?:&|$)/.test(location.search || '');
  var src = test ? TEST_SRC : SHIJI_SRC;
  var opts = test ? TEST_OPTS : SHIJI_OPTS;
  if (!src) {
    if (el.getAttribute('data-own') === '1' && !/[?&]demo=1(?:&|$)/.test(location.search || '')) own();
    return;
  }

  var s = document.createElement('script');
  s.src = src;
  s.async = true;
  s.onload = function () {
    try {
      if (window.ShijiNotice && window.ShijiNotice.mount) window.ShijiNotice.mount(el, opts);
    } catch (e) {
      el.innerHTML = '';
      if (window.console) console.warn('本日の指示を表示できません', e);
    }
  };
  s.onerror = function () { el.innerHTML = ''; };
  document.head.appendChild(s);

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function own() {
    var css = document.createElement('style');
    css.textContent = '.shiji-own{background:#115e59;color:#fff;padding:8px 12px;font-size:15px;line-height:1.5}' +
      '.shiji-own b{font-weight:700;margin-right:6px}.shiji-own .sj-t{opacity:.8;font-size:14px;margin-left:6px}';
    document.head.appendChild(css);
    var load = function () {
      fetch(BOARD_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                         body: JSON.stringify({ action: 'boardSummary', params: {} }) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          var lines = [];
          ((res && res.sites) || []).forEach(function (st) {
            (st.shiji || []).forEach(function (x) {
              var where = (SITE_NAME[st.id] || st.id) + (x.room ? ' ' + x.room : '');
              var body = [x.kokomade ? x.kokomade : '', x.free ? x.free : ''].filter(Boolean).join('　');
              lines.push('<div><b>' + esc(where) + '</b>' + esc(body) +
                (x.temp !== null && x.temp !== undefined && x.temp !== '' ? '<span class="sj-t">' + esc(x.temp) + '℃</span>' : '') + '</div>');
            });
          });
          el.innerHTML = lines.length ? '<div class="shiji-own">' + lines.join('') + '</div>' : '';
        })
        .catch(function () { /* 圏外など。出さないだけ */ });
    };
    load();
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(); });
  }
})();
