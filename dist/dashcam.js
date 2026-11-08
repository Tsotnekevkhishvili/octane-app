/* ═══════════════════════════════════════════════════════════════════════
   📹 Octane App - ქართული დეშ ქემი (ვიდეორეგისტრატორი)
   ───────────────────────────────────────────────────────────────────────
   ეს ფაილი სრულიად დამოუკიდებელია OBD ნაწილისგან:
     1. OCTANE_DASHCAM_KEY  - დეშ ქემის აქტივაციის კოდი (მხოლოდ 2000)
     2. DC_ADAPTERS         - კამერის მოდელის ადაპტერი (მისამართი + ბრძანებები ერთ ადგილას)
     3. DcNet               - HTTP კავშირი კამერასთან (ნატიური DashcamWifi პლაგინით)
     4. Alpine.store('octaneMode') - რეჟიმის არჩევა (OBD / ვიდეორეგისტრატორი)
     5. dashcamApp()        - დეშ ქემის განყოფილების Alpine კომპონენტი
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function lsGet(k, def) { try { var v = localStorage.getItem(k); return v === null ? def : v; } catch (e) { return def; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function lsJson(k, def) { try { return JSON.parse(localStorage.getItem(k) || '') || def; } catch (e) { return def; } }

    // ═══════════ 1. 🔐 აქტივაციის კოდი ═══════════
    // keys.js-ს (OBD) არ ეხება: 9898 აქ არ მუშაობს, 2000 კი - OBD-ზე.
    window.OCTANE_DASHCAM_KEY = {
        CODE: '2000',
        STORAGE: 'octane_activated_dashcam',
        verify: function (input) {
            input = String(input || '').trim();
            if (input === this.CODE) {
                lsSet(this.STORAGE, 'true');
                return { success: true, message: 'წარმატებით გააქტიურდა!' };
            }
            return { success: false, message: 'არასწორი კოდი! შეამოწმეთ ვიდეორეგისტრატორის ინსტრუქციაზე მოცემული კოდი.' };
        },
        // 🍎 iPhone-ზე კოდი არ სჭირდება (Apple-ის წესი: ფუნქცია საკუთარი კოდით არ უნდა იხსნებოდეს)
        isActivated: function () { return isIOS() || lsGet(this.STORAGE, '') === 'true'; }
    };
    function isIOS() {
        try { return !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios'); } catch (e) { return false; }
    }

    // ═══════════ 2. 🔌 კამერის ადაპტერები ═══════════
    // ყველა მისამართი და ბრძანება აქ არის. სხვა მოდელის დასამატებლად:
    // დააკოპირე NOVATEK ობიექტი, შეცვალე id/name/CMD/ბმულები და დაამატე DC_ADAPTERS-ში.
    // ctx = { ip, http } - http(url) აბრუნებს პასუხის ტექსტს (ან აგდებს შეცდომას).
    var NOVATEK = {
        id: 'novatek',
        name: 'Novatek (ყველაზე გავრცელებული)',
        defaultIp: '192.168.1.254',
        liveDelayMs: 600,

        CMD: {
            CAPTURE: 1001,     // ფოტოს გადაღება
            RECORD: 2001,      // ჩაწერა: par=1 ჩართვა, par=0 გამორთვა
            LIVE: 2015,        // ცოცხალი ხედი: par=1 ჩართვა, par=0 გამორთვა
            MODE: 3001,        // რეჟიმი: par=0 ფოტო, par=1 ვიდეო, par=2 ჩანაწერების ნახვა
            FIRMWARE: 3012,
            STATUS: 3014,
            FILE_LIST: 3015,
            HEARTBEAT: 3016,
            FREE_SPACE: 3017,
            THUMB: 4001,       // პატარა სურათი: <ფაილის ბმული>?custom=1&cmd=4001
            DELETE: 4003       // ერთი ფაილის წაშლა: &str=A:\CARDV\MOVIE\...
        },
        MODE: { PHOTO: 0, MOVIE: 1, PLAYBACK: 2 },

        base: function (ip) { return 'http://' + ip; },
        cmdUrl: function (ip, cmd, par, str) {
            var u = this.base(ip) + '/?custom=1&cmd=' + cmd;
            if (par !== undefined && par !== null) u += '&par=' + par;
            if (str !== undefined && str !== null) u += '&str=' + String(str).replace(/ /g, '%20');
            return u;
        },
        liveUrl: function (ip) { return 'http://' + ip + ':8192'; },
        // A:\CARDV\MOVIE\2024_0101_120000_001.MP4 → http://IP/CARDV/MOVIE/2024_0101_120000_001.MP4
        fileUrl: function (ip, f) {
            var p = String(f.path || '').replace(/^[A-Za-z]:/, '').replace(/\\/g, '/');
            if (p.charAt(0) !== '/') p = '/' + p;
            return this.base(ip) + p.split('/').map(encodeURIComponent).join('/');
        },
        thumbUrl: function (ip, f) { return this.fileUrl(ip, f) + '?custom=1&cmd=' + this.CMD.THUMB; },

        parse: function (text) {
            try { return new DOMParser().parseFromString(String(text || ''), 'text/xml'); } catch (e) { return null; }
        },
        tag: function (node, name) {
            var el = node && node.getElementsByTagName(name)[0];
            return el ? (el.textContent || '').trim() : '';
        },
        async send(ctx, cmd, par, str) {
            var text = await ctx.http(this.cmdUrl(ctx.ip, cmd, par, str));
            var doc = this.parse(text);
            var status = parseInt(this.tag(doc, 'Status'), 10);
            return { ok: !isNaN(status) ? status >= 0 : !!text, status: status, doc: doc, text: text };
        },

        async ping(ctx) {
            try { var r = await this.send(ctx, this.CMD.HEARTBEAT); if (r.ok) return true; } catch (e) {}
            try { var r2 = await this.send(ctx, this.CMD.FIRMWARE); return r2.ok; } catch (e) { return false; }
        },
        // ფაილების სანახავად კამერა ჩანაწერების რეჟიმში უნდა გადავიდეს (ჩაწერა დროებით ჩერდება)
        async enterPlayback(ctx) { try { await this.send(ctx, this.CMD.MODE, this.MODE.PLAYBACK); } catch (e) {} },
        // ცოცხალი ხედისთვის და აპიდან გასვლისას - ისევ ვიდეო-რეჟიმი და ჩაწერა
        async enterMovie(ctx) {
            try { await this.send(ctx, this.CMD.MODE, this.MODE.MOVIE); } catch (e) {}
            try { await this.send(ctx, this.CMD.LIVE, 1); } catch (e) {}
        },
        async resumeRecording(ctx) {
            try { await this.send(ctx, this.CMD.MODE, this.MODE.MOVIE); } catch (e) {}
            try { await this.send(ctx, this.CMD.RECORD, 1); } catch (e) {}
        },
        async setRecording(ctx, on) { var r = await this.send(ctx, this.CMD.RECORD, on ? 1 : 0); return r.ok; },
        async capture(ctx) {
            try { await this.send(ctx, this.CMD.MODE, this.MODE.PHOTO); } catch (e) {}
            var r = await this.send(ctx, this.CMD.CAPTURE);
            try { await this.send(ctx, this.CMD.MODE, this.MODE.MOVIE); } catch (e) {}
            return r.ok;
        },

        async listFiles(ctx) {
            var r = await this.send(ctx, this.CMD.FILE_LIST);
            var nodes = r.doc ? r.doc.getElementsByTagName('File') : [];
            var out = [];
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                var name = this.tag(n, 'NAME');
                var path = this.tag(n, 'FPATH') || name;
                if (!name) continue;
                var attr = parseInt(this.tag(n, 'ATTR'), 10) || 0;
                var isPhoto = /\.(jpe?g|png)$/i.test(name);
                // ავარიული (დაბლოკილი): RO/EMR/EVENT/LOCK საქაღალდე, ან ფაილს მხოლოდ წაკითხვის ნიშანი აქვს (ATTR=33)
                var locked = !isPhoto && (/\\(RO|EMR|EVENT|LOCK|PARK_EMR)\\/i.test(path) || (attr & 1) === 1);
                out.push({
                    id: path,
                    name: name,
                    path: path,
                    size: parseInt(this.tag(n, 'SIZE'), 10) || 0,
                    time: this.parseTime(this.tag(n, 'TIME'), name),
                    kind: isPhoto ? 'photo' : 'video',
                    folder: isPhoto ? 'photo' : (locked ? 'locked' : 'normal'),
                    mime: isPhoto ? 'image/jpeg' : (/\.mov$/i.test(name) ? 'video/quicktime' : (/\.ts$/i.test(name) ? 'video/mp2t' : 'video/mp4'))
                });
            }
            return out;
        },
        // 2024/01/31 18:05:09 ან ფაილის სახელიდან 2024_0131_180509_001.MP4
        parseTime: function (t, name) {
            var m = String(t || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})\D+(\d{1,2})\D(\d{1,2})\D(\d{1,2})/);
            if (!m) m = String(name || '').match(/(\d{4})_?(\d{2})(\d{2})_?(\d{2})(\d{2})(\d{2})/);
            if (!m) return 0;
            return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
        },
        async deleteFile(ctx, f) { var r = await this.send(ctx, this.CMD.DELETE, null, f.path); return r.ok; },
        async getInfo(ctx) {
            var info = { firmware: '', freeBytes: 0 };
            try { var a = await this.send(ctx, this.CMD.FIRMWARE); info.firmware = this.tag(a.doc, 'String'); } catch (e) {}
            try { var b = await this.send(ctx, this.CMD.FREE_SPACE); info.freeBytes = parseInt(this.tag(b.doc, 'Value'), 10) || 0; } catch (e) {}
            return info;
        }
    };

    // ═══════════ HiDvr_ (მოდელი LF9, ორიგინალი აპი GoLook) - HiSilicon hisnet პროტოკოლი ═══════════
    // წყარო: GoLook 1.5.8 (com.damoa.dv), კლასი com.hisilicon.cameralib.device.hidvr.HiDvrProtocol.
    // ⚠️ რეალურ კამერაზე ჯერ არ არის შემოწმებული.
    //   • ბრძანება:  http://192.168.0.1/cgi-bin/hisnet/<name>.cgi?&-key=value
    //   • პასუხი:     var key="value";  (რამდენიმე სტრიქონი)
    //   • წარმატება:  პასუხში წერია Success; შეცდომა: SvrFuncResult="N"
    //   • ფაილები:   getdirfilelist → sd/norm/xxx.MP4;sd/norm/yyy.MP4;
    //   • სურათი:    იგივე ბმული, ოღონდ .THM გაფართოებით
    //   • ცოცხალი:   rtsp://192.168.0.1:554/livestream/1 (TCP) - ნატიური ფლეიერით
    var HIDVR = {
        id: 'hidvr',
        name: 'HiDvr (LF9 / GoLook)',
        ssidPrefix: 'HiDvr_',           // WiFi-ს სახელი იწყება ასე, მაგ. HiDvr_15C628
        defaultPassword: '12345678',    // reset ღილაკი 6 წამი → ისევ 12345678
        ips: ['192.168.0.1', '192.168.1.254', '192.168.169.1', '192.168.1.1'],
        defaultIp: '192.168.0.1',
        configured: true,
        liveKind: 'rtsp',
        liveDelayMs: 0,
        CGI: '/cgi-bin/hisnet',
        WORKMODE: 'NORM_REC',
        PAGE: 50,                       // GoLook-იც 50-50 ტვირთავს
        MAX_FILES: 3000,
        dirs: null,                     // getdircapability-დან: { normal, locked, photo }

        // getcamparam-ით (კამერის) იკითხება ეს გასაღებები, დანარჩენი - getcommparam-ით (საერთო)
        CAM_KEYS: ['MEDIAMODE', 'ENC_PAYLOAD_TYPE', 'Rec_Split_Time', 'FLIP', 'MIRROR', 'BACK_MIRROR', 'ANTIFLICKER', 'MD_SENSITIVITY', 'OSD', 'WATERMARKID', 'ENABLEWATERMARK'],
        // პარამეტრები GoLook-ის რიგით. fuse: მხოლოდ მცველების ყუთიდან კვებისას მუშაობს
        // group: rec - ჩაწერა, safe - უსაფრთხოება, park - პარკინგი (მცველების ყუთიდან), cam - კამერა
        SETTINGS: [
            { key: 'MEDIAMODE', title: 'ვიდეოს ხარისხი', group: 'rec' },
            { key: 'ENC_PAYLOAD_TYPE', title: 'ვიდეოს ფორმატი', group: 'rec', note: 'H265-ზე ზოგი ტელეფონი ვიდეოს ვერ ჩართავს. გირჩევთ H264-ს.' },
            { key: 'Rec_Split_Time', title: 'ვიდეოს ხანგრძლივობა', group: 'rec' },
            { key: 'AUDIO', title: 'ხმის ჩაწერა', def: '0,1', group: 'rec' },
            { key: 'GSR_SENSITIVITY', title: 'დარტყმის სენსორი', group: 'safe', note: 'დარტყმისას ვიდეო ავტომატურად ავარიულად შეინახება.' },
            { key: 'MD_SENSITIVITY', title: 'მოძრაობის სენსორი', group: 'safe' },
            { key: 'GSR_PARKING', title: 'პარკინგის რეჟიმი', fuse: true, group: 'park', note: 'მანქანის დაყენებისას დარტყმა კამერას ჩართავს.' },
            { key: 'LOW_FPS_REC', title: 'Time-lapse', fuse: true, group: 'park' },
            { key: 'LOW_FPS_REC_TIME', title: 'Time-lapse-ის დრო', def: '0,1,2,3', fuse: true, group: 'park' },
            { key: 'LOW_POWER_PROTECT', title: 'აკუმულატორის დაცვა', def: '0,1,2', fuse: true, group: 'park', note: 'ამ ძაბვაზე კამერა გაითიშება, რომ აკუმულატორი არ დაჯდეს.' },
            { key: 'VOLUME', title: 'დინამიკის ხმა', group: 'cam' },
            { key: 'ANTIFLICKER', title: 'სინათლის სიხშირე', group: 'cam' },
            { key: 'FLIP', title: 'ამობრუნება', group: 'cam' },
            { key: 'MIRROR', title: 'სარკისებრი ხედი', group: 'cam' },
            { key: 'SCREEN_DORMANT', title: 'ეკრანის ჩაქრობა', group: 'cam' }
        ],
        log: [],                        // ბოლო პასუხები (დიაგნოსტიკისთვის)
        rememberLog: function (path, text) {
            this.log.push({ path: path, text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300) });
            if (this.log.length > 12) this.log.shift();
        },

        cgi: function (ip, path) { return 'http://' + ip + this.CGI + '/' + path; },
        // var key="value";  →  { key: value }
        parse: function (text) {
            var map = {}, re = /var\s+([\w.\-]+)\s*=\s*"([^"]*)"\s*;/g, m;
            while ((m = re.exec(String(text || '')))) map[m[1]] = m[2].trim();
            return map;
        },
        ok: function (text) { return /Success/i.test(String(text || '')); },
        async q(ctx, path, timeoutMs) { return await DcNet.get(this.cgi(ctx.ip, path), timeoutMs); },
        async qmap(ctx, path, timeoutMs) { return this.parse(await this.q(ctx, path, timeoutMs)); },
        async qok(ctx, path, timeoutMs) { try { return this.ok(await this.q(ctx, path, timeoutMs)); } catch (e) { return false; } },

        // კამერა ამ მისამართზე პასუხობს hisnet ბრძანებას?
        async findIp(ctx) {
            var list = ctx.ip ? [ctx.ip].concat(this.ips.filter(function (x) { return x !== ctx.ip; })) : this.ips;
            for (var i = 0; i < list.length; i++) {
                var r = await DcNet.probe(this.cgi(list[i], 'getdeviceattr.cgi?'), 3000);
                if (r && r.status === 200 && /var\s+\w+\s*=/.test(r.data)) return list[i];
            }
            return '';
        },
        async ping(ctx) { return await this.findIp(ctx); },

        // ─── სესია: რეგისტრაცია, საათი, საქაღალდეები ───
        async onConnect(ctx) {
            if (ctx.phoneIp) await this.qok(ctx, 'client.cgi?&-operation=register&-ip=' + ctx.phoneIp);
            await this.syncTime(ctx);
            this.dirs = null;
            try {
                var capText = await this.q(ctx, 'getdircapability.cgi?');
                this.rememberLog('getdircapability', capText);
                var cap = this.parse(capText).capability || '';
                this.dirs = this.pickDirs(cap.split(',').map(function (s) { return s.trim(); }).filter(Boolean));
            } catch (e) {}
            if (!this.dirs) this.dirs = { normal: 'norm', locked: 'emr', photo: 'photo' };
        },
        async heartbeat(ctx) { if (ctx.phoneIp) return await this.qok(ctx, 'checkconnect.cgi?&-ip=' + ctx.phoneIp, 4000); return true; },
        async onDisconnect(ctx) { if (ctx.phoneIp) await this.qok(ctx, 'client.cgi?&-operation=unregister&-ip=' + ctx.phoneIp, 3000); },
        async syncTime(ctx) {
            var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
            var t = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
            return await this.qok(ctx, 'setsystime.cgi?&-time=' + t);
        },
        // GoLook-ის HIDevUtil-ის ლოგიკა: წინა კამერის norm / emr|lock|event / photo
        pickDirs: function (list) {
            var lower = list.map(function (s) { return s.toLowerCase(); });
            var notOther = function (s) { return !/(back|rear|after|int_|inside)/.test(s); };
            var find = function (re) {
                for (var i = 0; i < lower.length; i++) if (re.test(lower[i]) && notOther(lower[i])) return list[i];
                for (var j = 0; j < lower.length; j++) if (re.test(lower[j])) return list[j];
                return '';
            };
            var d = { normal: find(/norm/), locked: find(/emr|lock|event/), photo: find(/photo/) };
            return d.normal || d.locked || d.photo ? d : null;
        },

        // GoLook-ში Replay-ზე შესვლისას ჯერ ჩაწერა ჩერდება - სანამ კამერა წერს, სია ცარიელი მოდის
        async enterPlayback(ctx) {
            await this.qok(ctx, 'workmodecmd.cgi?&-cmd=stop');
            await new Promise(function (r) { setTimeout(r, 800); });
        },
        // ცოცხალ ხედზე დაბრუნებისას - ჩაწერა ისევ ირთვება
        async enterMovie(ctx) {
            await this.qok(ctx, 'setworkmode.cgi?&-workmode=EXIT_PLAYBACK');
            await this.qok(ctx, 'workmodecmd.cgi?&-cmd=start');
        },
        // აპიდან გასვლისას: დათვალიერების რეჟიმიდან გამოსვლა და ჩაწერის გაგრძელება (როგორც GoLook-ში)
        async resumeRecording(ctx) {
            await this.qok(ctx, 'setworkmode.cgi?&-workmode=EXIT_PLAYBACK');
            await this.qok(ctx, 'workmodecmd.cgi?&-cmd=start');
        },
        async setRecording(ctx, on) {
            var t = await this.q(ctx, 'workmodecmd.cgi?&-cmd=' + (on ? 'start' : 'stop'));
            return !/SvrFuncResult="-?[1-9]/.test(t);
        },
        async capture(ctx) { return await this.qok(ctx, 'workmodecmd.cgi?&-cmd=trigger'); },
        async emergency(ctx) { return await this.qok(ctx, 'workmodecmd.cgi?&-cmd=emrbegin'); },

        // ─── ფაილები ───
        // გვერდ-გვერდ (50-50), როგორც GoLook. ფაილების რაოდენობაზე აღარ ვართ დამოკიდებული:
        // ვკითხულობთ, სანამ გვერდი არ დაცარიელდება ან 50-ზე ნაკლები არ მოვა.
        async listDir(ctx, dir, folder) {
            var count = 0;
            try {
                var ct = await this.q(ctx, 'getdirfilecount.cgi?&-dir=' + dir);
                this.rememberLog('getdirfilecount ' + dir, ct);
                count = parseInt(this.parse(ct).count, 10) || 0;
            } catch (e) { this.rememberLog('getdirfilecount ' + dir, 'შეცდომა: ' + (e && e.message)); }
            var out = [], seen = {};
            for (var s = 0; s < this.MAX_FILES; s += this.PAGE) {
                var e2 = s + this.PAGE - 1;
                var text = await this.q(ctx, 'getdirfilelist.cgi?&-dir=' + dir + '&-start=' + s + '&-end=' + e2, 10000);
                if (s === 0) this.rememberLog('getdirfilelist ' + dir, text);
                var items = String(text || '').split(/[;\n\r]+/), added = 0;
                for (var i = 0; i < items.length; i++) {
                    var f = this.toFile(items[i], folder);
                    if (f && !seen[f.id]) { seen[f.id] = 1; out.push(f); added++; }
                }
                if (!added || added < this.PAGE || (count && out.length >= count)) break;
            }
            return out;
        },
        async listFiles(ctx) {
            if (!this.dirs) await this.onConnect(ctx);
            var d = this.dirs, all = [];
            var plan = [['normal', d.normal, ['norm', 'normal', 'NORMAL']], ['locked', d.locked, ['emr', 'event', 'lock']], ['photo', d.photo, ['photo']]];
            for (var i = 0; i < plan.length; i++) {
                // ჯერ კამერის მიერ დასახელებული საქაღალდე, ცარიელის შემთხვევაში - სხვა გავრცელებული სახელები
                var names = [plan[i][1]].concat(plan[i][2]).filter(function (x, k, a) { return x && a.indexOf(x) === k; });
                for (var n = 0; n < names.length; n++) {
                    var got = [];
                    try { got = await this.listDir(ctx, names[n], plan[i][0]); } catch (e) { this.rememberLog('getdirfilelist ' + names[n], 'შეცდომა: ' + (e && e.message)); }
                    if (got.length) { all = all.concat(got); break; }
                }
            }
            return all;
        },
        // sd/norm/2026_10_27_154400_00.MP4 → ფაილის ობიექტი
        toFile: function (raw, folder) {
            var p = String(raw || '').replace(/^\s*var\s+\w+\s*=\s*"?/, '').replace(/"?\s*$/, '').trim();
            if (!p || !/\.\w{2,4}$/.test(p)) return null;
            p = p.replace(/^https?:\/\/[^/]+\//i, '').replace(/^\/+/, '');
            var k = p.indexOf('sd/');
            if (k > 0) p = p.slice(k);
            var name = p.split('/').pop();
            var isPhoto = /\.(jpe?g|png)$/i.test(name);
            return {
                id: p, name: name, path: p, size: 0,
                time: this.parseTime(name),
                kind: isPhoto ? 'photo' : 'video',
                folder: folder === 'photo' || isPhoto ? 'photo' : folder,
                mime: isPhoto ? 'image/jpeg' : (/\.mov$/i.test(name) ? 'video/quicktime' : (/\.ts$/i.test(name) ? 'video/mp2t' : 'video/mp4'))
            };
        },
        // სახელიდან დრო: 2026_10_27_154400 / 20261027_154400 / 2026_1027_154400
        parseTime: function (name) {
            var s = String(name || ''), m;
            m = s.match(/(\d{4})[_-]?(\d{2})[_-]?(\d{2})[_-]?(\d{2})[_:-]?(\d{2})[_:-]?(\d{2})/);
            if (!m) return 0;
            return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
        },
        fileUrl: function (ip, f) { return 'http://' + ip + '/' + f.path.split('/').map(encodeURIComponent).join('/'); },
        thumbUrl: function (ip, f) { return f.kind === 'photo' ? this.fileUrl(ip, f) : this.fileUrl(ip, f).replace(/\.\w+$/, '.THM'); },
        liveUrl: function (ip) { return 'rtsp://' + ip + ':554/livestream/1'; },
        async deleteFile(ctx, f) { return await this.qok(ctx, 'deletefile.cgi?&-name=' + f.path); },
        // ხანგრძლივობა (წამი), ზომა და დრო ცალკე ფაილისთვის
        async fileInfo(ctx, f) {
            var m = await this.qmap(ctx, 'getfileinfo.cgi?&-name=' + f.path);
            return { duration: parseInt(m.time, 10) || 0, size: parseInt(m.size, 10) || 0 };
        },

        // ─── ბარათი და მოწყობილობა ───
        async getSd(ctx) {
            var m = await this.qmap(ctx, 'getsdstatus.cgi?');
            var mb = function (v) { return (parseFloat(String(v || '').replace(/[^\d.]/g, '')) || 0) * 1048576; };
            return { state: m.sdstatus || '', total: mb(m.sdtotalspace), free: mb(m.sdfreespace) };
        },
        async getInfo(ctx) {
            var info = { firmware: '', freeBytes: 0, model: '', res: '', codec: '' };
            try { var a = await this.qmap(ctx, 'getdeviceattr.cgi?'); info.firmware = a.softversion || ''; info.model = a.model || a.product || ''; } catch (e) {}
            try { info.res = (await this.qmap(ctx, this.paramPath('MEDIAMODE'))).value || ''; } catch (e) {}
            try { info.codec = (await this.qmap(ctx, this.paramPath('ENC_PAYLOAD_TYPE'))).value || ''; } catch (e) {}
            try { var sd = await this.getSd(ctx); info.freeBytes = sd.free; } catch (e) {}
            return info;
        },
        // ფორმატირება: ჯერ ჩაწერის გაჩერება, მერე ფორმატი, მერე ისევ ჩაწერა (GoLook-ის მსგავსად)
        async formatSd(ctx) {
            await this.qok(ctx, 'workmodecmd.cgi?&-cmd=stop');
            await new Promise(function (r) { setTimeout(r, 1500); });
            var t = '';
            try { t = await this.q(ctx, 'sdcommand.cgi?&-format', 90000); } catch (e) {}
            await this.qok(ctx, 'workmodecmd.cgi?&-cmd=start');
            return this.ok(t) || /sdstatus|var\s/.test(t);
        },

        // ─── პარამეტრები ───
        isCam: function (key) { return this.CAM_KEYS.indexOf(key) >= 0; },
        paramPath: function (key, set, value) {
            if (this.isCam(key)) {
                return set ? 'setcamparam.cgi?&-workmode=' + this.WORKMODE + '&-type=' + key + '&-value=' + encodeURIComponent(value)
                           : 'getcamparam.cgi?&-workmode=' + this.WORKMODE + '&-type=' + key;
            }
            return set ? 'setcommparam.cgi?&-type=' + key + '&-value=' + encodeURIComponent(value) : 'getcommparam.cgi?&-type=' + key;
        },
        capPath: function (key) {
            return this.isCam(key) ? 'getcamparamcapability.cgi?&-workmode=' + this.WORKMODE + '&-type=' + key
                                   : 'getcommparamcapability.cgi?&-type=' + key;
        },
        async listSettings(ctx) {
            var out = [];
            for (var i = 0; i < this.SETTINGS.length; i++) {
                var s = this.SETTINGS[i], cap = '', val = '';
                try { cap = (await this.qmap(ctx, this.capPath(s.key))).capability || ''; } catch (e) {}
                try { val = (await this.qmap(ctx, this.paramPath(s.key))).value || ''; } catch (e) {}
                if (!cap && !val) continue;            // ამ კამერას ეს პარამეტრი არ აქვს
                if (!cap) cap = s.def || '';
                var opts = cap.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
                var up = opts.map(function (x) { return x.toUpperCase(); }).sort().join(',');
                var toggle = up === 'OFF,ON' || up === '0,1';
                out.push({ key: s.key, title: s.title, note: s.note || '', fuse: !!s.fuse, group: s.group || 'cam', value: val, options: opts, toggle: toggle });
            }
            return out;
        },
        async setSetting(ctx, key, value) { return await this.qok(ctx, this.paramPath(key, true, value)); },
        // მნიშვნელობის ქართული წარწერა
        label: function (key, v) {
            var u = String(v || '').toUpperCase(), m;
            if (key === 'LOW_POWER_PROTECT') return { '0': '11.8V', '1': '12.0V', '2': '12.2V' }[u] || v;
            if (key === 'LOW_FPS_REC_TIME') return { '0': '15 წუთი', '1': '12 საათი', '2': '24 საათი', '3': '48 საათი' }[u] || v;
            if ((m = u.match(/^(\d+)\s*MIN$/))) return m[1] + ' წუთი';
            if (u === '50' || u === '60') return u + ' Hz';
            var L = { OFF: 'გამორთული', ON: 'ჩართული', '0': 'გამორთული', '1': 'ჩართული', MUTE: 'უხმოდ', NONE: 'არა', LOW: 'დაბალი', MIDDLE: 'საშუალო', MEDIUM: 'საშუალო', HIGH: 'მაღალი' };
            return L[u] || v;
        }
    };

    window.DC_ADAPTERS = { hidvr: HIDVR, novatek: NOVATEK };
    window.DC_DEFAULT_ADAPTER = 'hidvr';

    // ═══════════ 3. 🌐 კავშირი კამერასთან ═══════════
    // ტელეფონის აპში: ნატიური DashcamWifi.request (CORS-ის გარეშე, კამერის WiFi-ზე).
    // ბრაუზერში ტესტისთვის: ჩვეულებრივი fetch.
    // საცდელი რეჟიმი რეალური კამერის გარეშე: localStorage.setItem('octane_dc_demo', '1')
    var DcNet = {
        plugin: function () {
            var p = window.Capacitor && window.Capacitor.Plugins;
            return (p && p.DashcamWifi) || null;
        },
        // საცდელი რეჟიმი: localStorage-ით ან OCTANE_FLAGS.dashcamDemo-ით (სადემონსტრაციო APK)
        isDemo: function () { return lsGet('octane_dc_demo', '') === '1' || !!(window.OCTANE_FLAGS && window.OCTANE_FLAGS.dashcamDemo); },
        async get(url, timeoutMs) {
            timeoutMs = timeoutMs || 6000;
            if (this.isDemo()) return DcDemo.reply(url);
            var P = this.plugin();
            if (P) {
                var r = await P.request({ url: url, timeout: timeoutMs });
                if (r && r.status >= 200 && r.status < 400) return r.data || '';
                throw new Error('HTTP ' + (r && r.status));
            }
            var ctrl = window.AbortController ? new AbortController() : null;
            var t = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
            try {
                var res = await fetch(url, ctrl ? { signal: ctrl.signal, cache: 'no-store' } : { cache: 'no-store' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return await res.text();
            } finally { if (t) clearTimeout(t); }
        },
        // დიაგნოსტიკისთვის: ნებისმიერ პასუხს აბრუნებს სტატუსით (404-საც), ან null-ს, თუ არავინ უპასუხა
        async probe(url, timeoutMs) {
            timeoutMs = timeoutMs || 3000;
            if (this.isDemo()) {
                await new Promise(function (r) { setTimeout(r, 200); });
                if (String(url).indexOf('192.168.0.1') < 0) return null;
                return { status: 200, data: /cmd=|hisnet/.test(url) ? await DcDemo.reply(url) : '<html><body>DEMO CAMERA</body></html>' };
            }
            var P = this.plugin();
            try {
                if (P) {
                    var r = await P.request({ url: url, timeout: timeoutMs });
                    return r ? { status: r.status || 0, data: r.data || '' } : null;
                }
                var ctrl = window.AbortController ? new AbortController() : null;
                var t = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
                try {
                    var res = await fetch(url, ctrl ? { signal: ctrl.signal, cache: 'no-store' } : { cache: 'no-store' });
                    return { status: res.status, data: await res.text() };
                } finally { if (t) clearTimeout(t); }
            } catch (e) { return null; }
        }
    };
    window.DcNet = DcNet;

    // საცდელი პასუხები (მხოლოდ octane_dc_demo=1-ის დროს) - ინტერფეისის შესამოწმებლად
    var DcDemo = {
        files: null,
        list: function () {
            if (this.files) return this.files;
            var f = [], d = new Date();
            for (var i = 0; i < 9; i++) {
                var t = new Date(d.getTime() - i * 3 * 60000 - 3600000);
                var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
                var stamp = t.getFullYear() + '_' + p2(t.getMonth() + 1) + p2(t.getDate()) + '_' + p2(t.getHours()) + p2(t.getMinutes()) + p2(t.getSeconds());
                var time = t.getFullYear() + '/' + p2(t.getMonth() + 1) + '/' + p2(t.getDate()) + ' ' + p2(t.getHours()) + ':' + p2(t.getMinutes()) + ':' + p2(t.getSeconds());
                var dir = i === 2 || i === 6 ? 'MOVIE\\RO' : (i === 4 ? 'PHOTO' : 'MOVIE');
                var ext = i === 4 ? 'JPG' : 'MP4';
                var name = stamp + '_' + p2(i) + '.' + ext;
                f.push({ name: name, path: 'A:\\CARDV\\' + dir + '\\' + name, size: i === 4 ? 812345 : 180000000 + i * 1234567, time: time, attr: dir === 'MOVIE\\RO' ? 33 : 32 });
            }
            this.files = f;
            return f;
        },
        // HiDvr (hisnet) საცდელი კამერა
        hiFiles: null,
        hiSettings: { MEDIAMODE: '1296P', ENC_PAYLOAD_TYPE: 'H264', AUDIO: '1', Rec_Split_Time: '1MIN', GSR_SENSITIVITY: 'LOW', GSR_PARKING: 'OFF',
                      LOW_FPS_REC: '0', LOW_FPS_REC_TIME: '0', LOW_POWER_PROTECT: '1', VOLUME: 'LOW', ANTIFLICKER: 'NONE', FLIP: '1', MIRROR: '1' },
        hiCaps: { MEDIAMODE: '1296P,1080P,720P', ENC_PAYLOAD_TYPE: 'H264,H265', AUDIO: '0,1', Rec_Split_Time: '1MIN,3MIN,5MIN', GSR_SENSITIVITY: 'OFF,LOW,MIDDLE,HIGH',
                  GSR_PARKING: 'OFF,LOW,MIDDLE,HIGH', LOW_FPS_REC: '0,1', LOW_FPS_REC_TIME: '0,1,2,3', LOW_POWER_PROTECT: '0,1,2', VOLUME: 'MUTE,LOW,MIDDLE,HIGH',
                  ANTIFLICKER: 'NONE,50,60', FLIP: '0,1', MIRROR: '0,1' },
        hiList: function () {
            if (this.hiFiles) return this.hiFiles;
            var p2 = function (n) { return (n < 10 ? '0' : '') + n; }, d = new Date(), f = { norm: [], emr: [], photo: [] };
            for (var i = 0; i < 30; i++) {
                var t = new Date(d.getTime() - i * 60000 - (i > 17 ? 86400000 : 0) - 1800000);
                var stamp = t.getFullYear() + '_' + p2(t.getMonth() + 1) + '_' + p2(t.getDate()) + '_' + p2(t.getHours()) + p2(t.getMinutes()) + p2(t.getSeconds());
                if (i === 5 || i === 21) f.emr.push('sd/emr/' + stamp + '_00.MP4');
                else if (i === 9) f.photo.push('sd/photo/' + stamp + '_00.JPG');
                else f.norm.push('sd/norm/' + stamp + '_00.MP4');
            }
            this.hiFiles = f;
            return f;
        },
        hisnet: function (url) {
            var u = String(url), q = function (k) { var m = u.match(new RegExp('-' + k + '=([^&]*)')); return m ? decodeURIComponent(m[1]) : ''; };
            var v = function (o) { return Object.keys(o).map(function (k) { return 'var ' + k + '="' + o[k] + '";'; }).join('\n'); };
            var L = this.hiList();
            if (/getdeviceattr/.test(u)) return v({ softversion: 'DEMO_1.0.0', model: 'LF9', product: 'HiDvr', mac: '00:11:22:33:44:55' });
            if (/getdircapability/.test(u)) return v({ capability: 'norm,emr,photo' });
            if (/getdirfilecount/.test(u)) return v({ count: (L[q('dir')] || []).length });
            if (/getdirfilelist/.test(u)) { var a = L[q('dir')] || []; return a.slice(+q('start'), +q('end') + 1).join(';') + ';'; }
            if (/getsdstatus/.test(u)) return v({ sdstatus: '0', sdfreespace: '37580 MB', sdtotalspace: '58573 MB', partitionnum: '1' });
            if (/getfileinfo/.test(u)) return v({ size: '187000000', time: '60', create: '2026/10/27 15:44:00' });
            if (/param(capability)?\.cgi/.test(u) && /get/.test(u)) {
                var key = q('type');
                if (/capability/.test(u)) return this.hiCaps[key] ? v({ capability: this.hiCaps[key] }) : 'SvrFuncResult="-1"';
                return this.hiSettings[key] !== undefined ? v({ value: this.hiSettings[key] }) : 'SvrFuncResult="-1"';
            }
            if (/setcamparam|setcommparam/.test(u)) { this.hiSettings[q('type')] = q('value'); return 'Success'; }
            if (/deletefile/.test(u)) {
                var n = q('name');
                ['norm', 'emr', 'photo'].forEach(function (k) { L[k] = L[k].filter(function (x) { return x !== n; }); });
                return 'Success';
            }
            return 'Success';
        },
        reply: async function (url) {
            await new Promise(function (r) { setTimeout(r, 250); });
            if (/\/cgi-bin\/hisnet\//.test(url)) return this.hisnet(url);
            var m = String(url).match(/cmd=(\d+)/);
            var cmd = m ? +m[1] : 0;
            if (cmd === 3015) {
                return '<?xml version="1.0" encoding="UTF-8" ?><LIST><ALLFile>' + this.list().map(function (x) {
                    return '<File><NAME>' + x.name + '</NAME><FPATH>' + x.path + '</FPATH><SIZE>' + x.size + '</SIZE><TIMECODE>0</TIMECODE><TIME>' + x.time + '</TIME><ATTR>' + x.attr + '</ATTR></File>';
                }).join('') + '</ALLFile></LIST>';
            }
            if (cmd === 4003) {
                var s = decodeURIComponent((String(url).match(/str=(.*)$/) || [])[1] || '');
                this.files = this.list().filter(function (x) { return x.path !== s; });
            }
            if (cmd === 3012) return '<Function><Cmd>3012</Cmd><Status>0</Status><String>DEMO_FW_1.0</String></Function>';
            if (cmd === 3017) return '<Function><Cmd>3017</Cmd><Status>0</Status><Value>17179869184</Value></Function>';
            return '<Function><Cmd>' + cmd + '</Cmd><Status>0</Status></Function>';
        }
    };

    // ═══════════ 4. 🔀 რეჟიმის არჩევა (OBD / ვიდეორეგისტრატორი) ═══════════
    document.addEventListener('alpine:init', function () {
        window.Alpine.store('octaneMode', {
            // ⚙️ OCTANE_FLAGS.showDashcam = false → არჩევანის ეკრანი არ ჩანს, აპი პირდაპირ OBD-ზე იხსნება
            screen: (window.OCTANE_FLAGS && window.OCTANE_FLAGS.showDashcam === false) ? 'obd' : 'choose',   // 'choose' | 'obd' | 'dashcam'
            step: 'pick',              // 'pick' | 'dc-code'
            dcActivated: window.OCTANE_DASHCAM_KEY.isActivated() || !!(window.OCTANE_FLAGS && window.OCTANE_FLAGS.dashcamDemo) || !!(window.OCTANE_DEMO && window.OCTANE_DEMO.on()),
            dcInput: '',
            dcError: '',
            dcSuccess: '',
            dcShake: false,

            pick: function (mode) {
                if (mode === 'obd') { this.go('obd'); return; }
                if (this.dcActivated) { this.go('dashcam'); return; }
                this.dcInput = ''; this.dcError = ''; this.dcSuccess = '';
                this.step = 'dc-code';
            },
            go: function (mode) {
                if (mode !== 'obd' && window.OCTANE_FLAGS && window.OCTANE_FLAGS.showDashcam === false) mode = 'obd';
                if (mode === 'dashcam' && !this.dcActivated) {
                    this.screen = 'choose'; this.pick('dashcam'); return;
                }
                if (mode === 'dashcam') {
                    // OBD სკანერის WiFi-ს გათავისუფლება, რომ კამერის ქსელს არ შეეჯახოს
                    try {
                        var root = document.getElementById('diagnostic-app');
                        var obd = root && window.Alpine.$data(root);
                        if (obd && obd.connected && typeof obd.disconnectOBD === 'function') obd.disconnectOBD();
                    } catch (e) {}
                } else {
                    window.dispatchEvent(new CustomEvent('dc-leave'));
                }
                this.screen = mode;
                this.step = 'pick';
                document.documentElement.classList.toggle('dc-on', mode === 'dashcam');
                try { window.scrollTo(0, 0); } catch (e) {}
            },
            backToChooser: function () {
                this.step = 'pick';
                this.screen = 'choose';
                document.documentElement.classList.remove('dc-on');
            },
            submitDc: function () {
                if (!this.dcInput) {
                    this.dcError = 'შეიყვანეთ კოდი!';
                    this.shake();
                    return;
                }
                var r = window.OCTANE_DASHCAM_KEY.verify(this.dcInput);
                if (r.success) {
                    this.dcError = '';
                    this.dcSuccess = r.message;
                    var self = this;
                    setTimeout(function () { self.dcActivated = true; self.dcSuccess = ''; self.go('dashcam'); }, 1000);
                } else {
                    this.dcSuccess = '';
                    this.dcError = r.message;
                    this.shake();
                }
            },
            shake: function () {
                var self = this;
                this.dcShake = true;
                setTimeout(function () { self.dcShake = false; }, 450);
            }
        });
    });

    // ═══════════ 5. 📹 დეშ ქემის განყოფილება ═══════════
    window.dashcamApp = function () {
        return {
            dcTab: 'camera',              // 'camera' | 'gallery' | 'settings'
            dcFolder: 'normal',           // 'normal' | 'locked' | 'photo'
            dcMenuOpen: false,
            dcConnected: false,
            dcConnecting: false,
            dcStatus: 'გათიშულია',
            dcModernWifi: false,
            dcHelpOpen: false,
            dcHelpFailed: false,

            dcFiles: [],
            dcListLoading: false,
            dcListError: '',

            dcPlayer: { open: false, file: null, src: '', error: '' },
            dcConfirm: { open: false, file: null },
            dcBusy: '',                   // მიმდინარე მოქმედების ტექსტი (გადმოწერა...)
            dcProgress: -1,               // 0-100, ან -1 თუ უცნობია
            dcToast: '',
            dcToastTimer: null,

            dcLiveSrc: '',
            dcLiveError: false,
            dcRecording: true,

            dcInfo: { firmware: '', freeBytes: 0, model: '', res: '', codec: '' },
            dcSettings: Object.assign({ adapter: window.DC_DEFAULT_ADAPTER, ip: '', ssid: '', password: '12345678' }, lsJson('octane_dc_settings', {})),

            // 🔎 სტატუსი, მრავალჯერადი არჩევა, დიაგნოსტიკა
            dcFailed: false,
            dcSsid: '',
            dcFoundIp: '',
            dcNotConfigured: false,
            dcSheetOpen: false,
            dcTroubleOpen: false,
            dcSel: {},
            dcPressTimer: null,
            dcPressFired: false,
            dcBulkText: '',
            dcDiag: { running: false, done: false, wifi: '', phoneIp: '', gateway: '', rows: [] },
            dcDownloads: lsJson('octane_dc_downloads', {}),
            dcGallery: lsJson('octane_dc_gallery', {}),         // { ფაილის id: true } - ტელეფონის გალერეაში უკვე შენახულია
            dcProxy: '',                                        // ნატიური შუამავალი (http://127.0.0.1:PORT) - ესკიზები და ვიდეოები მისი გავლით     // { ფაილის id: ტელეფონში შენახული ფაილის მისამართი }
            dcDurations: lsJson('octane_dc_durations', {}),     // { ფაილის id: წამები }
            dcDemo: DcNet.isDemo(),

            // ✂️ მოჭრა
            dcTrim: { open: false, start: 0, end: 0, dur: 0, busy: false, result: null },
            dcClips: lsJson('octane_dc_clips', []),             // მოჭრილი ნაწილები (მხოლოდ ტელეფონში)

            // 📇 HiDvr: სესია, ბარათი, პარამეტრები, ტელეფონში შენახულები
            dcPhoneIp: '',
            dcHbTimer: null,
            dcSd: null,                                          // { total, free } ბაიტებში
            dcDlMeta: lsJson('octane_dc_dlmeta', {}),           // გადმოწერილი ფაილების აღწერა (კამერის გარეშე სანახავად)
            dcCam: { loading: false, loaded: false, error: '', list: [] },
            dcPick: { open: false, item: null, busy: false },
            dcFormat: { open: false, step: 1, busy: false },

            // 🪟 ქვედა ფანჯრები: '' | 'menu' | 'guide' | 'trouble' | 'edit' | 'model' | 'diag'
            dcSheet: '',
            dcEdit: { field: '', title: '', value: '', hint: '', placeholder: '', mode: 'text' },
            dcTrOpen: -1,

            init: function () {
                var self = this;
                window.addEventListener('dc-leave', function () { self.dcDisconnect(); });
                this.$watch('dcTab', function (tab, old) { self.dcOnTab(tab, old); });
                this.$watch('dcFolder', function () { self.dcSel = {}; });
                // ძებნა იწყება მხოლოდ დაკავშირების ღილაკზე დაჭერით (ავტომატურად არა)

                // 📺 ცოცხალი ხედი: ფანჯრის გახსნისას ვმალავთ, გადახვევისას ადგილს ვუსწორებთ
                ['dcSheet', 'dcPick.open', 'dcFormat.open', 'dcConfirm.open', 'dcConfirmClip.open', 'dcPlayer.open'].forEach(function (k) {
                    self.$watch(k, function () { self.dcLiveSync(); });
                });
                this.$watch('$store.octaneMode.screen', function (s) {
                    if (s !== 'dashcam') { self.dcLiveStop(); return; }
                    // სადემონსტრაციო APK: ვითომ უკვე დაკავშირებულია
                    if (window.OCTANE_FLAGS && window.OCTANE_FLAGS.dashcamDemo && !self.dcConnected && !self.dcConnecting) self.dcConnect();
                });
                this.$nextTick(function () {
                    var app = document.querySelector('.dc-app');
                    if (app) app.addEventListener('scroll', function () { self.dcLiveSyncSoon(); }, { passive: true });
                    window.addEventListener('resize', function () { self.dcLiveSyncSoon(); });
                });

                var P = DcNet.plugin();
                if (P) {
                    P.isSupported().then(function (r) { self.dcModernWifi = !!(r && r.supported); }).catch(function () {});
                    // აპი მხოლოდ ვერტიკალურია; ვიდეო სრულ ეკრანზე გადატრიალებით ჩანს
                    var onFs = function () {
                        var fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
                        if (P.setOrientation) P.setOrientation({ mode: fs ? 'auto' : 'portrait' }).catch(function () {});
                    };
                    document.addEventListener('fullscreenchange', onFs);
                    document.addEventListener('webkitfullscreenchange', onFs);
                    try {
                        P.addListener('liveState', function (e) { if (self.dcLiveOn && e && e.state) { self.dcLiveState = e.state; self.dcLiveDetail = e.detail || ''; } });
                        P.addListener('lost', function () {
                            if (!self.dcConnected) return;
                            self.dcLiveStop();
                            self.dcConnected = false;
                            self.dcLiveSrc = '';
                            self.dcStatus = 'კამერასთან კავშირი გაწყდა';
                            self.dcShowToast('კამერასთან კავშირი გაწყდა. დააჭირე დაკავშირებას თავიდან.');
                        });
                        P.addListener('downloadProgress', function (e) {
                            if (e && e.total > 0) self.dcProgress = Math.min(100, Math.round(e.loaded * 100 / e.total));
                        });
                        // გალერეაში შენახვამდე ვიდეოს ტელეფონისთვის გადაყვანა (1296P → 1080p)
                        P.addListener('compatProgress', function (e) {
                            if (!e) return;
                            self.dcBusy = 'ვამზადებ ტელეფონის გალერეისთვის...';
                            self.dcProgress = Math.max(0, Math.min(100, e.percent | 0));
                        });
                    } catch (e) {}
                }
            },

            // ─────────── საერთო ───────────
            // საცდელი რეჟიმი ყოველთვის HiDvr-ის საცდელ კამერას იყენებს
            get dcAdapter() { return this.dcDemo ? HIDVR : (window.DC_ADAPTERS[this.dcSettings.adapter] || HIDVR); },
            dcCtx: function () {
                return { ip: (this.dcSettings.ip || this.dcFoundIp || this.dcAdapter.defaultIp || '192.168.1.254').trim(), phoneIp: this.dcPhoneIp, http: function (u) { return DcNet.get(u); } };
            },
            dcConfigured: function () { return this.dcAdapter.configured !== false; },
            // ⚠️ მარკაპში ადაპტერის ფუნქციას პირდაპირ არ ვწერთ (x-show="dcAdapter.formatSd") -
            // Alpine ფუნქციას გამოიძახებს! ამიტომ მხოლოდ true/false-ს ვაბრუნებთ.
            dcHas: function (name) { return typeof this.dcAdapter[name] === 'function'; },
            dcShowToast: function (msg) {
                var self = this;
                this.dcToast = msg;
                clearTimeout(this.dcToastTimer);
                this.dcToastTimer = setTimeout(function () { self.dcToast = ''; }, 3500);
            },
            dcIsApp: function () { return !!DcNet.plugin(); },
            dcNoFeature: function (what) {
                return this.dcDemo ? what + ' საცდელ რეჟიმში არ მუშაობს - ნამდვილ კამერაზე იმუშავებს.' : what + ' მუშაობს მხოლოდ ტელეფონის აპში.';
            },

            // ─────────── 📶 დაკავშირება ───────────
            async dcConnect() {
                if (this.dcConnecting) return;
                this.dcConnecting = true;
                this.dcFailed = false;
                this.dcHelpOpen = false;
                this.dcStatus = 'ვეძებ კამერას...';
                var P = DcNet.plugin();
                var s = this.dcSettings;
                var adapter = this.dcAdapter;
                var ssid = '';
                try {
                    if (P && !this.dcDemo) {
                        var sup = null;
                        try { sup = await P.isSupported(); } catch (e) {}
                        if (sup && sup.supported) {
                            try {
                                // ქსელი, რომლის სახელი იწყება HiDvr_-ით (ზუსტი სახელის ცოდნა არ სჭირდება)
                                var c = await P.connect({ ssid: (s.ssid || '').trim(), prefix: adapter.ssidPrefix || '', pattern: '.*', password: s.password || '' });
                                ssid = (c && c.ssid) || '';
                            } catch (e) {
                                // გაუქმდა / ვერ მოიძებნა - იქნებ ტელეფონი უკვე ხელით არის დაკავშირებული
                                try { await P.bindToWifi(); } catch (e2) {}
                            }
                        } else {
                            try { await P.bindToWifi(); } catch (e) {}
                        }
                        // ტელეფონის მისამართი კამერის ქსელში (HiDvr-ს რეგისტრაციისთვის სჭირდება)
                        try { var w = await P.wifiInfo(); if (!ssid) ssid = (w && w.ssid) || ''; this.dcPhoneIp = (w && w.ip) || ''; } catch (e) {}
                    }
                    if (this.dcDemo) { ssid = 'HiDvr_DEMO'; this.dcPhoneIp = '192.168.0.100'; }
                    var ok = await adapter.ping(this.dcCtx());
                    if (!ok) throw new Error('NO_CAMERA');
                    if (typeof ok === 'string') this.dcFoundIp = ok;
                    if (adapter.onConnect) { try { await adapter.onConnect(this.dcCtx()); } catch (e) {} }
                    this.dcSsid = ssid;
                    this.dcProxy = '';
                    if (P && P.proxyBase && !this.dcDemo) { try { this.dcProxy = (await P.proxyBase()).base || ''; } catch (e) {} }
                    this.dcConnected = true;
                    this.dcStatus = 'დაკავშირებულია: ' + (ssid || 'კამერა');
                    lsSet('octane_dc_connected_once', 'true');
                    this.dcCam = { loading: false, loaded: false, error: '', list: [] };
                    this.dcFiles = [];
                    this.dcLoadSd();
                    this.dcStartHeartbeat();
                    var self = this;
                    this.dcAdapter.getInfo(this.dcCtx()).then(function (i) { self.dcInfo = i; }).catch(function () {});
                    // სადაც იყო, იქვე: კამერაზე - ცოცხალი ხედი, გალერეაში - სია, პარამეტრებში - პარამეტრები
                    if (this.dcTab === 'camera') this.dcLiveStart(); else this.dcOnTab(this.dcTab, 'camera');
                } catch (e) {
                    this.dcConnected = false;
                    this.dcFailed = true;
                    this.dcStatus = 'კამერა ვერ მოიძებნა';
                    try { if (P) await P.disconnect(); } catch (e2) {}
                } finally {
                    this.dcConnecting = false;
                }
            },
            async dcDisconnect() {
                var wasOn = this.dcConnected;
                this.dcLiveStop();
                this.dcLiveSrc = '';
                this.dcConnected = false;
                this.dcPlayer.open = false;
                this.dcSel = {};
                this.dcSsid = '';
                this.dcFailed = false;
                this.dcNotConfigured = false;
                this.dcStatus = 'გათიშულია';
                clearInterval(this.dcHbTimer);
                this.dcHbTimer = null;
                this.dcSd = null;
                if (wasOn) {
                    // კამერა ისევ ჩაწერის რეჟიმში დავაბრუნოთ, რომ გზაზე ჩაწერა არ შეწყდეს
                    try { await this.dcAdapter.resumeRecording(this.dcCtx()); } catch (e) {}
                    if (this.dcAdapter.onDisconnect) { try { await this.dcAdapter.onDisconnect(this.dcCtx()); } catch (e) {} }
                }
                var P = DcNet.plugin();
                try { if (P) await P.disconnect(); } catch (e) {}
            },
            dcSwitchToObd: function () {
                this.dcMenuOpen = false;
                this.$store.octaneMode.go('obd');
            },

            // ─────────── 🎞️ ვიდეოების სია ───────────
            async dcLoadFiles() {
                if (!this.dcConnected) return;
                this.dcListLoading = true;
                this.dcListError = '';
                this.dcNotConfigured = false;
                try {
                    var ctx = this.dcCtx();
                    await this.dcAdapter.enterPlayback(ctx);
                    var files = await this.dcAdapter.listFiles(ctx);
                    files.sort(function (a, b) { return b.time - a.time; });
                    this.dcFiles = files;
                } catch (e) {
                    if (e && e.message === 'NOT_CONFIGURED') { this.dcNotConfigured = true; return; }
                    this.dcListError = 'სიის ჩამოტვირთვა ვერ მოხერხდა. შეამოწმე კავშირი და სცადე თავიდან.';
                } finally {
                    this.dcRawLog = (this.dcAdapter.log || []).slice();
                    this.dcListLoading = false;
                }
            },
            get dcShown() {
                var f = this.dcFolder;
                if (f === 'phone') return this.dcPhoneFiles;
                return this.dcFiles.filter(function (x) { return x.folder === f; });
            },
            // 📱 ტელეფონში შენახული (გადმოწერილი) ფაილები - კამერის გარეშეც ჩანს
            get dcPhoneFiles() {
                var meta = this.dcDlMeta, dl = this.dcDownloads;
                return Object.keys(meta).filter(function (id) { return dl[id]; }).map(function (id) {
                    return Object.assign({}, meta[id], { id: id, local: true });
                }).sort(function (a, b) { return b.time - a.time; });
            },
            dcCount: function (folder) {
                if (folder === 'phone') return this.dcPhoneFiles.length;
                return this.dcFiles.filter(function (x) { return x.folder === folder; }).length;
            },
            dcThumb: function (f) {
                if (f && f.local) {
                    var lp = this.dcDownloads[f.id];
                    return f.kind === 'photo' && lp && window.Capacitor && window.Capacitor.convertFileSrc ? window.Capacitor.convertFileSrc('file://' + lp) : '';
                }
                if (this.dcDemo) return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4c9bff"/><stop offset="1" stop-color="#0f2a5c"/></linearGradient></defs><rect width="16" height="9" fill="url(#g)"/><rect y="6" width="16" height="3" fill="#2b3550"/></svg>');
                if (f.kind === 'photo') return this.dcViaProxy(this.dcAdapter.fileUrl(this.dcCtx().ip, f));
                return this.dcViaProxy(this.dcAdapter.thumbUrl(this.dcCtx().ip, f));
            },
            // კამერის ფაილს WebView ნატიური შუამავლის გავლით ხსნის (WebView თავად კამერის WiFi-ს ყველგან ვერ წვდება)
            dcViaProxy: function (url) {
                if (!this.dcProxy || !/^http:\/\//.test(url || '')) return url;
                return this.dcProxy + '/http/' + url.slice(7);
            },
            dcSrc: function (f) {
                var local = this.dcDownloads[f.id];
                if (local && window.Capacitor && window.Capacitor.convertFileSrc) return window.Capacitor.convertFileSrc('file://' + local);
                return this.dcViaProxy(this.dcAdapter.fileUrl(this.dcCtx().ip, f));
            },

            // ─────────── ▶️ ყურება ───────────
            dcOpen: function (f) {
                this.dcPlayer = { open: true, file: f, src: this.dcDemo && f.kind === 'video' ? '' : this.dcSrc(f), error: this.dcDemo && f.kind === 'video' ? 'საცდელ რეჟიმში ვიდეო არ ირთვება.' : '' };
                if (f.kind === 'video' && this.dcNativeVideo()) this.dcPlayNative();
            },
            // ტელეფონის აპში ვიდეოს ნატიური ფლეერი უკრავს (WebView იაფ ტელეფონებზე 1296P-ს ვერ აჩვენებს - შავი ეკრანი)
            dcNativeVideo: function () {
                var P = DcNet.plugin();
                return !!(P && P.openVideo && !this.dcDemo);
            },
            dcPlayNative: function (startMs, endMs) {
                var f = this.dcPlayer.file;
                var P = DcNet.plugin();
                if (!f || !P || !P.openVideo) return;
                var local = this.dcDownloads[f.id];
                var url = local || this.dcViaProxy(this.dcAdapter.fileUrl(this.dcCtx().ip, f));
                var o = { url: url, title: this.dcFmtTimeS(f.time) };
                if (startMs != null) { o.startMs = Math.round(startMs); o.endMs = Math.round(endMs); }
                P.openVideo(o).catch(function () {});
            },
            dcClosePlayer: function () {
                var v = document.querySelector('.dc-player video');
                if (v) { try { v.pause(); } catch (e) {} }
                this.dcPlayer = { open: false, file: null, src: '', error: '' };
            },
            dcOnMeta: function (e) {
                var f = this.dcPlayer.file;
                var d = e && e.target ? e.target.duration : 0;
                if (f && d && isFinite(d)) {
                    this.dcDurations[f.id] = Math.round(d);
                    lsSet('octane_dc_durations', JSON.stringify(this.dcDurations));
                }
            },
            // პირდაპირ კამერიდან ვერ ჩაირთო → ავტომატურად ვტვირთავთ ტელეფონში და იქიდან ვრთავთ
            async dcOnVideoError() {
                var f = this.dcPlayer.file;
                if (!f || this.dcPlayer.retried || this.dcIsDownloaded(f) || this.dcDemo || !DcNet.plugin()) {
                    this.dcPlayer.error = 'ვიდეო ვერ ჩაირთო. შეამოწმე კამერასთან კავშირი და სცადე თავიდან.';
                    return;
                }
                this.dcPlayer.retried = true;
                this.dcPlayer.src = '';
                var path = await this.dcDownload(f, true, 'ვიდეო იტვირთება...');
                if (!this.dcPlayer.open || this.dcPlayer.file !== f) return;
                if (path && window.Capacitor && window.Capacitor.convertFileSrc) this.dcPlayer.src = window.Capacitor.convertFileSrc('file://' + path);
                else this.dcPlayer.error = 'ვიდეო ვერ ჩაირთო. შეამოწმე კამერასთან კავშირი და სცადე თავიდან.';
            },
            dcInGallery: function (f) { return !!(f && (f.kind === 'video' ? this.dcGallery[f.id] === 'mark' : this.dcGallery[f.id])); },

            // ─────────── ⬇️ გადმოწერა / გალერეა / გაზიარება ───────────
            dcIsDownloaded: function (f) { return !!(f && this.dcDownloads[f.id]); },
            async dcDownload(f, quiet, busyText) {
                if (this.dcIsDownloaded(f)) return this.dcDownloads[f.id];
                var P = DcNet.plugin();
                if (!P || this.dcDemo) { this.dcShowToast(this.dcNoFeature('გადმოწერა')); return null; }
                if (this.dcBusy) return null;
                this.dcBusy = busyText || 'გადმოწერა...';
                this.dcProgress = 0;
                try {
                    var r = await P.download({ url: this.dcAdapter.fileUrl(this.dcCtx().ip, f), fileName: f.name });
                    this.dcDownloads[f.id] = r.path;
                    lsSet('octane_dc_downloads', JSON.stringify(this.dcDownloads));
                    this.dcDlMeta[f.id] = { name: f.name, kind: f.kind, mime: f.mime, time: f.time, size: r.size || f.size || 0, folder: f.folder };
                    lsSet('octane_dc_dlmeta', JSON.stringify(this.dcDlMeta));
                    if (!quiet) this.dcShowToast('ჩამოიტვირთა ტელეფონში.');
                    // თუ ახლა ამ ვიდეოს ვუყურებთ, შემდეგში ტელეფონიდან ჩაირთოს (უფრო სწრაფად)
                    return r.path;
                } catch (e) {
                    this.dcShowToast('გადმოწერა ვერ მოხერხდა. შეამოწმე კამერასთან კავშირი.');
                    return null;
                } finally {
                    this.dcBusy = '';
                    this.dcProgress = -1;
                }
            },
            // ─────────── 🏷️ ბრენდირება (ნატიური brand: ვიდეო + ზემოდან ეს სურათი) ───────────
            // story - ვერტიკალური 1080×1920 ჩარჩო გასაზიარებლად (ვარიანტი A, ღია);
            // mark  - Octane App წარწერა ქვედა მარჯვენა კუთხეში, ვიდეოს კადრებში (გალერეაშიც ჩანს).
            dcBrandedPaths: {},
            dcLoadImg: function (src) {
                return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = src; });
            },
            dcDateLabel: function (t) {
                if (!t) return '';
                var M = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
                var d = new Date(t);
                return d.getDate() + ' ' + M[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
            },
            async dcOverlay(mode, W, H, vw, vh, f) {
                try { await Promise.all([document.fonts.load('700 52px "Noto Sans Georgian"'), document.fonts.load('600 42px Inter'), document.fonts.load('400 44px "Noto Sans Georgian"')]); } catch (e) {}
                var car = await this.dcLoadImg('img/octane-car.png');
                var c = document.createElement('canvas');
                c.width = W; c.height = H;
                var g = c.getContext('2d');
                g.textAlign = 'center'; g.textBaseline = 'middle';
                if (mode === 'story') {
                    var word = await this.dcLoadImg('img/octane-word.png');
                    // ვიდეოს ფანჯარა (Presentation / AVFoundation - პროპორციით, ცენტრში)
                    var sc = Math.min(W / vw, H / vh), ww = vw * sc, wh = vh * sc, wx = (W - ww) / 2, wy = (H - wh) / 2;
                    g.fillStyle = '#EDEFF2';
                    g.fillRect(0, 0, W, H);
                    g.clearRect(Math.round(wx) + 1, Math.round(wy) + 1, Math.round(ww) - 2, Math.round(wh) - 2);
                    // ზემოთ: ლოგო
                    var ch = 120, cw = car.width * ch / car.height, wdh = 84, wdw = word.width * wdh / word.height, gap = 32;
                    var bx = (W - cw - gap - wdw) / 2, by = wy / 2;
                    g.drawImage(car, bx, by - ch / 2, cw, ch);
                    g.drawImage(word, bx + cw + gap, by - wdh / 2 + 4, wdw, wdh);
                    // ქვემოთ: ტექსტი, თარიღი, Octane App
                    var date = this.dcDateLabel(f && f.time);
                    var mid = wy + wh + (H - wy - wh) / 2, y0 = mid - (date ? 92 : 64);
                    g.fillStyle = '#111418';
                    g.font = '700 52px "Noto Sans Georgian", Inter, sans-serif';
                    g.fillText('ქართული ვიდეორეგისტრატორი', W / 2, y0);
                    var y = y0 + 52;
                    if (date) {
                        g.fillStyle = '#6B7280';
                        g.font = '400 42px "Noto Sans Georgian", Inter, sans-serif';
                        g.fillText(date, W / 2, y + 22);
                        y += 66;
                    }
                    g.font = '600 42px Inter, sans-serif';
                    var tw = g.measureText('Octane App').width, pw = tw + 88, ph = 84, px = (W - pw) / 2, py = y + 40;
                    g.fillStyle = '#FFFFFF';
                    g.beginPath();
                    if (g.roundRect) g.roundRect(px, py, pw, ph, ph / 2); else g.rect(px, py, pw, ph);
                    g.fill();
                    g.fillStyle = '#111418';
                    g.fillText('Octane App', W / 2, py + ph / 2 + 2);
                } else {
                    // წყლის ნიშანი: ქვედა მარჯვენა კუთხე
                    var fs = Math.max(18, Math.round(H * 0.032)), ih = Math.round(fs * 1.05), iw = car.width * ih / car.height;
                    g.font = '600 ' + fs + 'px Inter, sans-serif';
                    g.textAlign = 'right';
                    var rx = W - Math.round(W * 0.024), ry = H - Math.round(H * 0.035) - fs / 2;
                    var tw2 = g.measureText('Octane App').width;
                    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = fs * 0.3; g.shadowOffsetY = fs * 0.08;
                    g.fillStyle = 'rgba(255,255,255,0.9)';
                    g.fillText('Octane App', rx, ry + 2);
                    g.drawImage(car, rx - tw2 - fs * 0.35 - iw, ry - ih / 2, iw, ih);
                }
                return c.toDataURL('image/png').split(',')[1];
            },
            async dcBrandFile(f, mode) {
                var P = DcNet.plugin();
                if (!P || this.dcDemo || !f || f.kind !== 'video') return null;
                var key = mode + ':' + f.id;
                if (this.dcBrandedPaths[key]) return this.dcBrandedPaths[key];
                var path = await this.dcDownload(f, true);
                if (!path) return null;
                this.dcBusy = mode === 'story' ? 'ვამზადებ გასაზიარებლად...' : 'ვამატებ წარწერას...';
                this.dcProgress = -1;
                try {
                    var info = await P.probe({ path: path });
                    var vw = info.width || 1920, vh = info.height || 1080, W, H;
                    if (mode === 'story') { W = 1080; H = 1920; }
                    else {
                        var k = Math.min(1, 1080 / Math.min(vw, vh));
                        W = Math.round(vw * k / 2) * 2; H = Math.round(vh * k / 2) * 2;
                    }
                    var ov = await this.dcOverlay(mode, W, H, vw, vh, f);
                    var r = await P.brand({ path: path, overlay: ov, width: W, height: H, fileName: f.name, suffix: mode === 'story' ? 'story' : 'octane' });
                    this.dcBrandedPaths[key] = r.path;
                    return r.path;
                } catch (e) {
                    return null;
                } finally {
                    this.dcBusy = '';
                    this.dcProgress = -1;
                }
            },
            async dcSaveToGallery(f, quiet) {
                if (this.dcInGallery(f)) { if (!quiet) this.dcShowToast('უკვე შენახულია ტელეფონის გალერეაში.'); return true; }
                var path = await this.dcDownload(f, true);
                if (!path) return false;
                var marked = f.kind === 'video' ? await this.dcBrandFile(f, 'mark') : null;
                this.dcBusy = 'გალერეაში შენახვა...';
                try {
                    await DcNet.plugin().saveToGallery({ path: marked || path, mime: marked ? 'video/mp4' : f.mime, fileName: marked ? String(f.name).replace(/\.[A-Za-z0-9]+$/, '') + '_octane.mp4' : f.name });
                    this.dcGallery[f.id] = marked ? 'mark' : true;
                    lsSet('octane_dc_gallery', JSON.stringify(this.dcGallery));
                    if (f.kind === 'video' && !marked) this.dcShowToast('შენახულია, მაგრამ Octane App წარწერა ვერ დაემატა.');
                    else if (!quiet) this.dcShowToast(isIOS() ? 'შენახულია ტელეფონის გალერეაში (Photos).' : 'შენახულია ტელეფონის გალერეაში (Octane DashCam ალბომი).');
                    return true;
                } catch (e) {
                    var m = e && e.message ? e.message : '';
                    this.dcShowToast(m.indexOf('PERMISSION') >= 0 ? 'გალერეაში შესანახად საჭიროა ნებართვა.' : 'გალერეაში შენახვა ვერ მოხერხდა.');
                } finally {
                    this.dcBusy = '';
                }
            },
            async dcShare(f) {
                var path = await this.dcDownload(f, true);
                if (!path) return;
                try {
                    await DcNet.plugin().share({ path: path, mime: f.mime, title: 'გაზიარება' });
                } catch (e) {
                    this.dcShowToast('გაზიარება ვერ მოხერხდა.');
                }
            },

            // Instagram / Facebook / TikTok: ვიდეო ვერტიკალურ ჩარჩოში → პირდაპირ ამ აპში (Android); iPhone-ზე - გაზიარების მენიუ
            async dcShareTo(f, app) {
                var PK = { instagram: ['com.instagram.android'], facebook: ['com.facebook.katana', 'com.facebook.lite'], tiktok: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'] };
                var path = await this.dcDownload(f, true);
                if (!path) return;
                var story = f.kind === 'video' ? await this.dcBrandFile(f, 'story') : null;
                if (f.kind === 'video' && !story) this.dcShowToast('ჩარჩოს დამატება ვერ მოხერხდა - იგზავნება ორიგინალი.');
                try {
                    await DcNet.plugin().share({ path: story || path, mime: story ? 'video/mp4' : f.mime, title: 'გაზიარება', packages: PK[app] || [] });
                } catch (e) {
                    this.dcShowToast('გაზიარება ვერ მოხერხდა.');
                }
            },

            // ─────────── 🗑️ წაშლა კამერიდან ───────────
            dcAskDelete: function (f) { this.dcConfirm = { open: true, file: f }; },
            async dcDoDelete() {
                var f = this.dcConfirm.file;
                this.dcConfirm = { open: false, file: null };
                if (!f) return;
                this.dcBusy = 'წაშლა...';
                try {
                    var ok = await this.dcAdapter.deleteFile(this.dcCtx(), f);
                    if (!ok) throw new Error('DELETE');
                    this.dcFiles = this.dcFiles.filter(function (x) { return x.id !== f.id; });
                    if (this.dcPlayer.open && this.dcPlayer.file && this.dcPlayer.file.id === f.id) this.dcClosePlayer();
                    this.dcShowToast('წაიშალა კამერიდან.');
                    this.dcLoadSd();
                } catch (e) {
                    this.dcShowToast('წაშლა ვერ მოხერხდა. დაბლოკილი (ავარიული) ჩანაწერის წაშლა ზოგ კამერაზე მხოლოდ კამერიდანვე შეიძლება.');
                } finally {
                    this.dcBusy = '';
                }
            },

            // ─────────── ✂️ ვიდეოს მოჭრა ───────────
            // ნატიური DashcamWifi.trim (MediaExtractor + MediaMuxer). მოჭრილი ნაწილი ცალკე ფაილია
            // ტელეფონში და dcDownloads-შია ჩაწერილი, ამიტომ გალერეაში შენახვა და გაგზავნა მასზეც მუშაობს.
            dcIsClip: function (f) { return !!(f && f.folder === 'clip'); },
            dcTrimVideo: function () { return document.querySelector('.dc-player video'); },
            async dcTrimOpen() {
                var f = this.dcPlayer.file;
                if (!f || f.kind !== 'video') return;
                var v = this.dcTrimVideo();
                var dur = (v && isFinite(v.duration) && v.duration > 0) ? v.duration : (this.dcDurations[f.id] || (this.dcDemo ? 180 : 0));
                // ნატიური ფლეერის დროს ხანგრძლივობას ფაილიდან ვიგებთ (მოსაჭრელად ვიდეო მაინც ტელეფონში უნდა იყოს)
                if (!dur && this.dcNativeVideo()) {
                    var path = await this.dcDownload(f, true, 'ვიდეო იტვირთება...');
                    if (!path || this.dcPlayer.file !== f) return;
                    try {
                        var info = await DcNet.plugin().probe({ path: path });
                        dur = Math.round((info.durationMs || 0) / 1000);
                        if (dur) { this.dcDurations[f.id] = dur; lsSet('octane_dc_durations', JSON.stringify(this.dcDurations)); }
                    } catch (e) {}
                }
                if (!dur) { this.dcShowToast('ჯერ დაელოდე, სანამ ვიდეო ჩაიტვირთება.'); return; }
                dur = Math.floor(dur);
                var cur = v && isFinite(v.currentTime) ? Math.floor(v.currentTime) : 0;
                var start = Math.min(cur, Math.max(0, dur - 1));
                this.dcTrim = { open: true, start: start, end: Math.min(dur, start + 30), dur: dur, busy: false, result: null };
            },
            dcTrimClose: function () { this.dcTrim = { open: false, start: 0, end: 0, dur: 0, busy: false, result: null }; },
            dcTrimSet: function (which, val) {
                var t = this.dcTrim;
                val = Math.round(+val);
                if (which === 'start') t.start = Math.max(0, Math.min(val, t.end - 1));
                else t.end = Math.min(t.dur, Math.max(val, t.start + 1));
                t.result = null;
                var v = this.dcTrimVideo();
                if (v) { try { v.pause(); v.currentTime = which === 'start' ? t.start : t.end; } catch (e) {} }
            },
            dcTrimHere: function (which) {
                var v = this.dcTrimVideo();
                if (!v || !isFinite(v.currentTime)) return;
                this.dcTrimSet(which, Math.floor(v.currentTime));
            },
            dcTrimPreview: function () {
                var v = this.dcTrimVideo();
                if (!v && this.dcNativeVideo()) { this.dcPlayNative(this.dcTrim.start * 1000, this.dcTrim.end * 1000); return; }
                if (!v) return;
                var self = this;
                try { v.currentTime = this.dcTrim.start; v.play(); } catch (e) {}
                var stop = function () {
                    if (!self.dcTrim.open || v.currentTime >= self.dcTrim.end) { v.pause(); v.removeEventListener('timeupdate', stop); }
                };
                v.addEventListener('timeupdate', stop);
            },
            dcFmtSec: function (s) {
                s = Math.max(0, Math.round(s || 0));
                return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
            },
            async dcTrimRun() {
                var f = this.dcPlayer.file;
                var t = this.dcTrim;
                if (!f || t.busy) return;
                var P = DcNet.plugin();
                if (!P || this.dcDemo) { this.dcShowToast(this.dcNoFeature('მოჭრა')); return; }
                // მოსაჭრელად ვიდეო ჯერ ტელეფონში უნდა იყოს
                var path = await this.dcDownload(f, true);
                if (!path) return;
                t.busy = true;
                this.dcBusy = 'ვჭრი ვიდეოს...';
                this.dcProgress = -1;
                try {
                    var r = await P.trim({ path: path, startMs: t.start * 1000, endMs: t.end * 1000, fileName: f.name });
                    var name = String(r.path).split('/').pop();
                    var clip = {
                        id: 'clip:' + r.path,
                        name: name,
                        path: r.path,
                        size: r.size || 0,
                        time: (f.time || 0) + (r.startMs || 0),
                        kind: 'video',
                        folder: 'clip',
                        mime: 'video/mp4',
                        source: f.id
                    };
                    this.dcClips = [clip].concat(this.dcClips.filter(function (c) { return c.id !== clip.id; }));
                    lsSet('octane_dc_clips', JSON.stringify(this.dcClips));
                    this.dcDownloads[clip.id] = r.path;
                    lsSet('octane_dc_downloads', JSON.stringify(this.dcDownloads));
                    this.dcDurations[clip.id] = Math.max(1, Math.round(((r.endMs || 0) - (r.startMs || 0)) / 1000));
                    lsSet('octane_dc_durations', JSON.stringify(this.dcDurations));

                    var notes = [];
                    var shift = Math.round((r.shiftMs || 0) / 1000);
                    if (shift >= 1) notes.push('მოჭრილი ნაწილი ' + shift + ' წამით ადრე იწყება, ვიდრე აირჩიე. ეს ნორმალურია - ასე ვიდეო ხარისხს არ კარგავს.');
                    if (r.audioDropped) notes.push('ამ კამერის ხმა მოჭრილ ვიდეოში ვერ ჩაჯდა, ამიტომ მოჭრილი ნაწილი უხმოდ შეინახა. სრულ ვიდეოში ხმა ისევ არის.');
                    t.result = { clip: clip, notes: notes };
                } catch (e) {
                    var m = e && e.message ? e.message : '';
                    this.dcShowToast(m.indexOf('VIDEO_FORMAT') >= 0 || m.indexOf('NO_VIDEO') >= 0
                        ? 'ამ ვიდეოს მოჭრა ვერ ხერხდება - კამერის ფორმატი არ არის მხარდაჭერილი.'
                        : 'მოჭრა ვერ მოხერხდა. სცადე თავიდან.');
                } finally {
                    t.busy = false;
                    this.dcBusy = '';
                }
            },
            dcOpenClip: function (c) {
                this.dcTrimClose();
                this.dcOpen(c);
            },
            dcAskDeleteClip: function (c) { this.dcConfirmClip = { open: true, file: c }; },
            dcConfirmClip: { open: false, file: null },
            async dcDoDeleteClip() {
                var c = this.dcConfirmClip.file;
                this.dcConfirmClip = { open: false, file: null };
                if (!c) return;
                // მოჭრილი ნაწილი ან ტელეფონში გადმოწერილი ასლი - იშლება მხოლოდ ტელეფონიდან
                var localPath = this.dcIsClip(c) ? c.path : this.dcDownloads[c.id];
                try { var P = DcNet.plugin(); if (P && localPath) await P.deleteLocal({ path: localPath }); } catch (e) {}
                this.dcClips = this.dcClips.filter(function (x) { return x.id !== c.id; });
                lsSet('octane_dc_clips', JSON.stringify(this.dcClips));
                delete this.dcDownloads[c.id];
                lsSet('octane_dc_downloads', JSON.stringify(this.dcDownloads));
                if (this.dcDlMeta[c.id]) {
                    var m = Object.assign({}, this.dcDlMeta); delete m[c.id]; this.dcDlMeta = m;
                    lsSet('octane_dc_dlmeta', JSON.stringify(this.dcDlMeta));
                }
                if (this.dcPlayer.open && this.dcPlayer.file && this.dcPlayer.file.id === c.id) this.dcClosePlayer();
                this.dcShowToast(this.dcIsClip(c) ? 'მოჭრილი ნაწილი წაიშალა ტელეფონიდან.' : 'წაიშალა ტელეფონიდან. კამერაზე ჩანაწერი დარჩა.');
            },
            dcIsLocal: function (f) { return !!(f && (f.local || this.dcIsClip(f))); },

            // ─────────── 💓 სესია და 💾 ბარათი ───────────
            dcStartHeartbeat: function () {
                var self = this;
                clearInterval(this.dcHbTimer);
                if (!this.dcAdapter.heartbeat || this.dcDemo) return;
                this.dcHbTimer = setInterval(function () {
                    if (!self.dcConnected) { clearInterval(self.dcHbTimer); return; }
                    self.dcAdapter.heartbeat(self.dcCtx()).catch(function () {});
                }, 5000);
            },
            async dcLoadSd() {
                if (!this.dcConnected || !this.dcAdapter.getSd) return;
                try { var sd = await this.dcAdapter.getSd(this.dcCtx()); this.dcSd = sd && sd.total ? sd : null; } catch (e) {}
            },
            dcSdUsedPct: function () { var s = this.dcSd; return s && s.total ? Math.min(100, Math.round((s.total - s.free) * 100 / s.total)) : 0; },
            dcFmtGb: function (b) { return (b / 1073741824).toFixed(1) + 'G'; },

            // ─────────── 📺 ცოცხალი ხედი (RTSP - ნატიური ფლეიერი) და ავარიული ჩაწერა ───────────
            async dcOpenLive() {
                var P = DcNet.plugin();
                if (!P || this.dcDemo || !P.openLive) { this.dcShowToast(this.dcNoFeature('ცოცხალი ხედი')); return; }
                try { await P.openLive({ url: this.dcAdapter.liveUrl(this.dcCtx().ip), title: this.dcSsid || 'ცოცხალი ხედი' }); }
                catch (e) { this.dcShowToast('ცოცხალი ხედი ვერ გაიხსნა.'); }
            },
            async dcEmergency() {
                if (!this.dcAdapter.emergency) return;
                try {
                    var ok = await this.dcAdapter.emergency(this.dcCtx());
                    this.dcShowToast(ok ? 'ავარიული ჩაწერა დაიწყო. ნახე გალერეაში → ავარიული.' : 'ბრძანება ვერ შესრულდა.');
                } catch (e) { this.dcShowToast('ბრძანება ვერ შესრულდა.'); }
            },

            // ─────────── ⚙️ კამერის პარამეტრები ───────────
            async dcLoadCam() {
                if (!this.dcConnected || !this.dcAdapter.listSettings) return;
                this.dcCam = { loading: true, loaded: false, error: '', list: [] };
                try {
                    var list = await this.dcAdapter.listSettings(this.dcCtx());
                    this.dcCam = { loading: false, loaded: true, error: list.length ? '' : 'კამერამ პარამეტრები არ დააბრუნა.', list: list };
                } catch (e) {
                    this.dcCam = { loading: false, loaded: false, error: 'პარამეტრების წაკითხვა ვერ მოხერხდა.', list: [] };
                }
            },
            dcCamLabel: function (it, v) { return this.dcAdapter.label ? this.dcAdapter.label(it.key, v) : v; },
            dcCamOn: function (it) { var u = String(it.value).toUpperCase(); return u === 'ON' || u === '1'; },
            async dcCamSet(it, v) {
                if (String(v) === String(it.value)) { this.dcPick = { open: false, item: null, busy: false }; return; }
                this.dcPick.busy = true;
                try {
                    var ok = await this.dcAdapter.setSetting(this.dcCtx(), it.key, v);
                    if (ok) {
                        it.value = v;
                        if (it.key === 'MEDIAMODE') this.dcInfo.res = v;
                        if (it.key === 'ENC_PAYLOAD_TYPE') this.dcInfo.codec = v;
                        this.dcShowToast('შენახულია: ' + it.title + ' - ' + this.dcCamLabel(it, v));
                    }
                    else this.dcShowToast('კამერამ ცვლილება არ მიიღო.');
                } catch (e) { this.dcShowToast('ცვლილება ვერ შეინახა. შეამოწმე კავშირი.'); }
                this.dcPick = { open: false, item: null, busy: false };
            },
            dcCamToggle: function (it) {
                var on = this.dcCamOn(it), opts = it.options.map(function (x) { return x.toUpperCase(); });
                var next = opts.indexOf('ON') >= 0 ? (on ? 'OFF' : 'ON') : (on ? '0' : '1');
                this.dcCamSet(it, next);
            },
            dcFormatAsk: function () { this.dcFormat = { open: true, step: 1, busy: false }; },
            async dcFormatDo() {
                if (this.dcFormat.step === 1) { this.dcFormat.step = 2; return; }
                this.dcFormat.busy = true;
                this.dcBusy = 'ბარათის ფორმატირება... ნუ გათიშავ კამერას';
                var ok = false;
                try { ok = await this.dcAdapter.formatSd(this.dcCtx()); } catch (e) {}
                this.dcBusy = '';
                this.dcFormat = { open: false, step: 1, busy: false };
                this.dcShowToast(ok ? 'ბარათი დაფორმატდა. ყველა ჩანაწერი წაიშალა.' : 'ფორმატირება ვერ დადასტურდა. შეამოწმე ბარათი კამერაზე.');
                this.dcFiles = [];
                this.dcSel = {};
                this.dcLoadSd();
            },

            // ─────────── 🗂️ ჩანართები: კამერა / გალერეა / პარამეტრები ───────────
            // GoLook-ის მსგავსად: გალერეასა და პარამეტრებში შესვლისას ჩაწერა ჩერდება,
            // კამერაზე დაბრუნებისას ისევ ირთვება და ცოცხალი ხედი თავისით იწყება.
            async dcOnTab(tab, old) {
                if (!this.dcConnected) {
                    // კამერის გარეშე გალერეაში მხოლოდ ტელეფონში შენახული ჩანს
                    if (tab === 'gallery') this.dcFolder = 'phone';
                    return;
                }
                if (tab === 'gallery') {
                    this.dcLiveStop();
                    await this.dcLoadFiles();
                } else if (tab === 'settings') {
                    this.dcLiveStop();
                    if (this.dcAdapter.listSettings && !this.dcCam.loaded && !this.dcCam.loading) {
                        try { await this.dcAdapter.enterPlayback(this.dcCtx()); } catch (e) {}
                        this.dcLoadCam();
                    }
                } else if (tab === 'camera') {
                    if (old === 'gallery' || old === 'settings') { try { await this.dcAdapter.enterMovie(this.dcCtx()); } catch (e) {} }
                    this.dcLiveStart();
                }
            },

            // ─────────── 📺 ცოცხალი ხედი ეკრანზევე (დაჭერის გარეშე) ───────────
            // HiDvr (RTSP): ნატიური ვიდეო ედება .dc-live-slot ბარათს. Novatek (MJPEG): <img> ბარათშივე.
            dcLiveDetail: '',             // iPhone: VLC-ის დიაგნოსტიკა
            dcLiveState: 'idle',          // idle | loading | playing | error | unavailable
            dcLiveOn: false,
            dcLiveRaf: 0,
            dcRawLog: [],
            dcLiveRect: function () {
                var el = document.querySelector('.dc-live-slot');
                if (!el || !el.offsetParent) return null;
                var r = el.getBoundingClientRect();
                return { x: r.left, y: r.top, w: r.width, h: r.height, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 };
            },
            // ბარათში ნაჩვენები წარწერა (ვიდეოს ქვეშ ჩანს, სანამ კადრი გამოჩნდება)
            dcLiveText: function () {
                if (this.dcConnecting) return 'ვუკავშირდები კამერას...';
                if (!this.dcConnected) return 'აქ გამოჩნდება კამერის ვიდეო';
                if (this.dcLiveState === 'error') return 'კამერა ვიდეოს ჯერ არ გადმოსცემს';
                if (this.dcLiveState === 'unavailable') return this.dcDemo ? 'საცდელი რეჟიმი: აქ კამერის ცოცხალი ვიდეო გამოჩნდება' : 'ცოცხალი ხედი ჩანს მხოლოდ ტელეფონის აპში';
                return 'ცოცხალ ხედს ვრთავ...';
            },
            dcLiveCovered: function () {
                return !!(this.dcSheet || this.dcPick.open || this.dcFormat.open || this.dcConfirm.open || this.dcConfirmClip.open || this.dcPlayer.open || this.dcTab !== 'camera');
            },
            async dcLiveStart() {
                if (!this.dcConnected || this.dcTab !== 'camera' || this.$store.octaneMode.screen !== 'dashcam') return;
                var ctx = this.dcCtx();
                if (this.dcAdapter.liveKind !== 'rtsp') {
                    // Novatek: MJPEG პირდაპირ <img>-ში
                    this.dcLiveError = false;
                    try { await this.dcAdapter.enterMovie(ctx); } catch (e) {}
                    this.dcLiveSrc = this.dcAdapter.liveUrl(ctx.ip) + '/?t=' + Date.now();
                    this.dcLiveState = 'playing';
                    return;
                }
                var P = DcNet.plugin();
                if (!P || this.dcDemo || !P.liveInlineStart) { this.dcLiveState = 'unavailable'; return; }
                await this.$nextTick();
                // ბარათი შეიძლება ჯერ არ იყოს დახატული (ნელი ტელეფონი) - 2 წამამდე ვცდით
                var r = this.dcLiveRect();
                for (var t = 0; t < 10 && (!r || !r.w); t++) {
                    await new Promise(function (res) { setTimeout(res, 200); });
                    if (!this.dcConnected || this.dcTab !== 'camera') return;
                    r = this.dcLiveRect();
                }
                if (!r || !r.w) { this.dcLiveState = 'error'; return; }
                this.dcLiveState = 'loading';
                this.dcLiveOn = true;
                try {
                    await P.liveInlineStart(Object.assign({ url: this.dcAdapter.liveUrl(ctx.ip) }, r));
                    this.dcLiveSync();
                } catch (e) { this.dcLiveOn = false; this.dcLiveState = 'error'; }
            },
            dcLiveStop: function () {
                this.dcLiveSrc = '';
                if (this.dcLiveState !== 'unavailable') this.dcLiveState = 'idle';
                if (!this.dcLiveOn) return;
                this.dcLiveOn = false;
                var P = DcNet.plugin();
                if (P && P.liveInlineStop) P.liveInlineStop().catch(function () {});
            },
            // ბარათის ადგილი შეიცვალა (გადახვევა) ან ფანჯარა გაიხსნა - ნატიური ვიდეო მივყვეთ / დავმალოთ
            dcLiveSync: function () {
                if (!this.dcLiveOn) return;
                var P = DcNet.plugin();
                if (!P || !P.liveInlineRect) return;
                var r = this.dcLiveRect();
                if (r) P.liveInlineRect(r).catch(function () {});
                P.liveInlineVisible({ visible: !!r && !this.dcLiveCovered() }).catch(function () {});
            },
            dcLiveSyncSoon: function () {
                var self = this;
                if (this.dcLiveRaf) return;
                this.dcLiveRaf = requestAnimationFrame(function () { self.dcLiveRaf = 0; self.dcLiveSync(); });
            },
            dcRetryLive: function () {
                this.dcLiveStop();
                this.dcLiveStart();
            },
            async dcCapture() {
                if (this.dcBusy) return;
                this.dcBusy = 'ფოტოს გადაღება...';
                try {
                    var ok = await this.dcAdapter.capture(this.dcCtx());
                    this.dcShowToast(ok ? 'ფოტო გადაღებულია. ნახე გალერეაში → ფოტო.' : 'ფოტო ვერ გადაიღო.');
                } catch (e) { this.dcShowToast('ფოტო ვერ გადაიღო.'); }
                finally { this.dcBusy = ''; if (this.dcAdapter.liveKind !== 'rtsp') this.dcRetryLive(); }
            },

            // ─────────── ⚙️ პარამეტრები ───────────
            dcSaveSettings: function () {
                this.dcSettings.ip = (this.dcSettings.ip || '').trim();   // ცარიელი = ავტომატურად
                lsSet('octane_dc_settings', JSON.stringify(this.dcSettings));
                this.dcShowToast('შენახულია.');
            },
            // ─── პარამეტრების რედაქტირება ფანჯარაში (ეკრანზე ველები აღარ ჩანს) ───
            dcEditOpen: function (field) {
                var F = {
                    password: { title: 'WiFi-ს პაროლი', hint: 'ჩვეულებრივ 12345678. თუ არ გახსოვს - კამერაზე reset ღილაკს 6 წამი დააჭირე.', placeholder: '12345678', mode: 'text' },
                    ssid: { title: 'WiFi-ს სახელი', hint: 'დატოვე ცარიელი - აპი თავად მოძებნის HiDvr_-ით დაწყებულ ქსელს.', placeholder: 'მაგ. HiDvr_15C628', mode: 'text' },
                    ip: { title: 'კამერის მისამართი', hint: 'დატოვე ცარიელი - აპი თავად მოძებნის. შეცვალე მხოლოდ საჭიროებისას.', placeholder: 'ავტომატურად', mode: 'decimal' }
                }[field];
                if (!F) return;
                this.dcEdit = Object.assign({ field: field, value: this.dcSettings[field] || '' }, F);
                this.dcSheet = 'edit';
            },
            dcEditSave: function () {
                var f = this.dcEdit.field;
                this.dcSettings[f] = f === 'password' ? String(this.dcEdit.value || '') : String(this.dcEdit.value || '').trim();
                this.dcSaveSettings();
                this.dcSheet = '';
            },
            get dcAdapterList() {
                var A = window.DC_ADAPTERS;
                return Object.keys(A).map(function (k) { return { key: k, name: A[k].name }; });
            },
            dcSetModel: function (key) {
                this.dcSettings.adapter = key;
                this.dcSaveSettings();
                this.dcSheet = '';
            },
            dcGuideConnect: function () {
                this.dcSheet = '';
                this.dcTab = 'camera';
                if (this.dcFolder === 'phone') this.dcFolder = 'normal';
                this.dcConnect();
            },
            // პარამეტრები ჯგუფებად (Samsung-ის პარამეტრების მსგავსად)
            get dcCamGroups() {
                var list = this.dcCam.list;
                return [
                    { id: 'rec', title: 'ჩაწერა' },
                    { id: 'safe', title: 'უსაფრთხოება' },
                    { id: 'park', title: 'პარკინგი', note: 'მუშაობს მხოლოდ მცველების ყუთიდან კვებისას' },
                    { id: 'cam', title: 'კამერა' }
                ].map(function (g) {
                    var items = list.filter(function (i) { return i.group === g.id; }).map(function (it) {
                        var o = it.options.map(function (x) { return String(x).toUpperCase(); });
                        var lvl = !it.toggle && o.indexOf('LOW') >= 0 && o.indexOf('HIGH') >= 0;
                        return { it: it, layout: it.toggle ? 'tile' : (lvl ? 'bars' : (it.title.length > 19 ? 'wide' : 'tile')) };
                    });
                    // ორსვეტიან ბადეში ცალი დარჩენილი ბარათი მთელ სიგანეზე გადადის
                    var run = 0;
                    items.forEach(function (x, i) {
                        if (x.layout === 'tile') { run++; var next = items[i + 1]; if ((!next || next.layout !== 'tile') && run % 2 === 1) x.layout = x.it.toggle ? 'tile-wide' : 'wide'; }
                        else run = 0;
                    });
                    return Object.assign({}, g, { items: items });
                }).filter(function (g) { return g.items.length; });
            },
            // დონე (დაბალი/საშუალო/მაღალი) ზოლებისთვის: n - რამდენი ზოლი, k - რამდენი ანთია
            dcLevel: function (it) {
                var o = it.options.map(function (x) { return String(x).toUpperCase(); }).filter(function (x) { return ['OFF', 'MUTE', 'NONE', '0'].indexOf(x) < 0; });
                return { n: o.length, k: o.indexOf(String(it.value).toUpperCase()) + 1 };
            },
            // ხატულის ფერი
            dcSetColor: function (key) {
                return 'c-' + ({
                    MEDIAMODE: 'blue', ENC_PAYLOAD_TYPE: 'indigo', Rec_Split_Time: 'teal', AUDIO: 'pink',
                    GSR_SENSITIVITY: 'red', MD_SENSITIVITY: 'orange', GSR_PARKING: 'purple', LOW_FPS_REC: 'teal',
                    LOW_FPS_REC_TIME: 'teal', LOW_POWER_PROTECT: 'green', VOLUME: 'orange', ANTIFLICKER: 'amber',
                    FLIP: 'blue', MIRROR: 'indigo', SCREEN_DORMANT: 'gray'
                }[key] || 'gray');
            },
            // პარამეტრის ხატულა
            dcSetIcon: function (key) {
                return '#' + ({
                    MEDIAMODE: 'i-dc-hd', ENC_PAYLOAD_TYPE: 'i-dc-film', AUDIO: 'i-dc-mic', Rec_Split_Time: 'i-clock',
                    GSR_SENSITIVITY: 'i-dc-shield', GSR_PARKING: 'i-dc-car', MD_SENSITIVITY: 'i-dc-eye', LOW_FPS_REC: 'i-dc-timer',
                    LOW_FPS_REC_TIME: 'i-dc-timer', LOW_POWER_PROTECT: 'i-dc-battery', SCREEN_DORMANT: 'i-moon', VOLUME: 'i-dc-volume',
                    ANTIFLICKER: 'i-sun', FLIP: 'i-refresh', MIRROR: 'i-dc-swap'
                }[key] || 'i-gear');
            },
            dcResetSettings: function () {
                this.dcSettings = { adapter: window.DC_DEFAULT_ADAPTER, ip: '', ssid: '', password: '12345678' };
                this.dcSaveSettings();
            },

            // ─────────── 🩺 კამერის შემოწმება (დიაგნოსტიკა) ───────────
            // სათითაოდ ცდის მისამართებს და აჩვენებს, ვინ რა უპასუხა - ეკრანის სურათისთვის.
            // ⚠️ მხოლოდ კითხვის (GET) მოთხოვნებია, კამერაზე არაფერს ცვლის.
            async dcRunDiag() {
                if (this.dcDiag.running) return;
                var P = DcNet.plugin();
                this.dcDiag = { running: true, done: false, wifi: '', phoneIp: '', gateway: '', rows: [] };
                if (P && !this.dcDemo) {
                    try { await P.bindToWifi(); } catch (e) {}
                    try {
                        var w = await P.wifiInfo();
                        this.dcDiag.wifi = (w && w.ssid) || '';
                        this.dcDiag.phoneIp = (w && w.ip) || '';
                        this.dcDiag.gateway = (w && w.gateway) || '';
                    } catch (e) {}
                } else if (this.dcDemo) {
                    this.dcDiag.wifi = 'HiDvr_DEMO'; this.dcDiag.phoneIp = '192.168.1.100'; this.dcDiag.gateway = '192.168.1.254';
                }
                var ips = HIDVR.ips.slice();
                var gw = this.dcDiag.gateway;
                if (gw && ips.indexOf(gw) < 0) ips.unshift(gw);
                var probes = [
                    { label: 'მთავარი გვერდი', path: '/' },
                    { label: 'Novatek-ის ტიპის შემოწმება', path: '/?custom=1&cmd=3016' },
                    { label: 'HiSilicon-ის ტიპის შემოწმება', path: '/cgi-bin/hisnet/getdeviceattr.cgi' }
                ];
                var snip = function (t) { return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 240); };
                for (var i = 0; i < ips.length; i++) {
                    var ip = ips[i];
                    this.dcDiag.rows.push({ ip: ip, state: 'run', lines: [] });
                    var row = this.dcDiag.rows[this.dcDiag.rows.length - 1];
                    var res = await Promise.all(probes.map(function (p) {
                        return DcNet.probe('http://' + ip + p.path, 3000).then(function (r) {
                            return { label: p.label, path: p.path, status: r ? r.status : 0, text: r ? snip(r.data) : '' };
                        });
                    }));
                    row.lines = res;
                    row.state = res.some(function (r) { return r.status > 0; }) ? 'ok' : 'none';
                }
                this.dcDiag.running = false;
                this.dcDiag.done = true;
            },
            dcDiagStatus: function (s) {
                if (!s) return 'არ უპასუხა';
                if (s >= 200 && s < 300) return 'უპასუხა (' + s + ')';
                if (s === 404) return 'სერვერი არის, ეს მისამართი არა (404)';
                return 'უპასუხა შეცდომით (' + s + ')';
            },

            // ─────────── 🗓️ თარიღებით დაჯგუფება ───────────
            get dcGroups() {
                var out = [], map = {}, self = this;
                this.dcShown.forEach(function (f) {
                    var d = new Date(f.time || 0);
                    var k = f.time ? d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() : 'x';
                    if (!map[k]) { map[k] = { key: k, label: self.dcDayLabel(f.time), items: [] }; out.push(map[k]); }
                    map[k].items.push(f);
                });
                return out;
            },
            dcDayLabel: function (ts) {
                if (!ts) return 'თარიღი უცნობია';
                var d = new Date(ts), now = new Date();
                var day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
                var diff = Math.round((day(now) - day(d)) / 86400000);
                if (diff === 0) return 'დღეს';
                if (diff === 1) return 'გუშინ';
                var M = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
                var W = ['კვირა', 'ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი'];
                return d.getDate() + ' ' + M[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '') + ', ' + W[d.getDay()];
            },

            // ─────────── ☑️ მრავალჯერადი არჩევა (გრძელი დაჭერა) ───────────
            get dcSelCount() { return Object.keys(this.dcSel).length; },
            get dcSelFiles() { var s = this.dcSel; return this.dcFiles.filter(function (f) { return s[f.id]; }); },
            dcIsSel: function (f) { return !!this.dcSel[f.id]; },
            dcToggleSel: function (f) {
                var s = Object.assign({}, this.dcSel);
                if (s[f.id]) delete s[f.id]; else s[f.id] = true;
                this.dcSel = s;
            },
            dcSelAll: function () {
                var s = {};
                this.dcShown.forEach(function (f) { s[f.id] = true; });
                this.dcSel = s;
            },
            dcSelClear: function () { this.dcSel = {}; },
            dcPressStart: function (f) {
                var self = this;
                this.dcPressFired = false;
                clearTimeout(this.dcPressTimer);
                this.dcPressTimer = setTimeout(function () {
                    self.dcPressFired = true;
                    self.dcToggleSel(f);
                    try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) {}
                }, 480);
            },
            dcPressCancel: function () { clearTimeout(this.dcPressTimer); },
            dcTap: function (f) {
                if (this.dcPressFired) { this.dcPressFired = false; return; }
                if (this.dcSelCount) this.dcToggleSel(f);
                else this.dcOpen(f);
            },
            async dcBulkDownload() {
                var files = this.dcSelFiles, n = files.length, done = 0;
                if (!DcNet.plugin() || this.dcDemo) { this.dcShowToast(this.dcNoFeature('გადმოწერა')); return; }
                for (var i = 0; i < n; i++) {
                    this.dcBulkText = (i + 1) + ' / ' + n;
                    if (await this.dcSaveToGallery(files[i], true)) done++;
                }
                this.dcBulkText = '';
                this.dcSel = {};
                this.dcShowToast('შენახულია ტელეფონის გალერეაში: ' + done + ' / ' + n);
            },
            async dcBulkShare() {
                var files = this.dcSelFiles, paths = [];
                if (!DcNet.plugin() || this.dcDemo) { this.dcShowToast(this.dcNoFeature('გაგზავნა')); return; }
                for (var i = 0; i < files.length; i++) {
                    this.dcBulkText = (i + 1) + ' / ' + files.length;
                    var p = await this.dcDownload(files[i], true);
                    if (p) paths.push(p);
                }
                this.dcBulkText = '';
                if (!paths.length) return;
                var allPhoto = files.every(function (f) { return f.kind === 'photo'; });
                var allVideo = files.every(function (f) { return f.kind === 'video'; });
                try {
                    if (paths.length === 1) await DcNet.plugin().share({ path: paths[0], mime: files[0].mime, title: 'გაზიარება' });
                    else await DcNet.plugin().shareMany({ paths: paths, mime: allPhoto ? 'image/*' : (allVideo ? 'video/*' : '*/*'), title: 'გაზიარება' });
                    this.dcSel = {};
                } catch (e) { this.dcShowToast('გაზიარება ვერ მოხერხდა.'); }
            },
            dcBulkAskDelete: function () { this.dcConfirm = { open: true, file: null, bulk: true }; },
            async dcDoBulkDelete() {
                var files = this.dcSelFiles, n = files.length, ok = 0;
                this.dcConfirm = { open: false, file: null };
                this.dcBusy = 'წაშლა...';
                for (var i = 0; i < n; i++) {
                    this.dcBulkText = (i + 1) + ' / ' + n;
                    try {
                        if (await this.dcAdapter.deleteFile(this.dcCtx(), files[i])) {
                            ok++;
                            var id = files[i].id;
                            this.dcFiles = this.dcFiles.filter(function (x) { return x.id !== id; });
                        }
                    } catch (e) {}
                }
                this.dcBusy = '';
                this.dcBulkText = '';
                this.dcSel = {};
                this.dcLoadSd();
                this.dcShowToast(ok === n ? 'წაიშალა კამერიდან: ' + ok : 'წაიშალა ' + ok + ' / ' + n + '. დაბლოკილი ჩანაწერები ზოგ კამერაზე მხოლოდ კამერიდანვე იშლება.');
            },

            // ─────────── ფორმატირება ───────────
            dcFmtDate: function (ts) {
                if (!ts) return '-';
                var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
                return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
            },
            dcFmtTime: function (ts) {
                if (!ts) return '';
                var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
                return p(d.getHours()) + ':' + p(d.getMinutes());
            },
            dcFmtTimeS: function (ts) {
                if (!ts) return '';
                var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
                return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
            },
            dcFmtSize: function (b) {
                if (!b) return '';
                if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
                if (b >= 1048576) return Math.round(b / 1048576) + ' MB';
                return Math.max(1, Math.round(b / 1024)) + ' KB';
            },
            dcFmtDur: function (f) {
                var s = f && this.dcDurations[f.id];
                if (!s) return '';
                return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
            }
        };
    };

    // ═══════════ ◀️ ტელეფონის უკან ღილაკი ═══════════
    // MainActivity იძახებს: true - აპმა თავად დახურა ფანჯარა/გვერდი; false - აპი ჩვეულებრივად იხურება.
    window.octaneBack = function () {
        try {
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                (document.exitFullscreen || document.webkitExitFullscreen).call(document);
                return true;
            }
            var A = window.Alpine;
            if (!A) return false;
            var st = A.store('octaneMode');
            if (st.screen === 'dashcam') {
                var el = document.querySelector('.dc-app');
                var d = el && A.$data(el);
                if (d) {
                    if (d.dcTrim.open) { if (!d.dcTrim.busy) d.dcTrimClose(); return true; }
                    if (d.dcConfirm.open) { d.dcConfirm = { open: false, file: null }; return true; }
                    if (d.dcConfirmClip.open) { d.dcConfirmClip = { open: false, file: null }; return true; }
                    if (d.dcFormat.open) { if (!d.dcFormat.busy) d.dcFormat = { open: false, step: 1, busy: false }; return true; }
                    if (d.dcPick.open) { if (!d.dcPick.busy) d.dcPick = { open: false, item: null, busy: false }; return true; }
                    if (d.dcPlayer.open) { d.dcClosePlayer(); return true; }
                    if (d.dcSheet) { d.dcSheet = ''; return true; }
                    if (d.dcSelCount) { d.dcSel = {}; return true; }
                    if (d.dcTab !== 'camera') { d.dcTab = 'camera'; return true; }
                }
                st.go('choose');
                return true;
            }
            if (st.screen === 'choose') {
                if (st.step !== 'pick') { st.step = 'pick'; return true; }
                return false;
            }
            // OBD: ღია ფანჯრების დახურვა (სკანირების/წაშლის პროცესს არ ვწყვეტთ)
            var root = document.getElementById('diagnostic-app');
            var o = root && A.$data(root);
            if (o) {
                if (o.scanAnim && o.scanAnim.open) { if (o.scanAnim.state !== 'run') o.scanAnim.open = false; return true; }
                if (o.clearAnim && o.clearAnim.open) { if (o.clearAnim.state !== 'run') o.clearAnim.open = false; return true; }
                if (o.aiModalOpen) { o.aiModalOpen = false; return true; }
                if (o.showClearConfirmModal) { o.showClearConfirmModal = false; return true; }
                if (o.guideOpen) { o.closeGuide(); return true; }
                if (o.quickOpen) { o.quickOpen = false; return true; }
                if (o.activeTab === 'ai_mechanic') { o.activeTab = 'errors'; return true; }
            }
            if (!(window.OCTANE_FLAGS && window.OCTANE_FLAGS.showDashcam === false)) { st.go('choose'); return true; }
            return false;
        } catch (e) {
            return false;
        }
    };
})();
