/*
 * 菌床の移動の入力（作業記録 next/sagyou.html に置く。2026-10-29 菌床在庫）。
 *
 *   SgIdou.mount({ host, me:{ empId, name }, cacheKey, sites:[{id,name}] }) → { reload() }
 *
 * - 日付（今日／昨日）・移動元→移動先・状態（1番／休養中／2番／3番）・数（コンテナ または 個。1コンテナ＝8個）
 * - 1番・3番はラベルの日付を任意で指定できる（空欄なら 1番は新しい日付から、3番は古い日付から動いたとみなす。Zaiko.gs）
 * - 足していく入力（zaiko.moveAdd）。押した瞬間に一覧へ「送信中」で出し、裏で送る。
 *   ID は端末で作るので、届いたか分からないときに「再送する」を押しても二重にならない。届かなければ入力欄に戻す
 * - 自分の分だけ取り消せる（zaiko.moveCancel）
 * 共通部品 TougouCommon（api・esc・toast・now・ymd・readNum）を使う。
 */
(function (root) {
  'use strict';

  var STAGES = [['ichiban', '1番'], ['kyuyou', '休養中'], ['niban', '2番'], ['sanban', '3番']];
  var STAGE_NAME = { ichiban: '1番', kyuyou: '休養中', niban: '2番', sanban: '3番' };

  function addDays(ymd, n) {
    var p = ymd.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2] + n);
    var p2 = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function md(ymd) { var p = String(ymd).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function newId() { return 'mv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function short(name) { return String(name || '').replace(/ハウス$/, ''); }

  function mount(o) {
    var C = root.TougouCommon;
    var host = o.host;
    var sites = o.sites && o.sites.length ? o.sites : [{ id: 'yorii', name: '寄居ハウス' }, { id: 'shinrin', name: '森林公園ハウス' }];
    var KEY = (o.cacheKey || 'sg.work.cache') + '.idou.outbox';
    var st = { today: C.ymd(C.now()), day: 'today', dir: 0, stage: '', unit: 'container', container: 8, moves: [], loaded: false, seq: 0 };
    var dirs = [];
    if (sites.length >= 2) dirs = [[sites[0].id, sites[1].id], [sites[1].id, sites[0].id]];
    var nameOf = function (id) { var s = sites.filter(function (x) { return x.id === id; })[0]; return s ? short(s.name) : id; };

    function lsGet() { try { return JSON.parse(root.localStorage.getItem(KEY) || '[]') || []; } catch (e) { return []; } }
    function lsPut(v) { try { if (v.length) root.localStorage.setItem(KEY, JSON.stringify(v)); else root.localStorage.removeItem(KEY); } catch (e) { /* 無視 */ } }
    var pending = lsGet();   // [{ rec, state:'sending'|'unknown' }]

    host.innerHTML =
      '<div class="sec-lbl">移動</div>' +
      '<div class="fsec idou">' +
      '<div class="fsec-hdr">菌床の移動<span class="note">拠点の間で運んだら記録</span></div>' +
      '<div class="idou-row"><div class="idou-lbl">日付</div><div class="idou-btns" data-el="day">' +
      '<button type="button" data-v="today" class="on">今日</button><button type="button" data-v="yday">昨日</button></div></div>' +
      '<div class="idou-row"><div class="idou-lbl">どこから</div><div class="idou-btns" data-el="dir">' +
      dirs.map(function (d, i) { return '<button type="button" data-v="' + i + '"' + (i === 0 ? ' class="on"' : '') + '>' + C.esc(nameOf(d[0])) + ' → ' + C.esc(nameOf(d[1])) + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="idou-row"><div class="idou-lbl">状態</div><div class="idou-btns" data-el="stage">' +
      STAGES.map(function (s) { return '<button type="button" data-v="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="idou-row"><div class="idou-lbl">数</div><div class="idou-num">' +
      '<input type="text" data-el="num" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="—">' +
      '<div class="idou-btns idou-unit" data-el="unit"><button type="button" data-v="container" class="on">コンテナ</button><button type="button" data-v="piece">個</button></div>' +
      '</div></div>' +
      '<div class="idou-count" data-el="count"></div>' +
      '<details class="idou-label" data-el="labelBox" hidden><summary>ラベルの日付を指定する（わかるときだけ）</summary>' +
      '<div class="idou-label-in"><input type="date" data-el="label"> <span class="idou-label-note" data-el="labelNote"></span></div></details>' +
      '<button type="button" class="submit-btn idou-save" data-el="save">🚚 移動を記録する</button>' +
      '<div class="idou-msg" data-el="msg"></div>' +
      '<div class="idou-list-hd" data-el="listHd"></div>' +
      '<div class="idou-list" data-el="list"><div class="empty">読み込み中…</div></div>' +
      '</div>';
    var q = function (s) { return host.querySelector('[data-el="' + s + '"]'); };
    var el = { day: q('day'), dir: q('dir'), stage: q('stage'), num: q('num'), unit: q('unit'), count: q('count'), labelBox: q('labelBox'),
               label: q('label'), labelNote: q('labelNote'), save: q('save'), msg: q('msg'), list: q('list'), listHd: q('listHd') };

    function date() { return st.day === 'yday' ? addDays(st.today, -1) : st.today; }
    function say(text, kind) { el.msg.innerHTML = text ? '<div class="notice ' + (kind || 'info') + '">' + C.esc(text) + '</div>' : ''; }
    function mark(box, v) { Array.prototype.forEach.call(box.children, function (b) { b.classList.toggle('on', b.dataset.v === String(v)); }); }
    function beds() {
      var n = C.readNum(el.num.value);
      if (n === null || isNaN(n)) return null;
      return st.unit === 'container' ? n * st.container : n;
    }
    function render() {
      mark(el.day, st.day); mark(el.dir, st.dir); mark(el.stage, st.stage); mark(el.unit, st.unit);
      el.unit.children[0].textContent = 'コンテナ（' + st.container + '個）';
      var b = beds();
      el.count.textContent = b ? '＝ ' + b.toLocaleString() + '個' + (st.stage ? '（' + STAGE_NAME[st.stage] + '）' : '') : '';
      var dated = st.stage === 'ichiban' || st.stage === 'sanban';
      el.labelBox.hidden = !dated;
      if (!dated) el.label.value = '';
      el.label.max = date();
      el.labelNote.textContent = st.stage === 'ichiban' ? '空欄なら新しい日付の分から動いたとみなします' : st.stage === 'sanban' ? '空欄なら古い日付の分から動いたとみなします' : '';
      host.classList.toggle('idou-yday', st.day === 'yday');
      renderList();
    }
    function renderList() {
      var d = date(), me = (o.me || {}).empId;
      el.listHd.textContent = (st.day === 'yday' ? '昨日' : '今日') + '（' + md(d) + '）の移動' + (st.loaded ? '' : '（読み込み中…）');
      var rows = st.moves.filter(function (m) { return m.date === d; }).map(function (m) { return { m: m, p: null }; });
      pending.forEach(function (p) {
        if (p.rec.date !== d || st.moves.some(function (m) { return m.id === p.rec.id; })) return;
        rows.push({ m: { id: p.rec.id, date: p.rec.date, from: p.rec.from, to: p.rec.to, stage: p.rec.stage, count: p.count,
                         value: p.rec.value, unit: p.rec.unit === 'container' ? 'コンテナ' : '個', labelDate: p.rec.labelDate || '',
                         empId: me, surname: (o.me || {}).name || '', at: '' }, p: p });
      });
      if (!rows.length) { el.list.innerHTML = '<div class="empty">' + (st.loaded ? 'この日の移動はまだありません。' : '読み込み中…') + '</div>'; return; }
      el.list.innerHTML = rows.map(function (x) {
        var m = x.m, p = x.p;
        var what = C.esc(nameOf(m.from)) + ' → ' + C.esc(nameOf(m.to)) + '　<b>' + C.esc(STAGE_NAME[m.stage] || m.stage) + ' ' +
          Number(m.count).toLocaleString() + '個</b>' + (m.unit === 'コンテナ' ? '（' + m.value + 'コンテナ）' : '') +
          (m.labelDate ? '　ラベル ' + md(m.labelDate) : '');
        var who = C.esc(m.surname || '') + (m.at ? ' ' + C.esc(String(m.at).slice(11, 16)) : '');
        var tail = '';
        if (p && p.state === 'sending') tail = '<span class="idou-sending">送信中</span>';
        else if (p) tail = '<span class="idou-unknown">届いたか確認できません</span>' +
          '<button type="button" class="add-cancel" data-resend="' + C.esc(m.id) + '">再送する</button>' +
          '<button type="button" class="add-cancel" data-drop="' + C.esc(m.id) + '">やめる</button>';
        else if (m.empId === me) tail = '<button type="button" class="add-cancel" data-cancel="' + C.esc(m.id) + '">取り消す</button>';
        return '<div class="idou-item">' + what + '<div class="idou-who">' + who + ' ' + tail + '</div></div>';
      }).join('');
      Array.prototype.forEach.call(el.list.querySelectorAll('[data-cancel]'), function (b) { b.onclick = function () { cancel(b.dataset.cancel); }; });
      Array.prototype.forEach.call(el.list.querySelectorAll('[data-resend]'), function (b) { b.onclick = function () { resend(b.dataset.resend); }; });
      Array.prototype.forEach.call(el.list.querySelectorAll('[data-drop]'), function (b) { b.onclick = function () { drop(b.dataset.drop); }; });
    }

    function load() {
      var my = ++st.seq, d = date();
      return C.api('zaiko.moveList', { date: d }).then(function (res) {
        if (my !== st.seq) return false;
        if (res.today && res.today !== st.today) { st.today = res.today; if (date() !== d) return load(); }
        st.container = Number(res.container) || 8;
        st.moves = res.moves || [];
        st.loaded = true;
        // 届いていた送信待ちは外す
        var before = pending.length;
        pending = pending.filter(function (p) { return !(p.rec.date === d && st.moves.some(function (m) { return m.id === p.rec.id; })); });
        if (pending.length !== before) lsPut(pending);
        render();
        return true;
      }, function (err) {
        if (my !== st.seq) return false;
        st.loaded = true;
        render();
        say('移動の一覧を読めませんでした：' + err.message, 'warn');
        return false;
      });
    }

    function collect() {
      if (!dirs.length) { say('拠点が2つ以上ありません。', 'ng'); return null; }
      if (!st.stage) { say('状態（1番／休養中／2番／3番）を選んでください。', 'ng'); return null; }
      var n = C.readNum(el.num.value);
      if (n === null) { say('数を入れてください。', 'ng'); return null; }
      if (isNaN(n) || n !== Math.floor(n) || n < 1) { say('数は1以上の整数で入れてください。', 'ng'); return null; }
      var label = el.label.value || '';
      if (label && label > date()) { say('ラベルの日付が移動の日より後になっています。', 'ng'); return null; }
      var d = dirs[st.dir];
      return { id: newId(), date: date(), from: d[0], to: d[1], stage: st.stage, unit: st.unit, value: n, labelDate: label };
    }
    function save() {
      var rec = collect();
      if (!rec) return;
      var count = rec.unit === 'container' ? rec.value * st.container : rec.value;
      if (count >= 400 && !root.confirm(STAGE_NAME[rec.stage] + ' ' + count.toLocaleString() + '個 を ' + nameOf(rec.from) + ' → ' + nameOf(rec.to) + ' に記録します。よろしいですか')) return;
      var p = { rec: rec, count: count, state: 'sending' };
      pending.push(p); lsPut(pending);
      el.num.value = ''; el.label.value = '';
      say('');
      render();
      C.toast((st.day === 'yday' ? '昨日の分の' : '') + '移動を記録しました');
      send(p);
    }
    function send(p) {
      p.state = 'sending'; lsPut(pending); renderList();
      C.api('zaiko.moveAdd', { records: [p.rec] }).then(function (res) {
        var dup = res && res.results && res.results[0] && res.results[0].dup;
        if (dup) C.toast('前回の送信が届いていました（二重には記録していません）');
        pending = pending.filter(function (x) { return x !== p; }); lsPut(pending);
        load();
      }, function (err) {
        if (!err.network) {
          // 断られた：入力欄に戻して知らせる
          pending = pending.filter(function (x) { return x !== p; }); lsPut(pending);
          giveBack(p.rec);
          say('移動を記録できませんでした：' + err.message, 'ng');
          return;
        }
        // 届いたか分からない：一覧を読み直して確かめる
        load().then(function () {
          if (pending.indexOf(p) < 0) return;   // 届いていた
          p.state = 'unknown'; lsPut(pending); renderList();
          say('移動が届いたか確認できませんでした。電波の良い所で「再送する」を押してください（二重にはなりません）。', 'warn');
        });
      });
    }
    function giveBack(rec) {
      st.dir = Math.max(0, dirs.findIndex(function (d) { return d[0] === rec.from && d[1] === rec.to; }));
      st.stage = rec.stage; st.unit = rec.unit;
      el.num.value = String(rec.value); el.label.value = rec.labelDate || '';
      render();
    }
    function resend(id) {
      var p = pending.filter(function (x) { return x.rec.id === id; })[0];
      if (p) { say(''); send(p); }
    }
    function drop(id) {
      var p = pending.filter(function (x) { return x.rec.id === id; })[0];
      if (!p || !root.confirm('この移動の送信をやめて、入力欄に戻しますか（もし届いていたら、一覧を読み直すと出てきます）')) return;
      pending = pending.filter(function (x) { return x !== p; }); lsPut(pending);
      giveBack(p.rec);
      say('入力欄に戻しました。', 'info');
    }
    function cancel(id) {
      var m = st.moves.filter(function (x) { return x.id === id; })[0];
      if (!m || !root.confirm(nameOf(m.from) + ' → ' + nameOf(m.to) + ' ' + (STAGE_NAME[m.stage] || '') + ' ' + m.count + '個 の移動を取り消しますか')) return;
      C.showLoading('取り消し中...');
      C.api('zaiko.moveCancel', { id: id }).then(function () {
        C.hideLoading(); C.toast('取り消しました'); load();
      }, function (err) { C.hideLoading(); say('取り消せませんでした：' + err.message, 'ng'); });
    }

    // ---- 操作
    var pick = function (box, fn) {
      Array.prototype.forEach.call(box.children, function (b) { b.addEventListener('click', function () { fn(b.dataset.v); render(); }); });
    };
    pick(el.day, function (v) { if (st.day !== v) { st.day = v; st.moves = []; st.loaded = false; load(); } });
    pick(el.dir, function (v) { st.dir = Number(v); });
    pick(el.stage, function (v) { st.stage = v; });
    pick(el.unit, function (v) { st.unit = v; });
    el.num.addEventListener('input', render);
    el.save.addEventListener('click', save);

    render();
    load().then(function () {
      // 前回、届いたのを見届ける前に閉じた送信：届いていなければ「再送する」を出す（自動では送らない）
      pending.forEach(function (p) { p.state = 'unknown'; });
      if (pending.length) {
        lsPut(pending); renderList();
        say('前回の移動の記録が届いたか確認できていません。一覧で「再送する」か「やめる」を押してください。', 'warn');
      }
    });
    return { reload: load };
  }

  var api = { mount: mount, STAGE_NAME: STAGE_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SgIdou = api;
})(typeof window !== 'undefined' ? window : globalThis);
