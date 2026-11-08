/* ═══════════ 🧪 საცდელი რეჟიმი (მოწყობილობის გარეშე) ═══════════
   App Store / Google Play-ის შემმოწმებლისთვის და მომხმარებლისთვის, რომელსაც სკანერი ან კამერა ჯერ არ აქვს.
   OBD: ნამდვილი სკანერის ნაცვლად საცდელი ELM327 (იგივე ინტერფეისი, რაც chrome.sockets.tcp-ს აქვს).
   ვიდეორეგისტრატორი: dashcam.js-ის არსებული საცდელი რეჟიმი (octane_dc_demo).
   ჩართვა/გამორთვა: OCTANE_DEMO.enter() / exit() - აპი თავიდან იტვირთება. */
(function () {
  var on = false;
  try { on = localStorage.getItem('octane_demo') === '1'; } catch (e) {}
  let cleared = false, t0 = Date.now();
  const hx = (n, len) => n.toString(16).toUpperCase().padStart(len || 2, '0');
  const sp = (s) => s.match(/.{2}/g).join(' ');
  function answer(raw) {
    const c = raw.replace(/\s+/g, '').toUpperCase();
    const t = (Date.now() - t0) / 1000;
    const rpm = 780 + Math.round(Math.abs(Math.sin(t / 3)) * 2200);
    if (c === 'ATZ') return { d: 900, r: 'ELM327 v1.5' };
    if (c === 'ATRV') return { d: 200, r: (13.9 + Math.random() * 0.4).toFixed(1) + 'V' };
    if (c === 'ATDPN') return { d: 100, r: 'A6' };
    if (c.startsWith('AT')) return { d: 60, r: 'OK' };
    if (c === '0100') return { d: 1600, r: 'SEARCHING...\r41 00 BE 3F B8 13' };
    // შეძენამდე შემოწმების სცენარი: კოდები 12 კმ / 35 წთ / 1 გათბობის წინ წაშალეს, მუდმივი P0420
    if (c === '0120') return { d: 120, r: '41 20 80 1B 80 01' };
    if (c === '0140') return { d: 120, r: '41 40 6C DC 00 10' };
    if (c === '0101') return { d: 120, r: '41 01 03 07 65 61' };
    if (c === '0121') return { d: 90, r: '41 21 00 00' };
    if (c === '014D') return { d: 90, r: '41 4D 00 00' };
    if (c === '0131') return { d: 90, r: '41 31 00 0C' };
    if (c === '014E') return { d: 90, r: '41 4E 00 23' };
    if (c === '0130') return { d: 90, r: '41 30 01' };
    if (c === '0A') return { d: 500, r: '4A 01 04 20' };
    // შენახული ხარვეზები: P0300, P0420 და მწარმოებლის P1259 (CAN, მრავალნაწილიანი პასუხი)
    if (c === '03') return { d: 700, r: cleared ? '43 00' : '008\r0: 43 03 03 00 04 20\r1: 12 59 00 00 00 00 00' };
    // მოლოდინის რეჟიმის: P0171 და მწარმოებლის C1201
    if (c === '07') return { d: 600, r: cleared ? '47 00' : '47 02 01 71 52 01' };
    if (c === '04') { cleared = true; return { d: 1200, r: '44' }; }
    if (c === '010C') { const v = rpm * 4; return { d: 120, r: '41 0C ' + sp(hx(v, 4)) }; }
    if (c === '010D') return { d: 90, r: '41 0D ' + hx(Math.round(Math.abs(Math.sin(t / 8)) * 85)) };
    // 🔋 Prius (3-ე თაობა) ბატარეა: 7E2 → 2181, 14 ბლოკი (V = სიტყვა × 79.99 / 65535), №9 სუსტი
    if (c === '2181') {
      const v = [15.62, 15.60, 15.64, 15.61, 15.63, 15.59, 15.62, 15.60, 15.12, 15.61, 15.63, 15.62, 15.60, 15.64];
      const b = ['61', '81'].concat(...v.map(x => { const w = Math.round(x * 65535 / 79.99); return [hx(w >> 8), hx(w & 255)]; }));
      const lines = ['01E', '0: ' + b.slice(0, 6).join(' ')];
      for (let i = 6, n = 1; i < b.length; i += 7, n++) lines.push((n % 16).toString(16).toUpperCase() + ': ' + b.slice(i, i + 7).join(' '));
      return { d: 400, r: lines.join('\r') };
    }
    if (c === '0105') return { d: 90, r: '41 05 ' + hx(40 + 89 + Math.round(Math.sin(t) * 2)) };
    if (c === '0111') return { d: 90, r: '41 11 ' + hx(30 + Math.round(Math.abs(Math.sin(t / 3)) * 90)) };
    if (c === '0104') return { d: 90, r: '41 04 ' + hx(50 + Math.round(Math.abs(Math.sin(t / 3)) * 80)) };
    if (c === '010F') return { d: 90, r: '41 0F ' + hx(40 + 31) };
    if (c === '011F') { const s = 420 + Math.round(t); return { d: 90, r: '41 1F ' + sp(hx(s, 4)) }; }
    if (c === '012F') return { d: 90, r: '41 2F ' + hx(160) };
    if (c === '0110') { const m = 380 + Math.round(Math.abs(Math.sin(t / 3)) * 900); return { d: 90, r: '41 10 ' + sp(hx(m, 4)) }; }
    if (c === '020C00') return { d: 300, r: cleared ? 'NO DATA' : '42 0C 00 0B B8' };
    if (c === '020D00') return { d: 300, r: cleared ? 'NO DATA' : '42 0D 00 3C' };
    if (c === '020500') return { d: 300, r: cleared ? 'NO DATA' : '42 05 00 7B' };
    return { d: 300, r: 'NO DATA' };
  }


  var listeners = [];
  var tcp = {
    create: function (o, cb) { setTimeout(function () { cb({ socketId: 7 }); }, 50); },
    connect: function (id, host, port, cb) { setTimeout(function () { cb(0); }, 400); },
    send: function (id, buf, cb) {
      var cmd = new TextDecoder().decode(buf).replace(/\r/g, '');
      var r = answer(cmd);
      setTimeout(function () {
        var data = new TextEncoder().encode(r.r + '\r\r>').buffer;
        listeners.slice().forEach(function (f) { f({ socketId: id, data: data }); });
      }, Math.min(r.d, 400));
      if (cb) cb({ bytesSent: buf.byteLength });
    },
    close: function () {},
    onReceive: {
      addListener: function (f) { listeners.push(f); },
      removeListener: function (f) { var i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }
    }
  };

  window.OCTANE_DEMO = {
    on: function () { return on; },
    tcp: tcp,
    enter: function () {
      try {
        localStorage.setItem('octane_demo', '1'); localStorage.setItem('octane_dc_demo', '1');
        var car = JSON.parse(localStorage.getItem('octane_car') || '{}');
        if (!car.brand) localStorage.setItem('octane_car', JSON.stringify({ brand: 'Toyota', model: 'Prius', year: '2012', body: 'hatchback', info: { fuel: 'ჰიბრიდი', mileage: '185000', oilAt: '180000', oilEvery: '10000' } }));
      } catch (e) {}
      location.reload();
    },
    exit: function () {
      try { localStorage.removeItem('octane_demo'); localStorage.removeItem('octane_dc_demo'); } catch (e) {}
      location.reload();
    }
  };
  if (on) document.documentElement.classList.add('demo-on');
})();
