/*
 * 袋出しの指示：月単位の入力（代表。指示 20261009-153500）。seisan.html の「袋出しの指示（月）」で使う。
 *
 * - 月を選ぶと 日付×拠点（寄居・森林公園）の表が出る。欄は指示の個数。空欄＝指示なし（予測は設定の標準を使う）
 * - 補助：「全日に○個」「平日／土日で分けて」「前月と同じ」（同じ日にちの値。前月に無い日＝31日などは変えない）。
 *   補助は欄を埋めるだけで、保存は「この表を保存」でまとめて1回（production.planSetMany。変わった欄だけ送る）
 * - 後から1日単位で直せる（欄を直して保存。過去の日も直せる）。変更の履歴（いつ・誰が・前→後）はサーバの「袋出し指示_履歴」
 *
 * TougouPlanMonth.mount({ host, msg, month? }) → { ready, isDirty }
 * - 開いたときの月は、毎月25日以降は翌月・それ以外は今月（defaultMonth。◀▶と月の欄で切り替えられる）
 * 純粋な部品（tests/plan_month_test.js で検算）：weekday・defaultMonth・fillAll・fillWeek・fromPrev・changes
 */
(function (root) {
  'use strict';

  var WD = '日月火水木金土';
  function weekday(ymd) { var p = ymd.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getDay(); }
  function isWeekend(ymd) { var w = weekday(ymd); return w === 0 || w === 6; }
  function addMonth(ym, n) {
    var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + String(m + 1).padStart(2, '0');
  }

  /** 表を開いたときの月：毎月25日以降は翌月、それ以外は今月（2026-10-15 杉さん決定。前の月に翌月の指示を入れやすく） */
  var NEXT_MONTH_FROM_DAY = 25;
  function defaultMonth(today) {
    var ym = String(today).slice(0, 7);
    return Number(String(today).slice(8, 10)) >= NEXT_MONTH_FROM_DAY ? addMonth(ym, 1) : ym;
  }

  /** 表の値は edit['拠点|日付'] = '' | '数字の文字列'。sites：補助をかける拠点の id の配列 */
  function fillAll(edit, days, sites, n) {
    sites.forEach(function (s) { days.forEach(function (d) { edit[s + '|' + d] = String(n); }); });
    return edit;
  }
  function fillWeek(edit, days, sites, weekdayN, weekendN) {
    sites.forEach(function (s) {
      days.forEach(function (d) {
        var v = isWeekend(d) ? weekendN : weekdayN;
        if (v !== null && v !== '' && v !== undefined) edit[s + '|' + d] = String(v);
      });
    });
    return edit;
  }
  /** 前月と同じ：同じ日にちの前月の指示。前月に指示が無い日は空欄、前月に無い日（31日など）は変えない */
  function fromPrev(edit, days, sites, prev, prevMonth) {
    var nPrev = new Date(Number(prevMonth.slice(0, 4)), Number(prevMonth.slice(5, 7)), 0).getDate();
    sites.forEach(function (s) {
      days.forEach(function (d) {
        var dd = Number(d.slice(8, 10));
        if (dd > nPrev) return;
        var v = prev[s + '|' + prevMonth + '-' + d.slice(8, 10)];
        edit[s + '|' + d] = v === undefined || v === null ? '' : String(v);
      });
    });
    return edit;
  }
  /** 保存する差分：[{ date, site, value }]（value は '' か整数）。読めない欄があれば { error } */
  function changes(saved, edit, readNum) {
    var out = [], bad = '';
    Object.keys(edit).sort().forEach(function (k) {
      var raw = String(edit[k] == null ? '' : edit[k]).trim();
      var v = raw === '' ? '' : readNum(raw);
      if (v !== '' && (v === null || isNaN(v) || v !== Math.floor(v))) { bad = bad || k.split('|')[1] + ' の値「' + raw + '」は個数（整数）で入れてください。'; return; }
      var cur = saved[k] === undefined || saved[k] === null ? '' : saved[k];
      if (String(cur) === String(v)) return;
      var p = k.split('|');
      out.push({ site: p[0], date: p[1], value: v });
    });
    return bad ? { error: bad } : out;
  }

  function mount(o) {
    var C = root.TougouCommon, host = o.host, msg = o.msg || function () {};
    var st = { month: o.month || '', data: null, saved: {}, edit: {}, target: 'all', seq: 0 };

    host.innerHTML =
      '<div class="fsec pm-head"><div class="frow"><div class="frow-lbl">月</div><div class="frow-inp">' +
      '<button type="button" class="sbtn" data-el="pmPrev" aria-label="前の月">◀</button>' +
      '<input type="month" data-el="pmMonth">' +
      '<button type="button" class="sbtn" data-el="pmNext" aria-label="次の月">▶</button></div></div></div>' +
      '<div class="sec-lbl">まとめて入れる（欄を埋めるだけ。保存は下のボタン）</div>' +
      '<div class="fsec pm-tools">' +
      '<div class="pm-row">拠点 <span class="pm-target" data-el="pmTarget"></span></div>' +
      '<div class="pm-row">全日に <input type="text" inputmode="numeric" pattern="[0-9]*" data-el="pmAll" placeholder="150">個 ' +
      '<button type="button" class="sbtn" data-el="pmAllBtn">入れる</button></div>' +
      '<div class="pm-row">平日 <input type="text" inputmode="numeric" pattern="[0-9]*" data-el="pmWd" placeholder="150">個・土日 ' +
      '<input type="text" inputmode="numeric" pattern="[0-9]*" data-el="pmWe" placeholder="0">個 ' +
      '<button type="button" class="sbtn" data-el="pmWeekBtn">入れる</button></div>' +
      '<div class="pm-row"><button type="button" class="sbtn" data-el="pmPrevBtn">前月と同じ</button>' +
      '<button type="button" class="sbtn" data-el="pmReset">変更をやめる</button></div>' +
      '<div class="pm-note">空欄の日は指示なし（予測は設定の標準を使います）。0 は「袋出ししない日」。過去の日も直せます。</div></div>' +
      '<div class="sec-lbl">日付×拠点 <span data-el="pmInfo"></span></div>' +
      '<div class="fsec" data-el="pmTable"><div class="empty">読み込み中…</div></div>' +
      '<button type="button" class="submit-btn" data-el="pmSave">💾 この表を保存</button>' +
      '<details class="pm-hist"><summary>この月の変更の履歴</summary><div data-el="pmHist"></div></details>';
    var q = function (k) { return host.querySelector('[data-el="' + k + '"]'); };

    function sites() { return (st.data && st.data.sites) || []; }
    function targetSites() { return st.target === 'all' ? sites().map(function (s) { return s.id; }) : [st.target]; }
    function short(name) { return String(name || '').replace(/ハウス$/, ''); }
    function pending() { return st.data ? changes(st.saved, st.edit, C.readNum) : []; }
    function isDirty() { var p = pending(); return !!p.error || p.length > 0; }

    function renderTarget() {
      var opts = [{ id: 'all', name: '両方' }].concat(sites());
      q('pmTarget').innerHTML = opts.map(function (s) {
        return '<button type="button" class="rtab' + (s.id === st.target ? ' active' : '') + '" data-id="' + C.esc(s.id) + '">' + C.esc(short(s.name)) + '</button>';
      }).join('');
      Array.prototype.forEach.call(q('pmTarget').children, function (b) {
        b.onclick = function () { st.target = b.dataset.id; renderTarget(); };
      });
    }
    function renderSaveBtn() {
      var p = pending(), n = p.error ? 0 : p.length;
      q('pmSave').textContent = n ? '💾 この表を保存（' + n + '件の変更）' : '💾 この表を保存';
      if (!q('pmSave').classList.contains('demo-off')) q('pmSave').disabled = !n;
    }
    function renderTable() {
      var d = st.data;
      if (!d) return;
      var today = d.today;
      var h = '<table class="tbl pm-tbl"><tr><th>日付</th>' + d.sites.map(function (s) {
        return '<th>' + C.esc(short(s.name)) + (s.std !== null ? '<div class="pm-std">標準 ' + s.std + '</div>' : '') + '</th>';
      }).join('') + '</tr>';
      d.days.forEach(function (day) {
        var w = weekday(day), cls = (w === 0 ? 'sun' : w === 6 ? 'sat' : '') + (day < today ? ' past' : '') + (day === today ? ' today' : '');
        h += '<tr class="' + cls + '"><td class="pm-day">' + Number(day.slice(8, 10)) + '<span class="pm-wd">' + WD.charAt(w) + '</span></td>';
        d.sites.forEach(function (s) {
          var k = s.id + '|' + day, v = st.edit[k] === undefined ? '' : st.edit[k];
          var savedV = st.saved[k] === undefined ? '' : String(st.saved[k]);
          var act = d.actual[k];
          h += '<td class="pm-cell' + (String(v).trim() !== savedV ? ' chg' : '') + '">' +
            '<input type="text" inputmode="numeric" pattern="[0-9]*" data-k="' + C.esc(k) + '" value="' + C.esc(v) + '" placeholder="' + (s.std !== null ? '(' + s.std + ')' : '—') + '">' +
            (act !== undefined && act !== null ? '<div class="pm-act">実績 ' + Number(act).toLocaleString() + '</div>' : '') + '</td>';
        });
        h += '</tr>';
      });
      q('pmTable').innerHTML = h + '</table>';
      Array.prototype.forEach.call(q('pmTable').querySelectorAll('input[data-k]'), function (inp) {
        inp.addEventListener('input', function () {
          st.edit[inp.dataset.k] = inp.value;
          var savedV = st.saved[inp.dataset.k] === undefined ? '' : String(st.saved[inp.dataset.k]);
          inp.parentNode.classList.toggle('chg', String(inp.value).trim() !== savedV);
          renderSaveBtn();
        });
      });
      var nPlan = Object.keys(st.saved).length;
      q('pmInfo').textContent = '（指示あり ' + nPlan + '件／' + d.days.length * d.sites.length + '欄。（）内は指示が無いときに予測が使う標準）';
      renderSaveBtn();
    }
    function renderHist() {
      var d = st.data, names = {};
      sites().forEach(function (s) { names[s.id] = short(s.name); });
      var list = (d && d.history) || [];
      q('pmHist').innerHTML = list.length ? '<table class="tbl"><tr><th>いつ</th><th>誰が</th><th>日・拠点</th><th>前→後</th></tr>' + list.map(function (x) {
        var f = function (v) { return v === '' ? '空欄' : C.esc(v); };
        return '<tr><td>' + C.esc(String(x.at).slice(5, 16)) + '</td><td>' + C.esc(x.surname) + '</td><td>' +
          Number(x.date.slice(5, 7)) + '/' + Number(x.date.slice(8, 10)) + ' ' + C.esc(names[x.site] || x.site) + '</td><td>' +
          f(x.before) + '→' + f(x.after) + (x.op && x.op !== '月の表' ? '（' + C.esc(x.op) + '）' : '') + '</td></tr>';
      }).join('') + '</table>' : '<div class="empty">この月の変更はまだありません。</div>';
    }

    function load(month) {
      var my = ++st.seq;
      st.month = month;
      q('pmMonth').value = month;
      q('pmTable').innerHTML = '<div class="empty">読み込み中…</div>';
      return C.api('production.planMonth', { month: month }).then(function (d) {
        if (my !== st.seq) return;
        st.data = d;
        st.saved = {}; st.edit = {};
        Object.keys(d.plans).forEach(function (k) { st.saved[k] = d.plans[k].count; });
        d.days.forEach(function (day) {
          d.sites.forEach(function (s) { var k = s.id + '|' + day; st.edit[k] = st.saved[k] === undefined ? '' : String(st.saved[k]); });
        });
        renderTarget(); renderTable(); renderHist();
      }, function (err) {
        if (my !== st.seq) return;
        q('pmTable').innerHTML = '<div class="empty">読み込めませんでした。</div>';
        msg(err.message, 'ng');
      });
    }
    function go(month) {
      if (isDirty() && !root.confirm('保存していない変更があります。破棄して月を切り替えますか')) { q('pmMonth').value = st.month; return; }
      msg(''); load(month);
    }
    function numOf(el, label) {
      var raw = String(q(el).value).trim();
      if (raw === '') return '';
      var v = C.readNum(raw);
      if (v === null || isNaN(v) || v !== Math.floor(v)) { msg(label + 'は個数（整数）で入れてください。', 'ng'); return null; }
      return v;
    }

    q('pmMonth').addEventListener('change', function () { if (/^\d{4}-\d{2}$/.test(this.value)) go(this.value); });
    q('pmPrev').onclick = function () { go(addMonth(st.month, -1)); };
    q('pmNext').onclick = function () { go(addMonth(st.month, 1)); };
    q('pmAllBtn').onclick = function () {
      var v = numOf('pmAll', '「全日に」');
      if (v === null || !st.data) return;
      if (v === '') { msg('「全日に」の個数を入れてください。', 'ng'); return; }
      msg(''); fillAll(st.edit, st.data.days, targetSites(), v); renderTable();
    };
    q('pmWeekBtn').onclick = function () {
      var a = numOf('pmWd', '平日'), b = numOf('pmWe', '土日');
      if (a === null || b === null || !st.data) return;
      if (a === '' && b === '') { msg('平日か土日の個数を入れてください。', 'ng'); return; }
      msg(''); fillWeek(st.edit, st.data.days, targetSites(), a, b); renderTable();
    };
    q('pmPrevBtn').onclick = function () {
      if (!st.data) return;
      if (!Object.keys(st.data.prev).length && !root.confirm(st.data.prevMonth + ' には指示がありません。空欄にしますか')) return;
      msg(''); fromPrev(st.edit, st.data.days, targetSites(), st.data.prev, st.data.prevMonth); renderTable();
    };
    q('pmReset').onclick = function () { if (st.data) { load(st.month); msg(''); } };
    q('pmSave').onclick = function () {
      var p = pending();
      if (p.error) { msg(p.error, 'ng'); return; }
      if (!p.length) { C.toast('変えた欄がありません'); return; }
      q('pmSave').disabled = true;
      C.showLoading('保存中...');
      C.api('production.planSetMany', { plans: p }).then(function (res) {
        C.hideLoading();
        msg(res.historyError ? '保存しました。ただし変更の履歴を書けませんでした：' + res.historyError : '', res.historyError ? 'warn' : 'info');
        C.toast('指示を保存しました（' + res.changed + '件）');
        return load(st.month);
      }, function (err) {
        C.hideLoading();
        renderSaveBtn();
        msg(err.network ? '通信できませんでした。電波の良い所でもう一度「この表を保存」を押してください（同じ表を送っても二重にはなりません）。'
                        : '保存できませんでした：' + err.message, err.network ? 'warn' : 'ng');
      });
    };
    root.addEventListener('beforeunload', function (e) { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

    var first = st.month || defaultMonth(o.today || C.ymd(C.now ? C.now() : new Date()));
    return { ready: load(first), isDirty: isDirty, load: load };
  }

  var api = { mount: mount, weekday: weekday, isWeekend: isWeekend, addMonth: addMonth, defaultMonth: defaultMonth,
              fillAll: fillAll, fillWeek: fillWeek, fromPrev: fromPrev, changes: changes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TougouPlanMonth = api;
})(typeof window !== 'undefined' ? window : globalThis);
