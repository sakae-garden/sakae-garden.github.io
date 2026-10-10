/* 本日の指示（バー＋パネル）。ページに依存しない共通部品。
 * 使い方（差し込み口は1か所）：
 *   <div id="shiji"></div>
 *   <script src="shiji-notice.js"></script>
 *   <script>ShijiNotice.mount(document.getElementById('shiji'), {src:'shiji-sample.json'});</script>
 * opts.src   … 指示 JSON の URL（試作①は固定ファイル。試作②で API に差し替え）
 * opts.load  … () => Promise<JSON>。あれば src より優先
 * opts.onAck … (name, data) => void。「確認しました」を押したとき（試作①は保存しない）
 * CSS は同じ場所の shiji-notice.css を自動で読み込む。
 */
(function () {
  'use strict';
  var BASE = (document.currentScript && document.currentScript.src || '').replace(/[^/]*$/, '');

  function loadCss() {
    if (document.getElementById('sjn-css')) return;
    var l = document.createElement('link');
    l.id = 'sjn-css'; l.rel = 'stylesheet'; l.href = BASE + 'shiji-notice.css';
    document.head.appendChild(l);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hm(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function md(ymd) {
    var p = String(ymd || '').split('-');
    return p.length === 3 ? (+p[1]) + '/' + (+p[2]) : '';
  }

  // 冷暖24・冷房15・暖房20 を大きく、冷=青・暖=赤で
  function colorAc(text) {
    var m = /^(冷暖|冷房|暖房)\s*(\d+(?:\.\d+)?)(.*)$/.exec(text);
    if (!m) return esc(text);
    var head = m[1] === '冷暖' ? '<span class="sjn-cool">冷</span><span class="sjn-warm">暖</span>'
      : '<span class="' + (m[1] === '冷房' ? 'sjn-cool' : 'sjn-warm') + '">' + m[1] + '</span>';
    return '<span class="sjn-big">' + head + '<span class="' + (m[1] === '暖房' ? 'sjn-warm' : m[1] === '冷房' ? 'sjn-cool' : '') + '">' + m[2] + '</span></span>' + esc(m[3]);
  }

  function newMark(data, id) {
    var c = data.changes && data.changes[id];
    return c ? '<span class="sjn-new">NEW ' + esc(c.at || '') + '</span>' : '';
  }

  function stepsHtml(steps, ac) {
    return (steps || []).map(function (st, i) {
      var v = ac ? colorAc(st.text || '') : esc(st.text || '');
      if (st.diff) v = '<mark>' + v + '</mark>';
      return (i ? '<span class="sjn-arrow">→</span>' : '') +
        '<span class="sjn-step">' + (st.when ? '<span class="sjn-when">' + esc(st.when) + '</span>' : '') +
        v + esc(st.note || '') + '</span>';
    }).join('');
  }

  function roomsHtml(data, rows, ac) {
    return '<div class="sjn-fn">' + (rows || []).map(function (r) {
      return '<div class="sjn-row"><span class="sjn-room">' + esc(r.room) + '</span><span class="sjn-steps">' +
        stepsHtml(r.steps, ac) + newMark(data, r.id) + '</span></div>';
    }).join('') + '</div>';
  }

  // 空調（エアコン・加湿器・サーキュレーター・扉・換気扇）を部屋ごと・時間の順に。同時にやることは1行にまとめる
  function kankyouHtml(data, kk) {
    return '<div class="sjn-env">' + (kk.rows || []).map(function (r) {
      return '<div class="sjn-envroom"><h3>' + esc(r.room) + newMark(data, r.id) + '</h3>' + (r.steps || []).map(function (st) {
        var chips = (st.items || []).map(function (x) {
          var v = x.kind === 'エアコン' ? colorAc(x.text || '') : esc(x.text || '');
          var c = '<span class="sjn-chip"><span class="sjn-kind">' + esc(x.kind || '') + '</span>' + v + '</span>';
          return x.diff ? '<mark class="sjn-chipm">' + c + '</mark>' : c;
        }).join('');
        return '<div class="sjn-envstep' + (st.diff ? ' sjn-d' : '') + '"><span class="sjn-envwhen">' + esc(st.when || '') + '</span><span class="sjn-chips">' + chips + '</span></div>';
      }).join('') + '</div>';
    }).join('') + '</div>';
  }

  function sec(title, inner) {
    return '<section class="sjn-sec"><h2>' + esc(title) + '</h2>' + inner + '</section>';
  }

  function hasDiff(data) {
    return /"diff":true/.test(JSON.stringify(data));
  }

  function panelHtml(data, acks) {
    var h = [];
    if (hasDiff(data)) h.push('<p class="sjn-legend"><mark>黄色</mark> は普段のやり方と違うところです。</p>');

    if (data.kankyou) h.push(sec('空調' + (data.kankyou.title ? '（' + data.kankyou.title + '）' : ''), kankyouHtml(data, data.kankyou)));

    var k = data.karitori || {};
    var kt = '<span class="sjn-big" style="font-size:19px">' + esc(k.text || '') + '</span>';
    var hon = '<div class="sjn-fn"><div class="sjn-row sjn-wide"><span class="sjn-steps"><span class="sjn-when">刈り取り</span>' +
      (k.diff ? '<mark>' + kt + '</mark>' : kt) + newMark(data, k.id) + '</span></div>' +
      (k.rows || []).map(function (r) {
        return '<div class="sjn-row"><span class="sjn-room">' + esc(r.room) + '</span><span class="sjn-steps">' + stepsHtml(r.steps) + newMark(data, r.id) + '</span></div>';
      }).join('') + '</div>';
    if ((data.nums || []).length) {
      hon += '<div class="sjn-nums">' + data.nums.map(function (n) {
        return '<div class="sjn-num' + (n.diff ? ' sjn-d' : '') + '"><span>' + esc(n.item) + newMark(data, n.id) + '</span><strong>' + esc(n.value) + '</strong></div>';
      }).join('') + '</div>';
    }
    h.push(sec('本日の内容', hon));


    if ((data.kyouyuu || []).length) {
      h.push(sec('共有事項', '<ul class="sjn-list">' + data.kyouyuu.map(function (s) {
        var t = esc(s.text);
        if (s.value) t += ' ' + (s.prev ? '<s>' + esc(s.prev) + '</s> → ' : '') + '<b>' + esc(s.value) + '</b>';
        t += s.after ? ' ' + esc(s.after) : '';
        return '<li' + (s.diff ? ' class="sjn-d"' : '') + '>' + t + newMark(data, s.id) + '</li>';
      }).join('') + '</ul>'));
    }

    if ((data.hito || []).length) {
      h.push(sec('人ごと', '<div class="sjn-people">' + data.hito.map(function (p) {
        var sub = [p.start, p.area, p.note].filter(Boolean).join(' ');
        var a = acks[p.name];
        return '<div class="sjn-person"><h3>' + esc(p.name) + 'さん' + (sub ? ' <small>' + esc(sub) + '</small>' : '') + newMark(data, p.id) + '</h3>' +
          '<ol>' + (p.tasks || []).map(function (t) {
            var x = (t.when ? esc(t.when) + '：' : '') + esc(t.text) + (t.ref ? ' <span class="sjn-ref">（' + esc(t.ref) + '）</span>' : '');
            return '<li>' + (t.diff ? '<mark>' + x + '</mark>' : x) + '</li>';
          }).join('') + '</ol>' +
          '<button type="button" class="sjn-ack" data-name="' + esc(p.name) + '" aria-pressed="' + (a ? 'true' : 'false') + '">' +
          (a ? '確認しました ✓ ' + esc(a) : '確認しました') + '</button></div>';
      }).join('') + '</div>'));
    }

    var f = data.fudan;
    if (f && (f.items || []).length) {
      h.push('<details><summary>' + esc(f.title || '普段のやり方') + '</summary><ul>' +
        f.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>');
    }
    h.push('<button type="button" class="sjn-close">閉じる</button>');
    return h.join('');
  }

  function mount(el, opts) {
    opts = opts || {};
    loadCss();
    el.classList.add('sjn');
    el.innerHTML = '<div class="sjn-msg">本日の指示を読み込み中…</div>';

    var ov = document.createElement('div');
    ov.className = 'sjn sjn-ov'; ov.hidden = true;
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', '本日の指示');
    document.body.appendChild(ov);

    var data = null, acks = {};

    function seenKey() { return 'shiji_seen_' + data.date + '_' + data.kyoten; }
    function unseen() {
      var seen = 0; try { seen = +(localStorage.getItem(seenKey()) || 0); } catch (e) {}
      return Object.keys(data.changes || {}).filter(function (id) { return (data.changes[id].ver || 0) > seen; }).length;
    }

    function barHtml(open) {
      var n = open ? 0 : unseen();
      var upd = data.updatedAt && data.updatedAt !== data.publishedAt ? ' ・ ' + hm(data.updatedAt) + ' 更新' : '';
      return '<button type="button" class="sjn-bar" aria-expanded="' + open + '">' +
        '<span><b>本日の指示（' + esc(data.kyoten) + '）</b><small>' + md(data.date) + ' ' + hm(data.publishedAt) + ' 公開' + upd + '</small></span>' +
        '<span class="sjn-badge"' + (n ? '' : ' hidden') + '>NEW ' + n + '件</span>' +
        '<span class="sjn-chev" aria-hidden="true">' + (open ? '▲' : '▼') + '</span></button>';
    }

    function renderBar() {
      el.innerHTML = barHtml(false);
      el.querySelector('.sjn-bar').addEventListener('click', open);
    }

    function open() {
      ov.innerHTML = '<div class="sjn-head">' + barHtml(true) + '</div><div class="sjn-body">' + panelHtml(data, acks) + '</div>';
      ov.hidden = false;
      ov.scrollTop = 0;
      document.documentElement.classList.add('sjn-lock');
      try { localStorage.setItem(seenKey(), String(data.ver || 0)); } catch (e) {}
    }
    function close() {
      ov.hidden = true;
      document.documentElement.classList.remove('sjn-lock');
      renderBar();
    }

    ov.addEventListener('click', function (e) {
      if (e.target.closest('.sjn-bar') || e.target.closest('.sjn-close')) { close(); return; }
      var b = e.target.closest('.sjn-ack');
      if (!b) return;
      var name = b.getAttribute('data-name');
      if (acks[name]) return; // 二重記録しない（取り消しは試作②で決める）
      var d = new Date();
      acks[name] = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
      b.setAttribute('aria-pressed', 'true');
      b.textContent = '確認しました ✓ ' + acks[name];
      if (opts.onAck) opts.onAck(name, data);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !ov.hidden) close(); });

    function setData(d) {
      data = d; acks = {};
      (d.acks || []).forEach(function (a) { acks[a.name] = a.at; });
      renderBar();
    }

    var p = opts.load ? opts.load() : opts.data ? Promise.resolve(opts.data)
      : fetch(opts.src || BASE + 'shiji-sample.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
      });
    p.then(setData).catch(function () {
      el.innerHTML = '<div class="sjn-msg">本日の指示を読み込めませんでした</div>';
    });

    return { open: open, close: close, setData: setData };
  }

  window.ShijiNotice = { mount: mount };
})();
