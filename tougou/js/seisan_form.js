/*
 * 生産入力のフォーム（袋出し・浸水・収穫＋その日の入力済み一覧）。
 * seisan.html（生産入力。日付を選べる）と kyou.html（今日。日付は今日で固定）で共用する（指示 20260925-096200）。
 * 中身は段階1-2 の生産入力（seisan.html）の処理をそのまま移したもの。
 *
 * - 保存は「日付×拠点×種別」で1行 upsert（production.upsertMany）。入れる値は**その日の合計**（上書き。足し算ではない）
 * - 空欄の欄は送らない（前の値のまま）。取り消しは 0
 * - 保存ボタンは1つ（日報の「送信」と同じ）。変えた欄だけを送る
 *
 * TougouSeisanForm.mount(opts)
 *   host      … フォームを描く要素
 *   siteTabs  … 拠点のタブを描く要素（ヘッダーの .hdr-tabs）
 *   msg(text, kind) … お知らせの表示
 *   pickDate  … true なら日付欄と「今日」ボタンを出す（生産入力）。false なら今日で固定（今日の画面）
 *   draftKey  … 下書きの localStorage キー
 *   bannerHost… 下書きバナーを差し込む要素
 *   onRows(rows, date) … その日の入力済みを読み直したとき（今日の画面が「やること」の入力済みを出すのに使う）
 * 戻り値 { ready: Promise, reload() }
 */
