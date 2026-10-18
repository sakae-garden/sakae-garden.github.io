/*
 * 栽培シフトの読み取り（今日の画面の「出勤者」。指示 20260925-096200）。読むだけで、書き込みはしない。
 *
 * - データは栽培シフト（/eigarden-shift-app/saibai.html）と同じ GAS（eigarden-shift-api）の
 *   `?action=load&app=saibai`（doGet。読むだけ）を JSONP で取る。saibai.html と同じ取り方。
 *   統合API（GAS）から UrlFetchApp で読むと外部通信の権限の承認が要るので、画面から直接読む。
 * - 出勤の判定（曜日・隔週休み・例外の「休み」「追加出勤」）は saibai.html の membersForDay をそのまま移したもの。
 *   シフトの編集は段階3で移植する。それまではこの判定を saibai.html と同じに保つこと。
 * - 取れないとき（圏外・タイムアウト・形が違う）は reject。画面は欄ごと出さない。
 */
(function (root) {
  'use strict';

  var SAIBAI_GAS_URL = 'https://script.google.com/macros/s/AKfycbwOzFGM2lTmWDg4H_LCxyVAG9SvWRx7Vsf_Cf7sCwVJHitHbQIJqgd87xVzNo1dSjaF/exec';

  function load(timeoutMs) {
    return new Promise(function (resolve, reject) {
      var doc = root.document;
      var cb = 'tougouShift_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      var s = doc.createElement('script');
      var timer = setTimeout(function () { cleanup(); reject(new Error('timeout')); }, timeoutMs || 8000);
      function cleanup() { clearTimeout(timer); try { delete root[cb]; } catch (e) { root[cb] = undefined; } if (s.parentNode) s.parentNode.removeChild(s); }
      root[cb] = function (data) {
        cleanup();
        if (!data || !Array.isArray(data.master)) { reject(new Error('シフトのデータがありません')); return; }
        resolve({ master: data.master, exceptions: Array.isArray(data.exceptions) ? data.exceptions : [], updatedAt: data.updatedAt || '' });
      };
      s.onerror = function () { cleanup(); reject(new Error('script-error')); };
      s.src = SAIBAI_GAS_URL + '?action=load&app=saibai&callback=' + cb + '&_=' + Date.now();
      doc.body.appendChild(s);
    });
  }

  // ---- 以下 saibai.html と同じ判定（曜日 wd は 月＝0 … 日＝6）
  function mondayOf(y, m, d) {
    var dt = new Date(Date.UTC(y, m - 1, d));
    var dow = (dt.getUTCDay() + 6) % 7;
    return dt.getTime() - dow * 86400000;
  }
  function isBiweeklyOff(bw, wd, year, month, day) {
    if (!bw || bw.day !== wd) return false;
    if (!bw.anchor) {
      if (typeof bw.parity === 'number') {
        var wi = Math.round((mondayOf(year, month, day) - Date.UTC(2026, 5, 22)) / (7 * 86400000));
        return (((wi % 2) + 2) % 2) === bw.parity;
      }
      return false;
    }
    var p = String(bw.anchor).split('-');
    var ay = parseInt(p[0], 10), am = parseInt(p[1], 10), ad = parseInt(p[2], 10);
    if (!ay || !am || !ad) return false;
    var diffWeeks = Math.round((mondayOf(year, month, day) - mondayOf(ay, am, ad)) / (7 * 86400000));
    return (((diffWeeks % 2) + 2) % 2) === 0;
  }
  /** 'YYYY-MM-DD' の出勤者（master の並び順）。 */
  function membersOn(ymd, master, exceptions) {
    var p = ymd.split('-').map(Number);
    var year = p[0], month = p[1], day = p[2];
    var wd = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
    var list = (master || []).filter(function (e) {
      if (!Array.isArray(e.days) || e.days.indexOf(wd) < 0) return false;
      return !isBiweeklyOff(e.biweekly, wd, year, month, day);
    }).map(function (e) { return Object.assign({}, e); });
    (exceptions || []).filter(function (x) { return x.year === year && x.month === month && x.day === day; }).forEach(function (x) {
      if (x.type === '休み') { list = list.filter(function (e) { return e.name !== x.name; }); return; }
      if (x.type === '追加出勤') {
        var emp = (master || []).filter(function (e) { return e.name === x.name; })[0];
        if (emp && !list.some(function (e) { return e.name === x.name; })) list.push(Object.assign({ added: true }, emp));
      }
    });
    var idx = function (n) { for (var i = 0; i < master.length; i++) if (master[i].name === n) return i; return -1; };
    return list.sort(function (a, b) { return idx(a.name) - idx(b.name); });
  }

  var api = { load: load, membersOn: membersOn, SAIBAI_GAS_URL: SAIBAI_GAS_URL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TougouShift = api;
})(typeof window !== 'undefined' ? window : globalThis);
