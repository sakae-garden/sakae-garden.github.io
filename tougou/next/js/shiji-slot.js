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
 *   拠点ごとに、今日の袋出しの数（sites[].fukuroToday.total＝完熟のその拠点の分＋代表が決めた培養舎から）が1以上なら「寄居 袋出し 450」を先に出す（第6版）
 *   作業記録で拠点を選んでいれば、袋出しはその拠点の1行だけ「袋出し 450」（第6版の直し。拠点を切り替えたら描き直す）
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
    // 作業記録で選んでいる拠点（seisan_form.js が window.__sgSite と 'sg:site' で知らせる）。
    // 選んでいれば袋出しはその拠点の1行だけ「袋出し ○」（指示 20261112-2210。杉さん「自分の拠点の袋出しだけ出せばいい」）。
    // 拠点をまだ選んでいない・部品が無い画面では、今までどおり拠点ごとに出す
    var mySite = function () { return SITE_NAME[window.__sgSite] ? window.__sgSite : ''; };
    var last = null;
    var draw = function () {
      var res = last, lines = [], head = [], my = mySite();
      ((res && res.sites) || []).forEach(function (st) {
        // 代表が決めた今日の袋出し（完熟のその拠点の分＋培養舎から。board.summary の fukuroToday。指示 20261112-2100）
        // 自分の拠点の「袋出し ○」は拠点名を付けないので、ほかの拠点の指示の後ろに来ないよう一番上に出す
        var fk = st.fukuroToday;
        if (fk && fk.total > 0 && (!my || my === st.id)) {
          (my ? head : lines).push('<div>' + (my ? '' : '<b>' + esc(SITE_NAME[st.id] || st.id) + '</b>') + '袋出し ' + esc(Number(fk.total).toLocaleString()) + '</div>');
        }
        (st.shiji || []).forEach(function (x) {
          var where = (SITE_NAME[st.id] || st.id) + (x.room ? ' ' + x.room : '');
          var body = [x.kokomade ? x.kokomade : '', x.free ? x.free : ''].filter(Boolean).join('　');
          lines.push('<div><b>' + esc(where) + '</b>' + esc(body) +
            (x.temp !== null && x.temp !== undefined && x.temp !== '' ? '<span class="sj-t">' + esc(x.temp) + '℃</span>' : '') + '</div>');
        });
      });
      lines = head.concat(lines);
      el.innerHTML = lines.length ?'<div class="shiji-own">' + lines.join('') + '</div>' : '';
    };
    var load = function () {
      fetch(BOARD_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                         body: JSON.stringify({ action: 'boardSummary', params: {} }) })
        .then(function (r) { return r.json(); })
        .then(function (res) { last = res; draw(); })
        .catch(function () { /* 圏外など。出さないだけ */ });
    };
    document.addEventListener('sg:site', function () { if (last) draw(); });
    load();
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(); });
  }
})();
