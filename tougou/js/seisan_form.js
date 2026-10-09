/*
 * 生産入力のフォーム（袋出し・浸水・収穫＋その日の入力済み一覧）。
 * seisan.html（生産入力。日付を選べる）と kyou.html（今日。日付は今日で固定）で共用する（指示 20260925-096200）。
 * 作業記録アプリ（/sagyou/。指示 20260925-097100）も同じものを使う。そのときだけ効く設定は下の「作業記録用」。
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
 *   linkSelector … 離脱を捕まえるアプリ内リンク（guardUnsaved に渡す）
 *  作業記録用（無ければ従来どおり）
 *   cacheKey  … 初期値（拠点・1タンクの個数）とその日の一覧を端末に置くキーの頭。あれば開いた瞬間に前回の内容で描き、裏で読み直す
 *   initialOptions … 端末に何も無いとき（初回）に使う初期値（production.options と同じ形）
 *   optimistic… true なら保存は押した瞬間に完了扱い（送信は裏で順番に）。失敗したらその時点で入力欄に戻して知らせる。
 *               送信待ちは端末（cacheKey + '.outbox'）に残し、次に開いたとき届いていなければ入力欄に戻す（自動では送り直さない）
 *   me        … { empId, name }（送信待ちの行を一覧に出すときの入力者）
 *   nameOf(row) … 一覧の入力者の表示（既定は row.empName）
 *   additive  … true なら袋出し・浸水は「足していく」入力（＋○個・＋○タンクをその日の合計に足す。production.add）。
 *               合計と入力者ごとの内訳を出し、自分の入力を1件ずつ取り消せる（production.cancel）。収穫は上書きのまま（指示 092000）
 *   dayToggle … true なら「今日／昨日」の切り替えを出す。昨日のあいだは画面の色を変えて「昨日（○/○）の分を入力中」と出す
 *   confirmOverwrite … true なら収穫にすでに値があるとき「すでに ○kg（入力者）が入っています。上書きしますか」と確かめる
 *   planEdit  … true なら袋出しの指示（予定の個数）を入れる欄と、指示と実績の差を出す（代表。production.planSet）。
 *               指示は planEdit でなくても「今日の指示：寄居 150個（杉）」と袋出しの上に出す（差・警告は出さない）
 * 戻り値 { ready: Promise, reload() }
 */
