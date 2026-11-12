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
 *   見る拠点はバー右の「寄居｜森林公園」で切り替え、その拠点の袋出し・部屋の指示だけを拠点名なしで出す（指示 20261112-2325）。
 *   開いたときは作業記録の拠点（未選択は寄居）。記録の拠点は変えない。選んだ拠点に指示が無ければ切り替えだけ、どこにも無ければ出さない
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
    css.textContent = '.shiji-own{background:#115e59;color:#fff;padding:6px 12px;font-size:15px;line-height:1.5;display:flex;gap:8px;align-items:flex-start}' +
      '.shiji-own .sj-l{flex:1;min-width:0}' +
      '.shiji-own b{font-weight:700;margin-right:6px}.shiji-own .sj-t{opacity:.8;font-size:14px;margin-left:6px}' +
      '.sj-sw{flex:none;display:flex;border:1px solid rgba(255,255,255,.6);border-radius:6px;overflow:hidden;margin-top:1px}' +
      '.sj-sw button{border:0;background:none;color:rgba(255,255,255,.75);font:inherit;font-size:14px;font-weight:700;padding:1px 8px;cursor:pointer;line-height:1.5}' +
      '.sj-sw button.on{background:#fff;color:#115e59}';
    document.head.appendChild(css);
    // 見る拠点（指示 20261112-2325。杉さん「両方の拠点を切り替えられるようにしておいていい」）。
    // 指示バーの「寄居｜森林公園」で切り替える。見るだけで、記録を入れる拠点は変えない。
    // 開いたときは作業記録で選んでいる拠点（seisan_form.js が window.__sgSite と 'sg:site' で知らせる。未選択は寄居）。
    // 記録の拠点を切り替えたら、見る拠点もそれに合わせる。端末には覚えない
    var recSite = function () { return SITE_NAME[window.__sgSite] ? window.__sgSite : ''; };
    var lastRec = recSite();
    var view = lastRec || 'yorii';
    var last = null;
    var linesOf = function (st) {
      var out = [];
      // 代表が決めた今日の袋出し（完熟のその拠点の分＋培養舎から。board.summary の fukuroToday。指示 20261112-2100）。先頭に出す
      var fk = st.fukuroToday;
      if (fk && fk.total > 0) out.push('<div>袋出し ' + esc(Number(fk.total).toLocaleString()) + '</div>');
      (st.shiji || []).forEach(function (x) {
        var body = [x.kokomade ? x.kokomade : '', x.free ? x.free : ''].filter(Boolean).join('　');
        out.push('<div>' + (x.room ? '<b>' + esc(x.room) + '</b>' : '') + esc(body) +
          (x.temp !== null && x.temp !== undefined && x.temp !== '' ? '<span class="sj-t">' + esc(x.temp) + '℃</span>' : '') + '</div>');
      });
      return out;
    };
    var draw = function () {
      var by = {}, any = false;
      ((last && last.sites) || []).forEach(function (st) {
        if (!SITE_NAME[st.id]) return;
        by[st.id] = linesOf(st);
        if (by[st.id].length) any = true;
      });
      // どの拠点にも指示が無ければバーごと出さない。選んだ拠点に無いときは切り替えだけ（説明文は出さない）
      if (!any) { el.innerHTML = ''; return; }
      var sw = Object.keys(SITE_NAME).map(function (id) {
        return '<button type="button" data-v="' + id + '"' + (id === view ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + esc(SITE_NAME[id]) + '</button>';
      }).join('');
      el.innerHTML = '<div class="shiji-own"><div class="sj-l">' + (by[view] || []).join('') + '</div><div class="sj-sw">' + sw + '</div></div>';
      Array.prototype.forEach.call(el.querySelectorAll('.sj-sw button'), function (b) {
        b.onclick = function () { if (b.getAttribute('data-v') !== view) { view = b.getAttribute('data-v'); draw(); } };
      });
    };
    var load = function () {
      fetch(BOARD_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                         body: JSON.stringify({ action: 'boardSummary', params: {} }) })
        .then(function (r) { return r.json(); })
        .then(function (res) { last = res; draw(); })
        .catch(function () { /* 圏外など。出さないだけ */ });
    };
    // 描き直し（renderSites）でも届くので、記録の拠点が本当に変わったときだけ見る拠点を合わせる
    document.addEventListener('sg:site', function () {
      var r = recSite();
      if (r === lastRec) return;
      lastRec = r;
      if (r) view = r;
      if (last) draw();
    });
    load();
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(); });
  }
})();
