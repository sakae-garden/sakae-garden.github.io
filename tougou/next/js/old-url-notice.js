/*
 * 旧URLの案内（統合アプリ完成 G）。CP3（本番切り替え）で旧画面に1行足して使う。今はどこからも読まれていない。
 *
 *   <script src="/tougou/next/js/old-url-notice.js" data-to="/tougou/next/" data-redirect-from="2026-12-20" defer></script>
 *
 *   data-to            … 新しい入口（切り替え後の本番パス）
 *   data-redirect-from … この日（YYYY-MM-DD、端末の日付）以降は案内を出さずに新しい入口へ移す。空なら案内だけ
 * 最上部に「新しいアプリはこちら」の帯を出す。帯を押すと新しい入口へ。帯は閉じられる（その日のあいだだけ）。
 * 旧画面の動きには触らない（帯を body の先頭に差し込むだけ）。
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var to = (me && me.getAttribute('data-to')) || '/tougou/next/';
  var from = (me && me.getAttribute('data-redirect-from')) || '';
  var d = new Date();
  var today = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  if (from && today >= from) { location.replace(to); return; }
  var KEY = 'sg.oldUrlNotice.closed';
  try { if (localStorage.getItem(KEY) === today) return; } catch (e) {}

  function show() {
    if (document.getElementById('sg_old_url_notice')) return;
    var b = document.createElement('div');
    b.id = 'sg_old_url_notice';
    b.setAttribute('style', 'position:sticky;top:0;z-index:9998;display:flex;align-items:center;gap:8px;' +
      'background:#2d7a4f;color:#fff;padding:10px 12px;font:700 15px/1.4 "Noto Sans JP",sans-serif');
    b.innerHTML = '<a href="' + to + '" style="flex:1;color:#fff;text-decoration:none">新しいアプリはこちら ›' +
      (from ? '<span style="display:block;font-weight:400;font-size:12px">' + Number(from.slice(5, 7)) + '/' + Number(from.slice(8, 10)) +
        'からは自動で新しいアプリが開きます</span>' : '') + '</a>' +
      '<button type="button" aria-label="閉じる" style="background:transparent;border:1px solid #fff;color:#fff;border-radius:6px;padding:2px 10px;font:inherit">×</button>';
    b.querySelector('button').onclick = function () {
      try { localStorage.setItem(KEY, today); } catch (e) {}
      b.parentNode.removeChild(b);
    };
    document.body.insertBefore(b, document.body.firstChild);
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
