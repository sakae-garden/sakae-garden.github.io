/*
 * 本日の指示バーの枠（統合アプリ完成 E）。配達・作業の画面の最上部 <div id="shiji" class="shiji-slot"> に載せる。
 *
 * 中身（shiji-notice.js）は日報のチャットが作る部品。本番に来たら SHIJI_SRC にその URL を入れるだけで載る。
 *   SHIJI_SRC が空 … 何もしない（枠は高さ0のまま）
 *   ?shiji=test   … 確認用。/test/ の試作部品と見本 JSON で出す
 * 読み込みに失敗しても枠が消えるだけで、画面の他の部分には触らない。この js は他のどの js にも頼らない。
 */
(function () {
  'use strict';
  var SHIJI_SRC = '';        // 本番の部品の URL（例 '/nippo/shiji-notice.js'）。空なら載せない
  var SHIJI_OPTS = {};       // ShijiNotice.mount に渡す設定（src・load など。部品の本番化に合わせて入れる）
  var TEST_SRC = '/test/shiji-notice.js';
  var TEST_OPTS = { src: '/test/shiji-sample.json' };

  var el = document.getElementById('shiji');
  if (!el) return;
  var test = /[?&]shiji=test(?:&|$)/.test(location.search || '');
  var src = test ? TEST_SRC : SHIJI_SRC;
  var opts = test ? TEST_OPTS : SHIJI_OPTS;
  if (!src) return;

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
})();