(function (root) {
  'use strict';

  var KINDS = ['fukurodashi', 'shinsui_1', 'shinsui_2', 'shinsui_3', 'shukaku_1', 'shukaku_2plus', 'shukaku_c'];
  var INT_KINDS = { fukurodashi: 1, shinsui_1: 1, shinsui_2: 1, shinsui_3: 1 };
  // 生産記録シートの表記（Production.gs の Prod_kinds_ と同じ）。送信待ちの行を一覧に出すときに使う
  var KIND_INFO = {
    fukurodashi: ['袋出し', '個'], shinsui_1: ['1番浸水', 'タンク'], shinsui_2: ['2番浸水', 'タンク'], shinsui_3: ['3番浸水', 'タンク'],
    shukaku_1: ['収穫_1番', 'kg'], shukaku_2plus: ['収穫_2番以降', 'kg'], shukaku_c: ['収穫_傷', 'kg']
  };
  // 画面に出す名前（Production.gs の name と同じ。2026-10-09）。N番浸水＝N番の後の浸水＝N+1番を出すための浸水。
  // 保存のキー（shinsui_1 等）とシートの種別（1番浸水 等）は変えない
  var KIND_NAME = {
    fukurodashi: '袋出し', shinsui_1: '浸水（2番用）', shinsui_2: '浸水（3番用）', shinsui_3: '浸水（4番用・例外）',
    shukaku_1: '収穫 1番', shukaku_2plus: '収穫 2番以降', shukaku_c: '収穫 傷'
  };
  var LS_SITE = 'tougou.today.site';          // GAS 版と同じキー（端末で前回選んだ拠点）
  var ADD_KINDS = { fukurodashi: 1, shinsui_1: 1, shinsui_2: 1, shinsui_3: 1 };   // 足していく入力の種別（Production.gs の PROD_ADD_KINDS と同じ）
  var UNIT = { fukurodashi: '個', shinsui_1: 'タンク', shinsui_2: 'タンク', shinsui_3: 'タンク' };

  function addDays(ymd, n) {
    var p = ymd.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2] + n);
    var p2 = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function md(ymd) { var p = String(ymd).split('-'); return Number(p[1]) + '/' + Number(p[2]); }

  function numInput(k, mode) {
    return '<input type="text" data-k="' + k + '" inputmode="' + mode + '"' + (mode === 'numeric' ? ' pattern="[0-9]*"' : '') +
      ' autocomplete="off" placeholder="—">';
  }
  // 足していく入力の行の下：合計と内訳・自分の入力の取り消し（additive のときだけ中身が入る）
  function addBox(k) { return '<div class="add-box" data-add="' + k + '"></div>'; }
  function shinsuiRow(n, additive) {
    var k = 'shinsui_' + n;
    return '<div class="frow" data-row="' + k + '">' +
      '<div class="frow-lbl">' + KIND_NAME[k] + (additive ? '<span class="add-tag">＋足す</span>' : '') +
      '<span class="srv"></span><div class="shinsui-sub" data-count="' + k + '"></div></div>' +
      '<div class="frow-inp"><button type="button" class="step-btn" data-k="' + k + '" data-d="-1" aria-label="1タンク減らす">－</button>' +
      numInput(k, 'numeric') +
      '<button type="button" class="step-btn" data-k="' + k + '" data-d="1" aria-label="1タンク増やす">＋</button></div></div>' +
      (additive ? addBox(k) : '');
  }
  function kgRow(k, label) {
    return '<div class="frow" data-row="' + k + '"><div class="frow-lbl">' + label + '<span class="srv"></span></div>' +
      '<div class="frow-inp">' + numInput(k, 'decimal') + '<span class="frow-unit">kg</span></div></div>';
  }

  function formHtml(o) {
    var add = !!o.additive;
    return (o.pickDate
      ? '<div class="fsec"><div class="frow"><div class="frow-lbl">日付</div><div class="frow-inp">' +
        '<input type="date" data-el="date"><button type="button" class="sbtn" data-el="today">今日</button></div></div></div>'
      : '') +
      (o.dayToggle
        ? '<div class="day-toggle" data-el="dayToggle"><button type="button" data-day="today" class="on">今日</button><button type="button" data-day="yday">昨日</button></div>' +
          '<div class="yday-bar" data-el="ydayBar" hidden></div>'
        : '') +
      '<div class="sec-lbl">袋出し</div>' +
      '<div class="plan-line" data-el="plan" hidden></div>' +
      '<div class="fsec"><div class="fsec-hdr">袋出し<span class="note">' + (add ? '入れた個数をその日の合計に足します' : 'その日の合計（上書き）') + '</span></div>' +
      '<div class="frow" data-row="fukurodashi"><div class="frow-lbl">袋出し' + (add ? '<span class="add-tag">＋足す</span>' : '') + '<span class="srv"></span></div>' +
      '<div class="frow-inp">' + numInput('fukurodashi', 'numeric') + '<span class="frow-unit">個</span></div></div>' +
      (add ? addBox('fukurodashi') : '') + '</div>' +
      '<div class="sec-lbl">浸水</div>' +
      '<div class="fsec"><div class="fsec-hdr">浸水<span class="note" data-el="tankNote">1タンク＝42個</span></div>' +
      (add ? '<div class="add-note">浸水したタンク数を入れると、その日の合計に足します（ほかの人の分は消えません）。</div>' : '') +
      shinsuiRow(1, add) + shinsuiRow(2, add) +
      // 4番用は例外なので初めはたたんでおく（保存済みの値があれば開く）
      '<details data-el="rare" style="border-top:1px solid var(--border)"><summary style="padding:10px var(--pad-card,14px);font-size:13px;color:var(--sub);cursor:pointer">' +
      '例外：' + KIND_NAME.shinsui_3 + '</summary>' + shinsuiRow(3, add) + '</details></div>' +
      '<div class="sec-lbl">収穫</div>' +
      '<div class="fsec"><div class="fsec-hdr">収穫<span class="note">kg・その日の合計（上書き）</span></div>' +
      kgRow('shukaku_1', '1番') + kgRow('shukaku_2plus', '2番以降') + kgRow('shukaku_c', '傷（C品）') + '</div>' +
      '<div class="sec-lbl" style="margin-top:4px">' + (add
        ? '袋出し・浸水は足した分を下の「取り消す」で取り消せます。収穫は空欄なら送りません（前の値のまま）。取り消しは 0 を入れて保存。'
        : '空欄の欄は送りません（前の値のまま）。取り消しは 0 を入れて保存。') + '</div>' +
      '<button type="button" class="submit-btn" data-el="save">💾 保存する</button>' +
      '<div class="sec-lbl">入力済み <span data-el="listDate"></span></div>' +
      '<div class="fsec" data-el="list"><div class="empty">読み込み中…</div></div>';
  }

  function mount(o) {
    var C = root.TougouCommon;
    var host = o.host;
    host.innerHTML = formHtml(o);
    var q = function (sel) { return host.querySelector(sel); };
    var el = { date: q('[data-el="date"]'), today: q('[data-el="today"]'), tankNote: q('[data-el="tankNote"]'), rare: q('[data-el="rare"]'),
               save: q('[data-el="save"]'), list: q('[data-el="list"]'), listDate: q('[data-el="listDate"]'),
               dayToggle: q('[data-el="dayToggle"]'), ydayBar: q('[data-el="ydayBar"]'), plan: q('[data-el="plan"]') };
    var msg = o.msg || function () {};
    var additive = !!o.additive;
    var isAdd = function (k) { return additive && !!ADD_KINDS[k]; };
    // base＝サーバから読んだ行、rows＝base に送信待ちを重ねたもの（画面はこちらを見る）
    // entries＝足していく入力（サーバ）、ents＝それに送信待ちを重ねたもの。plans＝袋出しの指示。day＝'today'|'yday'（dayToggle）
    var st = { opts: null, date: '', site: '', base: [], rows: [], seq: 0, tank: 42, touched: {}, loaded: false,
               entries: [], ents: [], plans: [], day: 'today' };
    var inputs = {};
    KINDS.forEach(function (k) { inputs[k] = q('input[data-k="' + k + '"]'); });

    // ---- 端末の控え（作業記録用。cacheKey が無ければ何もしない）
    function cacheGet(name) {
      if (!o.cacheKey) return null;
      try { return JSON.parse(root.localStorage.getItem(o.cacheKey + '.' + name) || 'null'); } catch (e) { return null; }
    }
    function cachePut(name, v) {
      if (!o.cacheKey) return;
      try {
        if (v == null) root.localStorage.removeItem(o.cacheKey + '.' + name);
        else root.localStorage.setItem(o.cacheKey + '.' + name, JSON.stringify(v));
      } catch (e) { /* 容量超などは無視（控えが無いだけ） */ }
    }
    var outbox = (o.optimistic && cacheGet('outbox')) || [];   // [{ records:[{date,site,kind,value}], at }]
    function saveOutbox() { cachePut('outbox', outbox.length ? outbox : null); }

    function nowFull() {
      var d = new Date(), p2 = function (n) { return String(n).padStart(2, '0'); };
      return C.ymd(d) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    }
    function siteName(id) {
      var s = ((st.opts && st.opts.sites) || []).filter(function (x) { return x.id === id; })[0];
      return s ? (s.name || s.id) : id;
    }
    /** 送信待ちを一覧の行の形にする（シートの1行と同じ列名） */
    function pendingRow(rec) {
      var info = KIND_INFO[rec.kind], me = o.me || {};
      return {
        '拠点': rec.site, '種別': info[0], '入力値': String(rec.value), '入力単位': info[1],
        '個数': info[1] === 'タンク' ? rec.value * st.tank : info[1] === '個' ? rec.value : '',
        '入力者': me.empId || '', '更新日時': nowFull(), siteName: siteName(rec.site),
        empName: me.name || '', empSurname: me.name || '', kind: rec.kind, _pending: true
      };
    }
    function overlay() {
      var rows = st.base.slice(), ents = st.entries.slice(), me = o.me || {};
      outbox.forEach(function (job) {
        var type = job.type || 'upsert';   // 前の版の送信待ちは type なし＝上書き
        job.records.forEach(function (rec) {
          if (rec.date !== st.date) return;
          var i = -1;
          rows.forEach(function (r, j) { if (r['拠点'] === rec.site && r.kind === rec.kind) i = j; });
          if (type === 'upsert') { if (i >= 0) rows[i] = pendingRow(rec); else rows.push(pendingRow(rec)); return; }
          // 足していく入力・取り消し：合計を送信待ちの分だけ動かす
          var cur = i >= 0 ? (C.readNum(rows[i]['入力値']) || 0) : 0;
          var sign = type === 'add' ? 1 : -1;
          var pr = pendingRow({ site: rec.site, kind: rec.kind, value: Math.max(0, cur + sign * rec.value) });
          if (i >= 0) rows[i] = pr; else rows.push(pr);
          if (type === 'add') ents.push({ id: rec.id, at: nowFull(), date: rec.date, site: rec.site, kind: rec.kind, value: rec.value,
                                          empId: me.empId || '', surname: me.name || '', _pending: true });
          else ents = ents.filter(function (e) { return e.id !== rec.id; });
        });
      });
      st.rows = rows;
      st.ents = ents;
    }

    // ---- 保存済みの値（その日・その拠点）
    function valueIn(rows, site, kind) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r['拠点'] === site && r.kind === kind) {
          // シートの表示値（getDisplayValues）なので「1,200」のような書式が付くことがある
          var n = C.readNum(r['入力値']);
          return (n === null || isNaN(n)) ? String(r['入力値']) : String(n);
        }
      }
      return '';
    }
    function serverValue(kind) { return valueIn(st.rows, st.site, kind); }
    /** 送る対象：空欄でなく、保存済みの値と違う欄。{ kind: 数値 } か、読めない欄があれば文字列 */
    function pending() {
      var out = {}, bad = '';
      KINDS.forEach(function (k) {
        var v = C.readNum(inputs[k].value);
        if (v === null) return;
        if (isNaN(v)) { bad = '数字で入れてください。'; return; }
        if (INT_KINDS[k] && v !== Math.floor(v)) { bad = (k === 'fukurodashi' ? '袋出しは個数' : 'タンク数') + 'を整数で入れてください。'; return; }
        if (isAdd(k)) { if (v > 0) out[k] = v; return; }   // 足していく入力：入れた数をそのまま足す（0・空欄は送らない）
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
    var dayWord = function () { return st.day === 'yday' ? '昨日' : '今日'; };
    /** その日・その拠点の足していく入力（送信待ちを含む） */
    function entsOf(site, kind) { return st.ents.filter(function (e) { return e.site === site && e.kind === kind; }); }
    /** 入力者ごとの内訳（八島 2・新井 3）。入力がまだ無く行だけある（足していく方式の前の入力）ときは行の入力者 */
    function breakdown(site, kind) {
      var es = entsOf(site, kind), sum = {}, order = [];
      es.forEach(function (e) {
        var n = e.surname || e.empId;
        if (!(n in sum)) { sum[n] = 0; order.push(n); }
        sum[n] += Number(e.value) || 0;
      });
      if (!es.length) {
        var r = st.rows.filter(function (x) { return x['拠点'] === site && x.kind === kind; })[0];
        var who = o.nameOf || function (x) { return x.empName || ''; };
        return r && C.readNum(r['入力値']) ? who(r) + ' ' + C.readNum(r['入力値']) : '';
      }
      return order.filter(function (n) { return sum[n] !== 0; }).map(function (n) { return n + ' ' + sum[n]; }).join('・');
    }
    function renderAddBox(k) {
      var box = q('[data-add="' + k + '"]');
      if (!box) return;
      var total = C.readNum(serverValue(k)) || 0, unit = UNIT[k], me = (o.me || {}).empId;
      var bd = breakdown(st.site, k);
      var h = '<div class="add-sum">' + dayWord() + 'の合計 <b>' + total.toLocaleString() + unit + '</b>' +
        (unit === 'タンク' && total ? '（' + (total * st.tank).toLocaleString() + '個）' : '') + (bd ? '（' + C.esc(bd) + '）' : '') + '</div>';
      var mine = entsOf(st.site, k).filter(function (e) { return e.empId === me; });
      if (mine.length) {
        h += '<div class="add-mine">' + mine.map(function (e) {
          return '<span class="add-item">あなたの入力 ＋' + C.esc(e.value) + unit + '（' + C.esc(String(e.at).slice(11, 16)) + '）' +
            (e._pending ? ' 送信中' : '<button type="button" class="add-cancel" data-id="' + C.esc(e.id) + '">取り消す</button>') + '</span>';
        }).join('') + '</div>';
      }
      box.innerHTML = h;
      Array.prototype.forEach.call(box.querySelectorAll('.add-cancel'), function (b) {
        b.onclick = function () { cancelEntry(b.dataset.id); };
      });
    }
    function renderRowMarks() {
      KINDS.forEach(function (k) {
        var row = q('[data-row="' + k + '"]');
        var sv = serverValue(k);
        var v = C.readNum(inputs[k].value);
        if (isAdd(k)) {
          row.querySelector('.srv').textContent = '';
          row.classList.toggle('chg', v !== null && v > 0);
          renderAddBox(k);
        } else {
          row.querySelector('.srv').textContent = sv === '' ? '' : '保存済み ' + sv;
          row.classList.toggle('chg', v !== null && !(sv !== '' && Number(sv) === v));
        }
        var c = q('[data-count="' + k + '"]');
        if (c) c.textContent = (isAdd(k) && v ? '＋' : '') + countText(k);
      });
      // 4番用に保存済みの値・入力があれば、たたまずに見せる
      if (el.rare && (serverValue('shinsui_3') !== '' || C.readNum(inputs.shinsui_3.value) !== null)) el.rare.open = true;
      renderPlan();
    }
    /** 入力欄を保存済みの値にする（足していく欄は空にする）。soft なら、この画面を開いてから手で触った欄はそのまま */
    function fillInputs(soft) {
      KINDS.forEach(function (k) { if (!(soft && st.touched[k])) inputs[k].value = isAdd(k) ? '' : serverValue(k); });
      if (!soft) st.touched = {};
      renderRowMarks();
    }

    // ---- 袋出しの指示（「今日の指示：寄居 150個（杉）」。planEdit なら入力欄と、指示と実績の差）
    function renderPlan() {
      if (!el.plan) return;
      var p = st.plans.filter(function (x) { return x.site === st.site; })[0];
      var word = st.day === 'yday' ? '昨日' : (o.pickDate && st.opts && st.date !== st.opts.today ? md(st.date) + ' ' : '今日');
      var text = p ? word + 'の指示：' + siteName(p.site).replace(/ハウス$/, '') + ' ' + Number(p.count).toLocaleString() + '個' + (p.surname ? '（' + p.surname + '）' : '') : '';
      if (!o.planEdit) {
        el.plan.hidden = !p;
        el.plan.textContent = text;
        return;
      }
      var actual = C.readNum(serverValue('fukurodashi'));
      var diff = p && actual !== null ? actual - p.count : null;
      el.plan.hidden = false;
      el.plan.innerHTML = '<div>' + (p ? C.esc(text) : '袋出しの指示：まだありません') +
        (p ? '　実績 ' + (actual === null ? '未入力' : actual.toLocaleString() + '個') +
          (diff === null ? '' : '（差 ' + (diff > 0 ? '＋' : diff < 0 ? '−' : '±') + Math.abs(diff).toLocaleString() + '個）') : '') + '</div>' +
        '<div class="plan-edit">指示 <input type="text" inputmode="numeric" pattern="[0-9]*" data-el="planInp" placeholder="—" value="' + (p ? C.esc(p.count) : '') + '">個 ' +
        '<button type="button" class="sbtn" data-el="planSave">指示を保存</button></div>';
      el.plan.querySelector('[data-el="planSave"]').onclick = savePlan;
    }
    function savePlan() {
      var inp = el.plan.querySelector('[data-el="planInp"]');
      var v = String(inp.value).trim() === '' ? '' : C.readNum(inp.value);
      if (v !== '' && (v === null || isNaN(v) || v !== Math.floor(v))) { msg('指示の個数は整数で入れてください。', 'ng'); return; }
      if (!st.site) { msg('拠点を選んでください。', 'ng'); return; }
      C.showLoading('保存中...');
      C.api('production.planSet', { plan: { date: st.date, site: st.site, value: v } }).then(function () {
        C.hideLoading(); msg(''); C.toast('指示を保存しました（' + st.date + '）');
        return load(true);
      }, function (err) { C.hideLoading(); msg('指示を保存できませんでした：' + err.message, 'ng'); });
    }

    function renderList() {
      el.listDate.textContent = st.date + (st.loaded ? '' : '（更新中…）');
      var rows = st.rows.slice().sort(function (a, b) {
        if (a['拠点'] !== b['拠点']) return a['拠点'] < b['拠点'] ? -1 : 1;
        return KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
      });
      if (!rows.length) {
        el.list.innerHTML = '<div class="empty">' + (st.loaded ? 'この日の入力はまだありません。' : '読み込み中…') + '</div>';
        return;
      }
      var who = o.nameOf || function (r) { return r.empName || ''; };
      var h = '<table class="tbl"><tr><th>種別</th><th>入力</th><th>個数</th><th>入力者</th></tr>', last = null;
      rows.forEach(function (r) {
        if (r['拠点'] !== last) { last = r['拠点']; h += '<tr class="grp"><td colspan="4">' + C.esc(r.siteName) + '</td></tr>'; }
        h += '<tr' + (Number(r['入力値']) === 0 ? ' class="zero"' : '') + '>' +
          '<td>' + C.esc(KIND_NAME[r.kind] || String(r['種別']).replace('収穫_', '収穫 ')) + '</td>' +
          '<td class="num">' + C.esc(r['入力値'] + ' ' + r['入力単位']) + '</td>' +
          '<td class="num">' + (r['個数'] ? Number(r['個数']).toLocaleString() + '個' : '') + '</td>' +
          '<td>' + C.esc(isAdd(r.kind) && breakdown(r['拠点'], r.kind)
            ? breakdown(r['拠点'], r.kind) + (r._pending ? ' 送信中' : '')
            : who(r) + ' ' + (r._pending ? '送信中' : String(r['更新日時']).slice(11, 16))) + '</td></tr>';
      });
      el.list.innerHTML = h + '</table>';
    }

    // ---- 読み込み
    /** mode：false＝入力欄を保存済みの値にする／true＝入力欄はそのまま／'soft'＝触っていない欄だけ保存済みの値にする */
    function load(mode) {
      var my = ++st.seq;   // 日付を続けて変えたとき、古い応答で上書きしない
      var date = st.date;
      var fresh = mode === false || !st.rows.length;   // 日付を変えた・保存した直後は前の一覧を消す（従来どおり）
      if (fresh) el.list.innerHTML = '<div class="empty">読み込み中…</div>';
      return C.api('production.list', { date: date }).then(function (res) {
        if (my !== st.seq) return false;
        st.base = res.rows || [];
        st.entries = res.entries || [];
        st.plans = res.plans || [];
        st.loaded = true;
        overlay();
        cachePut('rows', { date: date, rows: st.base, entries: st.entries, plans: st.plans });
        renderList();
        if (mode === true) renderRowMarks(); else fillInputs(mode === 'soft');
        guard.changed();
        if (o.onRows) o.onRows(st.rows, st.date);
        return true;
      }, function (err) {
        if (my !== st.seq) return false;
        if (fresh) { el.list.innerHTML = '<div class="empty">読み込めませんでした。</div>'; st.base = []; st.entries = []; st.plans = []; st.loaded = false; overlay(); renderRowMarks(); }
        msg(err.message, 'ng');
        return false;
      });
    }

    // ---- 保存（二重送信防止：runOnce＋日報と同じ「送信中...」の覆い）
    function collect() {
      var p = pending();
      if (!st.site) { msg('拠点を選んでください。', 'ng'); return null; }
      if (typeof p === 'string') { msg(p, 'ng'); return null; }
      var kinds = Object.keys(p);
      if (!kinds.length) { C.toast('変えた欄がありません'); return []; }
      if (o.confirmOverwrite) {
        // 収穫は1日の合計の上書き。すでにほかの値が入っていれば確かめる（まとめて入れる人が二重に入れないように）
        var who = o.nameOf || function (r) { return r.empName || ''; };
        var over = kinds.filter(function (k) { return !isAdd(k) && /^shukaku_/.test(k) && C.readNum(serverValue(k)); }).map(function (k) {
          var r = st.rows.filter(function (x) { return x['拠点'] === st.site && x.kind === k; })[0];
          return KIND_NAME[k] + ' ' + serverValue(k) + 'kg（' + (r ? who(r) : '') + '）';
        });
        if (over.length && !root.confirm('すでに ' + over.join('、') + ' が入っています。上書きしますか')) {
          msg('保存をやめました（入力した値は欄に残っています）。', 'info');
          return null;
        }
      }
      return kinds.map(function (k) { return { date: st.date, site: st.site, kind: k, value: p[k] }; });
    }
    function newId() { return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
    /** 送る単位に分ける：上書き（upsertMany）と足していく入力（add。1件ずつ ID を付ける） */
    function jobsOf(records) {
      var up = records.filter(function (r) { return !isAdd(r.kind); });
      var add = records.filter(function (r) { return isAdd(r.kind); }).map(function (r) { return Object.assign({ id: newId() }, r); });
      var jobs = [], at = nowFull();
      if (up.length) jobs.push({ type: 'upsert', records: up, at: at });
      if (add.length) jobs.push({ type: 'add', records: add, at: at });
      return jobs;
    }
    function callJob(job) {
      if (job.type === 'add') return C.api('production.add', { records: job.records });
      if (job.type === 'cancel') return C.api('production.cancel', { id: job.records[0].id });
      return C.api('production.upsertMany', { records: job.records });
    }

    function save() {
      if (o.optimistic) return saveOptimistic();
      var records = collect();
      if (!records) return Promise.resolve(false);
      if (!records.length) return Promise.resolve(true);
      var jobs = jobsOf(records);
      records = jobs.filter(function (j) { return j.type === 'upsert'; }).map(function (j) { return j.records; })[0] || [];
      var result = null;
      var started = C.runOnce('save', el.save, '保存しています…', function () {
        guard.setState('saving');
        C.showLoading('保存中...');
        return jobs.reduce(function (p, job) { return p.then(function () { return callJob(job); }); }, Promise.resolve()).then(function () {
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
            var ok = loaded && jobs.every(jobArrived);
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

    // ---- 保存（作業記録用：押した瞬間に完了扱い。送信は裏で1件ずつ順番に）
    var sending = false;
    function saveOptimistic() {
      var records = collect();
      if (!records) return Promise.resolve(false);
      if (!records.length) return Promise.resolve(true);
      outbox = outbox.concat(jobsOf(records));
      saveOutbox();
      overlay();
      fillInputs(false);
      renderList();
      msg('');
      guard.setState('saving');
      guard.changed();
      C.toast(st.day === 'yday' ? '昨日（' + md(st.date) + '）の分を保存しました' : '保存しました');
      pump();
      return Promise.resolve(true);
    }
    /** 送った値がサーバの一覧に入っているか（base で見る） */
    function arrived(rec) {
      if (rec.date !== st.date) return false;
      var sv = valueIn(st.base, rec.site, rec.kind);
      return sv !== '' && Number(sv) === rec.value;
    }
    /** 送信がサーバに届いているか。足していく入力は ID がサーバの入力にあるか、取り消しは無くなっているか */
    function jobArrived(job) {
      var has = function (id) { return st.entries.some(function (e) { return e.id === id; }); };
      return job.records.every(function (rec) {
        if (job.type === 'add') return rec.date === st.date && has(rec.id);
        if (job.type === 'cancel') return rec.date === st.date && !has(rec.id);
        return arrived(rec);
      });
    }
    /** 自分の足していく入力を1件取り消す（送信は保存と同じ順番待ちに載せる） */
    function cancelEntry(id) {
      var e = st.ents.filter(function (x) { return x.id === id; })[0];
      if (!e) return;
      if (!root.confirm(KIND_NAME[e.kind] + ' ＋' + e.value + UNIT[e.kind] + '（' + String(e.at).slice(11, 16) + ' の入力）を取り消しますか')) return;
      var job = { type: 'cancel', records: [{ id: e.id, date: e.date, site: e.site, kind: e.kind, value: Number(e.value) || 0 }], at: nowFull() };
      if (!o.optimistic) {
        C.showLoading('取り消し中...');
        C.api('production.cancel', { id: id }).then(function () { C.hideLoading(); C.toast('取り消しました'); return load(true); },
          function (err) { C.hideLoading(); msg('取り消せませんでした：' + err.message, 'ng'); });
        return;
      }
      outbox.push(job); saveOutbox();
      overlay(); renderRowMarks(); renderList();
      guard.setState('saving');
      C.toast('取り消しました');
      pump();
    }
    function pump() {
      if (sending) return;
      if (!outbox.length) { guard.setState(''); return; }
      sending = true;
      var job = outbox[0];
      callJob(job).then(function () {
        outbox.shift(); saveOutbox(); sending = false;
        if (outbox.length) { pump(); return; }
        guard.setState('');
        load('soft');
      }, function (err) {
        if (!err.network) { sending = false; giveBack('failed', '保存できませんでした：' + err.message); return; }
        // 届いたか分からない → 一覧を読み直して確かめる（upsert なので再送しても二重にはならない）
        load(true).then(function (loaded) {
          sending = false;
          if (loaded && jobArrived(job)) {
            outbox.shift(); saveOutbox();
            overlay(); renderList();
            pump();
          } else {
            giveBack('unknown', '保存を確認できませんでした。電波の良い所で「再送する」を押してください（同じ内容を送っても二重にはなりません）。');
          }
        });
      });
    }
    /**
     * 届かなかった送信待ちを全部入力欄に戻す（未保存として扱う → 未保存バー・下書き・離脱の警告が効く）。
     * 拠点が今と違えばその拠点に切り替える。ほかの拠点・日付の分は文言で知らせる。
     */
    function giveBack(state, text) {
      var recs = [], cancels = [];
      outbox.forEach(function (job) {
        if (job.type === 'cancel') cancels = cancels.concat(job.records);
        else recs = recs.concat(job.records.map(function (r) { return Object.assign({ _add: job.type === 'add' }, r); }));
      });
      outbox = []; saveOutbox();
      overlay();
      var mine = recs.filter(function (r) { return r.date === st.date; });
      var site = mine.length ? mine[0].site : st.site;
      var typed = site === st.site ? st.touched : {};   // 送信待ちの間に同じ欄へ打ち直した値の方を残す
      if (site !== st.site) {
        st.site = site;
        try { root.localStorage.setItem(LS_SITE, st.site); } catch (e) { /* 無視 */ }
        renderSites();
        fillInputs(false);
      } else {
        fillInputs(true);   // 送信待ちの間に打ち始めた欄は消さない
      }
      var addSum = {};
      mine.forEach(function (r) {
        if (r.site !== site || typed[r.kind]) return;
        // 足していく入力は、届かなかった分を合わせて欄に戻す（送り直すと新しい入力として足す）
        if (r._add) addSum[r.kind] = (addSum[r.kind] || 0) + r.value;
        inputs[r.kind].value = String(r._add ? addSum[r.kind] : r.value);
        st.touched[r.kind] = true;
      });
      var others = recs.filter(function (r) { return r.date !== st.date || r.site !== site; }).map(function (r) {
        return r.date + ' ' + siteName(r.site) + ' ' + KIND_NAME[r.kind] + ' ' + (r._add ? '＋' : '') + r.value;
      });
      if (cancels.length) text += '\n取り消しが届いていない入力があります：' + cancels.map(function (r) {
        return r.date + ' ' + siteName(r.site) + ' ' + KIND_NAME[r.kind] + ' ＋' + r.value;
      }).join('、') + '（もう一度「取り消す」を押してください）';
      renderRowMarks(); renderList();
      guard.changed();
      guard.setState(state);
      msg(text + (others.length ? '\nほかに届いていない分：' + others.join('、') + '（拠点を切り替えて入れ直してください）' : ''), state === 'failed' ? 'ng' : 'warn');
      if (root.navigator && root.navigator.vibrate) try { root.navigator.vibrate([80, 60, 80]); } catch (e) { /* 無視 */ }
    }

    var guard = C.guardUnsaved({
      key: o.draftKey,
      isDirty: isDirty,
      snapshot: function () {
        var v = {}; KINDS.forEach(function (k) { v[k] = inputs[k].value; });
        return { date: st.date, site: st.site, values: v };
      },
      restore: function (d) {
        var apply = function () {
          KINDS.forEach(function (k) { if (d.values[k] != null) { inputs[k].value = d.values[k]; st.touched[k] = true; } });
          renderRowMarks(); guard.changed();
        };
        if (d.date && d.date !== st.date && !o.pickDate && o.dayToggle && d.date === addDays(todayYmd(), st.day === 'yday' ? 0 : -1)) {
          // 今日／昨日の切り替えがある画面：下書きの日に切り替えて戻す
          st.day = st.day === 'yday' ? 'today' : 'yday'; st.date = d.date; renderDay();
          if (d.site) { st.site = d.site; renderSites(); }
          load(false).then(apply);
          return;
        }
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
      bannerHost: o.bannerHost,
      linkSelector: o.linkSelector
    });

    // ---- 操作
    KINDS.forEach(function (k) {
      inputs[k].addEventListener('input', function () { st.touched[k] = true; renderRowMarks(); guard.changed(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('.step-btn'), function (b) {
      b.addEventListener('click', function () {
        var inp = inputs[b.dataset.k];
        var n = C.readNum(inp.value); if (n === null || isNaN(n)) n = 0;
        inp.value = Math.max(0, n + Number(b.dataset.d));
        st.touched[b.dataset.k] = true;
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

    // ---- 今日／昨日（dayToggle。収穫を翌朝にまとめて入れるため）
    function todayYmd() { return (st.opts && st.opts.today) || C.ymd(new Date()); }
    function dateOfDay() { return st.day === 'yday' ? addDays(todayYmd(), -1) : todayYmd(); }
    function renderDay() {
      if (!el.dayToggle) return;
      var y = st.day === 'yday';
      Array.prototype.forEach.call(el.dayToggle.children, function (b) { b.classList.toggle('on', b.dataset.day === st.day); });
      el.ydayBar.hidden = !y;
      el.ydayBar.textContent = '昨日（' + md(st.date) + '）の分を入力中';
      host.classList.toggle('is-yday', y);
      if (root.document && root.document.body) root.document.body.classList.toggle('form-yday', y);
    }
    if (el.dayToggle) {
      Array.prototype.forEach.call(el.dayToggle.children, function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.day === st.day || !guard.confirmDiscard('日付を切り替え')) return;
          st.day = b.dataset.day;
          st.date = dateOfDay();
          st.base = []; st.entries = []; st.plans = []; st.loaded = false;
          msg('');
          renderDay(); overlay(); fillInputs(false); renderList();
          load(false);
        });
      });
    }

    // ---- 開始：初期値（今日・拠点一覧・所属拠点・1タンクの個数）→ その日の一覧
    function applyOptions(opt) {
      st.opts = opt;
      st.tank = Number(opt.tankCapacity) || 42;
      el.tankNote.textContent = '1タンク＝' + st.tank + '個';
      var last = '';
      try { last = root.localStorage.getItem(LS_SITE) || ''; } catch (e) { /* 無視 */ }
      var known = function (id) { return (opt.sites || []).some(function (s) { return s.id === id; }); };
      if (!known(st.site)) st.site = opt.defaultSite || (known(last) ? last : '');
      renderSites();
    }

    var ready;
    var early = o.cacheKey ? (cacheGet('opts') || o.initialOptions || null) : null;
    if (!early) {
      ready = C.api('production.options').then(function (opt) {
        applyOptions(opt);
        st.date = opt.today;
        if (el.date) el.date.value = st.date;
        return load(false);
      }).then(function () { guard.showBanner(); }, function (err) {
        msg('読み込めませんでした：' + err.message, 'ng');
      });
    } else {
      // 作業記録：前回の控えで即座に描き、初期値と一覧は裏で同時に取りに行く
      st.date = C.ymd(new Date());
      applyOptions(early);
      var rc = cacheGet('rows');
      if (rc && rc.date === st.date) { st.base = rc.rows || []; st.entries = rc.entries || []; st.plans = rc.plans || []; }
      overlay(); renderList(); fillInputs(true);
      var unconfirmed = outbox.length > 0;   // 前回、届いたのを見届ける前に閉じた送信
      var listP = load('soft');
      var optP = C.api('production.options').then(function (opt) {
        cachePut('opts', { sites: opt.sites, tankCapacity: opt.tankCapacity, defaultSite: opt.defaultSite });
        applyOptions(opt);
        renderRowMarks();
        if (opt.today && dateOfDay() !== st.date) { st.date = dateOfDay(); renderDay(); return load('soft'); }
      }, function () { /* 控えのまま続ける（一覧の読み込みの方で知らせる） */ });
      ready = Promise.all([listP, optP]).then(function (r) {
        if (unconfirmed) {
          // 自動では送り直さない（サーバに書くのは人が保存を押したときだけ）。届いていれば消し、届いていなければ入力欄に戻す
          if (!r[0]) return;   // 一覧が読めない（圏外）→ 送信待ちのまま次の機会に確かめる
          outbox = outbox.filter(function (job) { return !jobArrived(job); });
          saveOutbox();
          if (outbox.length) giveBack('unknown', '前回の保存が届いたか確認できていません。内容を確かめて「再送する」を押してください。');
          else { overlay(); renderList(); fillInputs(true); }
        }
        guard.showBanner();
      });
    }

    return { ready: ready, reload: function () { return load(true); }, isDirty: isDirty };
  }

  var api = { mount: mount, KINDS: KINDS, KIND_NAME: KIND_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TougouSeisanForm = api;
})(typeof window !== 'undefined' ? window : globalThis);
