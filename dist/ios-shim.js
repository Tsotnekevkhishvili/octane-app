/* ═══════════ 🍎 Octane App - iPhone-ის ფენა ═══════════
   მუშაობს მხოლოდ iPhone-ზე (Capacitor.getPlatform() === 'ios'). ანდროიდზე და ბრაუზერში არაფერს აკეთებს.

   ანდროიდზე OBD სკანერთან TCP კავშირს cordova-plugin-chrome-apps-sockets-tcp აკეთებს (window.chrome.sockets.tcp).
   iPhone-ზე იგივე API-ს ვქმნით ნატიურ ObdTcp პლაგინზე (native/octane-ios-native), ამიტომ index.html-ის
   OBD ლოგიკა (sendELMCommand, connectWifiOBD...) ორივეზე ერთნაირია და არ იცვლება. */
(function () {
    var C = window.Capacitor;
    if (!C || typeof C.getPlatform !== 'function' || C.getPlatform() !== 'ios') return;
    document.documentElement.classList.add('ios');

    var T = C.Plugins && C.Plugins.ObdTcp;
    if (!T) return;

    var listeners = [];
    var toB64 = function (buf) {
        var b = new Uint8Array(buf), s = '';
        for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        return btoa(s);
    };
    var fromB64 = function (str) {
        var s = atob(str), b = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
        return b.buffer;
    };
    T.addListener('data', function (e) {
        if (!e) return;
        var info = { socketId: e.socketId, data: fromB64(e.data || '') };
        listeners.slice().forEach(function (f) { try { f(info); } catch (x) {} });
    });

    window.chrome = window.chrome || {};
    window.chrome.sockets = window.chrome.sockets || {};
    window.chrome.sockets.tcp = {
        create: function (props, cb) {
            T.create().then(function (r) { cb && cb({ socketId: r.socketId }); }).catch(function () { cb && cb({ socketId: 0 }); });
        },
        // cb(0) - დაკავშირდა; უარყოფითი - შეცდომა (როგორც Chrome Apps API-ში)
        connect: function (socketId, host, port, cb) {
            T.connect({ socketId: socketId, host: host, port: port, timeout: 8 })
                .then(function () { cb && cb(0); })
                .catch(function () { cb && cb(-1); });
        },
        send: function (socketId, data, cb) {
            T.send({ socketId: socketId, data: toB64(data) })
                .then(function (r) { cb && cb({ resultCode: 0, bytesSent: r && r.bytesSent }); })
                .catch(function () { cb && cb({ resultCode: -1 }); });
        },
        close: function (socketId, cb) {
            T.close({ socketId: socketId }).then(function () { cb && cb(); }).catch(function () { cb && cb(); });
        },
        disconnect: function (socketId, cb) { this.close(socketId, cb); },
        onReceive: {
            addListener: function (f) { listeners.push(f); },
            removeListener: function (f) { var i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }
        },
        onReceiveError: { addListener: function () {}, removeListener: function () {} }
    };
})();