(function (root) {
  'use strict';

  var KINDS = ['fukurodashi', 'shinsui_1', 'shinsui_2', 'shinsui_3', 'shukaku_1', 'shukaku_2plus', 'shukaku_c'];
  var INT_KINDS = { fukurodashi: 1, shinsui_1: 1, shinsui_2: 1, shinsui_3: 1 };
  var LS_SITE = 'tougou.today.site';          // GAS 版と同じキー（端末で前回選んだ拠点）

  function numInput(k, mode) {
    return '<input type="text" data-k="' + k + '" inputmode="' + mode + '"' + (mode === 'numeric' ? ' pattern="[0-9]*"' : '') +
      ' autocomplete="off" placeholder="—">';
  }
  function shinsuiRow(n) {
    var k = 'shinsui_' + n;
    return '<div class="frow" data-row="' + k + '">' +
      '<div class="frow-lbl">' + n + '番浸水<span class="srv"></span><div class="shinsui-sub" data-count="' + k + '"></div></div>' +
      '<div class="frow-inp"><button type="button" class="step-btn" data-k="' + k + '" data-d="-1" aria-label="1タンク減らす">－</button>' +
      numInput(k, 'numeric') +
      '<button type="button" class="step-btn" data-k="' + k + '" data-d="1" aria-label="1タンク増やす">＋</button></div></div>';
  }
  function kgRow(k, label) {
    return '<div class="frow" data-row="' + k + '"><div class="frow-lbl">' + label + '<span class="srv"></span></div>' +
      '<div class="frow-inp">' + numInput(k, 'decimal') + '<span class="frow-unit">kg</span></div></div>';
  }

  function formHtml(pickDate) {
    return (pickDate
      ? '<div class="fsec"><div class="frow"><div class="frow-lbl">日付</div><div class="frow-inp">' +
        '<input type="date" data-el="date"><button type="button" class="sbtn" data-el="today">今日</button></div></div></div>'
      : '') +
      '<div class="sec-lbl">袋出し</div>' +
      '<div class="fsec"><div class="fsec-hdr">袋出し<span class="note">その日の合計（上書き）</span></div>' +
      '<div class="frow" data-row="fukurodashi"><div class="frow-lbl">袋出し<span class="srv"></span></div>' +
      '<div class="frow-inp">' + numInput('fukurodashi', 'numeric') + '<span class="frow-unit">個</span></div></div></div>' +
      '<div class="sec-lbl">浸水</div>' +
      '<div class="fsec"><div class="fsec-hdr">浸水<span class="note" data-el="tankNote">1タンク＝42個</span></div>' +
      shinsuiRow(1) + shinsuiRow(2) + shinsuiRow(3) + '</div>' +
      '<div class="sec-lbl">収穫</div>' +
      '<div class="fsec"><div class="fsec-hdr">収穫<span class="note">kg・その日の合計（上書き）</span></div>' +
      kgRow('shukaku_1', '1番') + kgRow('shukaku_2plus', '2番以降') + kgRow('shukaku_c', '傷（C品）') + '</div>' +
      '<div class="sec-lbl" style="margin-top:4px">空欄の欄は送りません（前の値のまま）。取り消しは 0 を入れて保存。</div>' +
      '<button type="button" class="submit-btn" data-el="save">💾 保存する</button>' +
      '<div class="sec-lbl">入力済み <span data-el="listDate"></span></div>' +
      '<div class="fsec" data-el="list"><div class="empty">読み込み中…</div></div>';
  }

  function mount(o) {
    var C = root.TougouCommon;
    var host = o.host;
    host.innerHTML = formHtml(!!o.pickDate);
    var q = function (sel) { return host.querySelector(sel); };
    var el = { date: q('[data-el="date"]'), today: q('[data-el="today"]'), tankNote: q('[data-el="tankNote"]'),
               save: q('[data-el="save"]'), list: q('[data-el="list"]'), listDate: q('[data-el="listDate"]') };
    var msg = o.msg || function () {};
    var st = { opts: null, date: '', site: '', rows: [], seq: 0, tank: 42 };
    var inputs = {};
    KINDS.forEach(function (k) { inputs[k] = q('input[data-k="' + k + '"]'); });

    // ---- 保存済みの値（その日・その拠点）
    function serverValue(kind) {
      for (var i = 0; i < st.rows.length; i++) {
        var r = st.rows[i];
        if (r['拠点'] === st.site && r.kind === kind) {
          // シートの表示値（getDisplayValues）なので「1,200」のような書式が付くことがある
          var n = C.readNum(r['入力値']);
          return (n === null || isNaN(n)) ? String(r['入力値']) : String(n);
        }
      }
      return '';
    }
    /** 送る対象：空欄でなく、保存済みの値と違う欄。{ kind: 数値 } か、読めない欄があれば文字列 */
    function pending() {
      var out = {}, bad = '';
      KINDS.forEach(function (k) {
        var v = C.readNum(inputs[k].value);
        if (v === null) return;
        if (isNaN(v)) { bad = '数字で入れてください。'; return; }
        if (INT_KINDS[k] && v !== Math.floor(v)) { bad = (k === 'fukurodashi' ? '袋出しは個数' : 'タンク数') + 'を整数で入れてください。'; return; }
        var sv = serverValue(k);
        if (sv !== '' && Number(sv) === v) return;
        out[k] = v;
      });
      return bad || out;
    }
    function isDirty() {
      var p = pending();
      return typeof p === 'string' || Object.keys(p).length > 0;
    }

    // ---- 表示
    function renderSites() {
      var sites = (st.opts && st.opts.sites) || [];
      o.siteTabs.innerHTML = sites.map(function (s) {
        return '<button type="button" class="rtab' + (s.id === st.site ? ' active' : '') + '" data-id="' + C.esc(s.id) + '">' + C.esc(s.name || s.id) + '</button>';
      }).join('');
      Array.prototype.forEach.call(o.siteTabs.children, function (b) {
        b.onclick = function () {
          if (b.dataset.id === st.site) return;
          if (!guard.confirmDiscard('拠点を切り替え')) return;
          st.site = b.dataset.id;
          try { root.localStorage.setItem(LS_SITE, st.site); } catch (e) { /* 毎回選ぶ */ }
          msg('');
          renderSites(); fillInputs(); guard.changed();
        };
      });
      el.save.disabled = !st.site;
      if (!st.site && sites.length) msg('上の拠点を選んでください（次からはこの端末で選んだ拠点が最初から選ばれます）。', 'warn');
    }

    function countText(k) {
      var n = C.readNum(inputs[k].value);
      return (n === null || isNaN(n) || n === 0) ? '' : '＝ ' + (n * st.tank).toLocaleString() + '個';
    }
    function renderRowMarks() {
      KINDS.forEach(function (k) {
        var row = q('[data-row="' + k + '"]');
        var sv = serverValue(k);
        row.querySelector('.srv').textContent = sv === '' ? '' : '保存済み ' + sv;
        var v = C.readNum(inputs[k].value);
        row.classList.toggle('chg', v !== null && !(sv !== '' && Number(sv) === v));
        var c = q('[data-count="' + k + '"]');
        if (c) c.textContent = countText(k);
      });
    }
    function fillInputs() {
      KINDS.forEach(function (k) { inputs[k].value = serverValue(k); });
      renderRowMarks();
    }

    function renderList() {
      el.listDate.textContent = st.date;
      var rows = st.rows.slice().sort(function (a, b) {
        if (a['拠点'] !== b['拠点']) return a['拠点'] < b['拠点'] ? -1 : 1;
        return KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
      });
      if (!rows.length) { el.list.innerHTML = '<div class="empty">この日の入力はまだありません。</div>'; return; }
      var h = '<table class="tbl"><tr><th>種別</th><th>入力</th><th>個数</th><th>入力者</th></tr>', last = null;
      rows.forEach(function (r) {
        if (r['拠点'] !== last) { last = r['拠点']; h += '<tr class="grp"><td colspan="4">' + C.esc(r.siteName) + '</td></tr>'; }
        h += '<tr' + (Number(r['入力値']) === 0 ? ' class="zero"' : '') + '>' +
          '<td>' + C.esc(String(r['種別']).replace('収穫_', '収穫 ')) + '</td>' +
          '<td class="num">' + C.esc(r['入力値'] + ' ' + r['入力単位']) + '</td>' +
          '<td class="num">' + (r['個数'] ? Number(r['個数']).toLocaleString() + '個' : '') + '</td>' +
          '<td>' + C.esc((r.empName || '') + ' ' + String(r['更新日時']).slice(11, 16)) + '</td></tr>';
      });
      el.list.innerHTML = h + '</table>';
    }

    // ---- 読み込み
    function load(keepInputs) {
      var my = ++st.seq;   // 日付を続けて変えたとき、古い応答で上書きしない
      el.list.innerHTML = '<div class="empty">読み込み中…</div>';
      return C.api('production.list', { date: st.date }).then(function (res) {
        if (my !== st.seq) return false;
        st.rows = res.rows || [];
        renderList();
        if (keepInputs) renderRowMarks(); else fillInputs();
        guard.changed();
        if (o.onRows) o.onRows(st.rows, st.date);
        return true;
      }, function (err) {
        if (my !== st.seq) return false;
        el.list.innerHTML = '<div class="empty">読み込めませんでした。</div>';
        msg(err.message, 'ng');
        return false;
      });
    }

    // ---- 保存（二重送信防止：runOnce＋日報と同じ「送信中...」の覆い）
    function save() {
      var p = pending();
      if (!st.site) { msg('拠点を選んでください。', 'ng'); return Promise.resolve(false); }
      if (typeof p === 'string') { msg(p, 'ng'); return Promise.resolve(false); }
      var kinds = Object.keys(p);
      if (!kinds.length) { C.toast('変えた欄がありません'); return Promise.resolve(true); }
      var records = kinds.map(function (k) { return { date: st.date, site: st.site, kind: k, value: p[k] }; });
      var result = null;
      var started = C.runOnce('save', el.save, '保存しています…', function () {
        guard.setState('saving');
        C.showLoading('保存中...');
        return C.api('production.upsertMany', { records: records }).then(function () {
          C.hideLoading();
          guard.setState('');
          msg('');
          C.toast('保存しました（' + st.date + '）');
          return load(false).then(function () { result = true; });
        }, function (err) {
          C.hideLoading();
          if (!err.network) { guard.setState('failed'); msg('保存できませんでした：' + err.message, 'ng'); result = false; return; }
          // 通信が切れた＝保存されたか分からない。一覧を読み直して、送った値が入っていれば保存済みとみなす
          //（upsert なので同じ内容を再送しても二重にはならない）
          return load(true).then(function (loaded) {
            var ok = loaded && records.every(function (r) { var sv = serverValue(r.kind); return sv !== '' && Number(sv) === r.value; });
            if (ok) { guard.setState(''); msg(''); C.toast('保存を確認しました'); fillInputs(); guard.changed(); result = true; }
            else { guard.setState('unknown'); msg('保存を確認できませんでした。電波の良い所で「再送する」を押してください（同じ内容を送っても二重にはなりません）。', 'warn'); result = false; }
          });
        });
      });
      if (!started) return Promise.resolve(false);
      return new Promise(function (resolve) {
        (function wait() { if (C.isRunning('save')) setTimeout(wait, 100); else resolve(result); })();
      });
    }

    var guard = C.guardUnsaved({
      key: o.draftKey,
      isDirty: isDirty,
      snapshot: function () {
        var v = {}; KINDS.forEach(function (k) { v[k] = inputs[k].value; });
        return { date: st.date, site: st.site, values: v };
      },
      restore: function (d) {
        var apply = function () { KINDS.forEach(function (k) { if (d.values[k] != null) inputs[k].value = d.values[k]; }); renderRowMarks(); guard.changed(); };
        if (d.date && d.date !== st.date && !o.pickDate) {
          // 今日の画面は日付を変えられない。前日の下書きを今日の欄に入れると取り違えるので戻さない
          msg('下書きは ' + d.date + ' の分です。「生産入力」の画面で日付を ' + d.date + ' にして入れ直してください。', 'warn');
          return;
        }
        if (d.site) { st.site = d.site; renderSites(); }
        if (d.date && d.date !== st.date) { st.date = d.date; el.date.value = st.date; load(false).then(apply); }
        else { fillInputs(); apply(); }
      },
      save: save,
      bannerHost: o.bannerHost
    });

    // ---- 操作
    KINDS.forEach(function (k) {
      inputs[k].addEventListener('input', function () { renderRowMarks(); guard.changed(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('.step-btn'), function (b) {
      b.addEventListener('click', function () {
        var inp = inputs[b.dataset.k];
        var n = C.readNum(inp.value); if (n === null || isNaN(n)) n = 0;
        inp.value = Math.max(0, n + Number(b.dataset.d));
        renderRowMarks(); guard.changed();
      });
    });
    if (el.date) {
      el.date.addEventListener('change', function () {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(this.value) || !guard.confirmDiscard('日付を切り替え')) { this.value = st.date; return; }
        st.date = this.value; load(false);
      });
      el.today.addEventListener('click', function () {
        var t = st.opts ? st.opts.today : C.ymd(new Date());
        if (t === st.date || !guard.confirmDiscard('日付を切り替え')) return;
        st.date = t; el.date.value = t; load(false);
      });
    }
    el.save.addEventListener('click', save);

    // ---- 開始：初期値（今日・拠点一覧・所属拠点・1タンクの個数）→ その日の一覧
    var ready = C.api('production.options').then(function (opt) {
      st.opts = opt;
      st.tank = Number(opt.tankCapacity) || 42;
      el.tankNote.textContent = '1タンク＝' + st.tank + '個';
      st.date = opt.today;
      if (el.date) el.date.value = st.date;
      var last = '';
      try { last = root.localStorage.getItem(LS_SITE) || ''; } catch (e) { /* 無視 */ }
      var known = function (id) { return (opt.sites || []).some(function (s) { return s.id === id; }); };
      st.site = opt.defaultSite || (known(last) ? last : '');
      renderSites();
      return load(false);
    }).then(function () { guard.showBanner(); }, function (err) {
      msg('読み込めませんでした：' + err.message, 'ng');
    });

    return { ready: ready, reload: function () { return load(true); }, isDirty: isDirty };
  }

  var api = { mount: mount, KINDS: KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TougouSeisanForm = api;
})(typeof window !== 'undefined' ? window : globalThis);
