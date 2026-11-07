import Foundation
import UIKit
import Capacitor
import NetworkExtension
import AVFoundation
import AVKit
import Photos
import MobileVLCKit

/// ეკრანის მობრუნება: აპი მხოლოდ ვერტიკალურია, ვიდეოს ყურებისას - ნებისმიერი მიმართულებით.
/// AppDelegate-ის application(_:supportedInterfaceOrientationsFor:) ამას კითხულობს.
@objc public class OctaneOrientation: NSObject {
    @objc public static var allowAll = false
    static func set(_ all: Bool) {
        DispatchQueue.main.async {
            allowAll = all
            if #available(iOS 16.0, *) {
                for scene in UIApplication.shared.connectedScenes {
                    guard let ws = scene as? UIWindowScene else { continue }
                    ws.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
                    if !all { ws.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { _ in } }
                }
            } else if !all {
                UIDevice.current.setValue(UIInterfaceOrientation.portrait.rawValue, forKey: "orientation")
                UIViewController.attemptRotationToDeviceOrientation()
            }
        }
    }
}

/**
 * Octane App (iPhone) — ვიდეორეგისტრატორის WiFi და ფაილები.
 * ანდროიდის DashcamWifiPlugin-ის იგივე JS ინტერფეისი (dist/dashcam.js ორივეზე ერთნაირად მუშაობს).
 * ცოცხალი ხედი (RTSP) - MobileVLCKit; ჩანაწერები - AVPlayer (iPhone 1296P-ს თავისით ხსნის).
 */
@objc(DashcamWifiPlugin)
public class DashcamWifiPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDownloadDelegate {
    public let identifier = "DashcamWifiPlugin"
    public let jsName = "DashcamWifi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bindToWifi", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wifiInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteLocal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveToGallery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "probe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trim", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareMany", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setOrientation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openLive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "liveInlineStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "liveInlineRect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "liveInlineVisible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "liveInlineStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTheme", returnType: CAPPluginReturnPromise)
    ]

    // ═══════════ 📶 WiFi ═══════════

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": true])
    }

    @objc func connect(_ call: CAPPluginCall) {
        let ssid = call.getString("ssid", "").trimmingCharacters(in: .whitespaces)
        let prefix = call.getString("prefix", "")
        let password = call.getString("password", "")
        let cfg: NEHotspotConfiguration
        if !ssid.isEmpty {
            cfg = password.count >= 8 ? NEHotspotConfiguration(ssid: ssid, passphrase: password, isWEP: false) : NEHotspotConfiguration(ssid: ssid)
        } else if !prefix.isEmpty {
            // მაგ. „HiDvr_“ → HiDvr_15C628 ... (ზუსტი სახელის ცოდნა არ სჭირდება)
            cfg = password.count >= 8 ? NEHotspotConfiguration(ssidPrefix: prefix, passphrase: password, isWEP: false) : NEHotspotConfiguration(ssidPrefix: prefix)
        } else {
            call.reject("NO_SSID")
            return
        }
        cfg.joinOnce = false
        NEHotspotConfigurationManager.shared.apply(cfg) { error in
            if let e = error as NSError?, e.code != NEHotspotConfigurationError.alreadyAssociated.rawValue {
                call.reject("UNAVAILABLE: \(e.localizedDescription)")
                return
            }
            // WiFi-ზე გადასვლას iPhone-ს 1-2 წამი სჭირდება
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                self.currentSsid { s in call.resolve(["connected": true, "ssid": s]) }
            }
        }
    }

    /// iPhone თავად აგზავნის ლოკალურ (192.168.x) მოთხოვნებს WiFi-ით - „მიბმა“ საჭირო არ არის
    @objc func bindToWifi(_ call: CAPPluginCall) {
        call.resolve(["connected": true])
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.stopInline() }
        call.resolve()
    }

    private func currentSsid(_ done: @escaping (String) -> Void) {
        if #available(iOS 14.0, *) {
            NEHotspotNetwork.fetchCurrent { net in done(net?.ssid ?? "") }
        } else {
            done("")
        }
    }

    private func wifiIp() -> String {
        var address = ""
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return "" }
        defer { freeifaddrs(ifaddr) }
        var ptr: UnsafeMutablePointer<ifaddrs>? = first
        while let p = ptr {
            let iface = p.pointee
            if iface.ifa_addr.pointee.sa_family == UInt8(AF_INET), String(cString: iface.ifa_name) == "en0" {
                var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                getnameinfo(iface.ifa_addr, socklen_t(iface.ifa_addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
                address = String(cString: host)
            }
            ptr = iface.ifa_next
        }
        return address
    }

    @objc func wifiInfo(_ call: CAPPluginCall) {
        let ip = wifiIp()
        currentSsid { s in call.resolve(["ssid": s, "ip": ip, "gateway": ""]) }
    }

    // ═══════════ 🌐 HTTP ═══════════

    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.default
        c.allowsCellularAccess = false          // კამერა მხოლოდ WiFi-ზეა
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    @objc func request(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else { call.reject("NO_URL"); return }
        var req = URLRequest(url: url)
        req.timeoutInterval = Double(call.getInt("timeout", 6000)) / 1000.0
        session.dataTask(with: req) { data, resp, error in
            if let e = error { call.reject("REQUEST_FAILED: \(e.localizedDescription)"); return }
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let text = data.flatMap { String(data: $0, encoding: .utf8) ?? String(data: $0, encoding: .isoLatin1) } ?? ""
            call.resolve(["status": status, "data": text])
        }.resume()
    }

    // ═══════════ ⬇️ გადმოწერა ═══════════

    private func downloadsDir() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent("dashcam", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private static func safeName(_ n: String?) -> String {
        var name = (n ?? "").isEmpty ? "video_\(Int(Date().timeIntervalSince1970)).mp4" : n!
        name = name.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression)
        return name
    }

    private var dlSession: URLSession?
    private var dlCalls: [Int: (CAPPluginCall, URL, String)] = [:]
    private var dlLastNotify: [Int: Date] = [:]

    @objc func download(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else { call.reject("NO_URL"); return }
        let fileName = DashcamWifiPlugin.safeName(call.getString("fileName"))
        if dlSession == nil {
            let c = URLSessionConfiguration.default
            c.allowsCellularAccess = false
            c.timeoutIntervalForRequest = 20
            dlSession = URLSession(configuration: c, delegate: self, delegateQueue: nil)
        }
        let task = dlSession!.downloadTask(with: url)
        dlCalls[task.taskIdentifier] = (call, downloadsDir().appendingPathComponent(fileName), fileName)
        task.resume()
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let id = downloadTask.taskIdentifier
        let now = Date()
        if let last = dlLastNotify[id], now.timeIntervalSince(last) < 0.3 { return }
        dlLastNotify[id] = now
        notifyListeners("downloadProgress", data: ["fileName": dlCalls[id]?.2 ?? "", "loaded": totalBytesWritten, "total": totalBytesExpectedToWrite])
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let entry = dlCalls[downloadTask.taskIdentifier] else { return }
        let call = entry.0, out = entry.1
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 200
        if status >= 400 { call.reject("DOWNLOAD_FAILED: HTTP \(status)"); dlCalls[downloadTask.taskIdentifier] = nil; return }
        do {
            try? FileManager.default.removeItem(at: out)
            try FileManager.default.moveItem(at: location, to: out)
            // კამერის ვიდეოში ცარიელი კადრებია - iPhone-ის ფლეერი/გალერეა მათზე ჩერდება
            if out.pathExtension.lowercased() == "mp4" { OctaneMp4Fix.fixInPlace(out) }
            let size = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int64) ?? 0
            call.resolve(["path": out.path, "size": size])
        } catch {
            call.reject("DOWNLOAD_FAILED: \(error.localizedDescription)")
        }
        dlCalls[downloadTask.taskIdentifier] = nil
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let e = error, let entry = dlCalls[task.taskIdentifier] else { return }
        entry.0.reject("DOWNLOAD_FAILED: \(e.localizedDescription)")
        dlCalls[task.taskIdentifier] = nil
    }

    @objc func deleteLocal(_ call: CAPPluginCall) {
        if let p = call.getString("path"), p.hasPrefix(downloadsDir().path) {
            try? FileManager.default.removeItem(atPath: p)
        }
        call.resolve()
    }

    // ═══════════ 🖼️ გალერეა (Photos) ═══════════

    @objc func saveToGallery(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), FileManager.default.fileExists(atPath: path) else { call.reject("NO_FILE"); return }
        let isImage = call.getString("mime", "video/mp4").hasPrefix("image/")
        let url = URL(fileURLWithPath: path)
        if !isImage { OctaneMp4Fix.fixInPlace(url) }   // ძველად გადმოწერილიც გასწორდეს
        let save = {
            PHPhotoLibrary.shared().performChanges({
                if isImage { PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: url) }
                else { PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url) }
            }) { ok, error in
                if ok { call.resolve() } else { call.reject("GALLERY_FAILED: \(error?.localizedDescription ?? "")") }
            }
        }
        if #available(iOS 14, *) {
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { st in
                if st == .authorized || st == .limited { save() } else { call.reject("PERMISSION_DENIED") }
            }
        } else {
            PHPhotoLibrary.requestAuthorization { st in
                if st == .authorized { save() } else { call.reject("PERMISSION_DENIED") }
            }
        }
    }

    // ═══════════ 🎞️ ვიდეოს ინფორმაცია / ყურება / მოჭრა ═══════════

    @objc func probe(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { call.reject("NO_FILE"); return }
        let asset = AVURLAsset(url: URL(fileURLWithPath: path))
        let dur = CMTimeGetSeconds(asset.duration)
        var w = 0, h = 0
        if let t = asset.tracks(withMediaType: .video).first {
            let size = t.naturalSize.applying(t.preferredTransform)
            w = Int(abs(size.width)); h = Int(abs(size.height))
        }
        if !dur.isFinite || dur <= 0 { call.reject("PROBE_FAILED"); return }
        call.resolve(["mime": "video/mp4", "width": w, "height": h, "durationMs": Int(dur * 1000), "phoneCanPlay": true])
    }

    @objc func openVideo(_ call: CAPPluginCall) {
        guard let s = call.getString("url") ?? call.getString("path") else { call.reject("NO_URL"); return }
        let url = s.hasPrefix("/") ? URL(fileURLWithPath: s) : URL(string: s)
        guard let u = url else { call.reject("NO_URL"); return }
        let startMs = call.getInt("startMs", 0)
        let endMs = call.getInt("endMs", -1)
        let title = call.getString("title", "")
        // ტელეფონში გადმოწერილი ფაილი უკვე გასწორებულია (ცარიელი კადრები ამოღებულია) - Photos-ის მსგავსად
        // iPhone-ის ჩაშენებული ფლეერით ვუკრავთ. ძველად გადმოწერილიც ახლა გასწორდება.
        if u.isFileURL { OctaneMp4Fix.fixInPlace(u) }
        DispatchQueue.main.async {
            self.stopInline()
            if u.isFileURL {
                let player = AVPlayer(url: u)
                let vc = OctanePlayerViewController()
                vc.player = player
                vc.modalPresentationStyle = .fullScreen
                if startMs > 0 { player.seek(to: CMTime(value: CMTimeValue(startMs), timescale: 1000)) }
                if endMs > 0 {
                    vc.boundaryToken = player.addBoundaryTimeObserver(forTimes: [NSValue(time: CMTime(value: CMTimeValue(endMs), timescale: 1000))], queue: .main) { [weak player] in player?.pause() }
                }
                OctaneOrientation.set(true)
                self.bridge?.viewController?.present(vc, animated: true) { player.play() }
            } else {
                // პირდაპირ კამერიდან (გაუსწორებელი ფაილი) - VLC, პროგრამული დეკოდერით
                let vc = OctaneFilePlayerViewController(url: u, title: title, startMs: startMs, endMs: endMs)
                vc.modalPresentationStyle = .fullScreen
                OctaneOrientation.set(true)
                self.bridge?.viewController?.present(vc, animated: true)
            }
            call.resolve()
        }
    }

    @objc func trim(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { call.reject("NO_FILE"); return }
        let startMs = call.getInt("startMs", 0)
        let endMs = call.getInt("endMs", 0)
        if endMs <= startMs { call.reject("BAD_RANGE"); return }
        var base = DashcamWifiPlugin.safeName(call.getString("fileName", URL(fileURLWithPath: path).lastPathComponent))
        if let dot = base.lastIndex(of: ".") { base = String(base[..<dot]) }
        let out = downloadsDir().appendingPathComponent("\(base)_\(startMs / 1000)-\(endMs / 1000)s.mp4")
        try? FileManager.default.removeItem(at: out)
        let asset = AVURLAsset(url: URL(fileURLWithPath: path))
        guard let ex = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else { call.reject("VIDEO_FORMAT"); return }
        ex.outputURL = out
        ex.outputFileType = .mp4
        ex.timeRange = CMTimeRange(start: CMTime(value: CMTimeValue(startMs), timescale: 1000), end: CMTime(value: CMTimeValue(endMs), timescale: 1000))
        ex.exportAsynchronously {
            if ex.status == .completed {
                let size = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int64) ?? 0
                call.resolve(["path": out.path, "startMs": startMs, "endMs": endMs, "shiftMs": 0, "audioDropped": false, "size": size])
            } else {
                call.reject("TRIM_FAILED: \(ex.error?.localizedDescription ?? "")")
            }
        }
    }

    // ═══════════ 📤 გაგზავნა ═══════════

    private func presentShare(_ urls: [URL], _ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("NO_VIEW"); return }
            let a = UIActivityViewController(activityItems: urls, applicationActivities: nil)
            a.popoverPresentationController?.sourceView = vc.view
            a.popoverPresentationController?.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.maxY - 40, width: 1, height: 1)
            vc.present(a, animated: true)
            call.resolve()
        }
    }

    @objc func share(_ call: CAPPluginCall) {
        guard let p = call.getString("path"), FileManager.default.fileExists(atPath: p) else { call.reject("NO_FILE"); return }
        presentShare([URL(fileURLWithPath: p)], call)
    }

    @objc func shareMany(_ call: CAPPluginCall) {
        let paths = (call.getArray("paths", String.self) ?? []).filter { FileManager.default.fileExists(atPath: $0) }
        if paths.isEmpty { call.reject("NO_FILE"); return }
        presentShare(paths.map { URL(fileURLWithPath: $0) }, call)
    }

    @objc func setOrientation(_ call: CAPPluginCall) {
        OctaneOrientation.set(call.getString("mode", "portrait") == "auto")
        call.resolve()
    }

    // ═══════════ 📺 ცოცხალი ხედი (RTSP, VLC) ═══════════

    @objc func openLive(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let u = URL(string: s) else { call.reject("NO_URL"); return }
        let title = call.getString("title", "")
        DispatchQueue.main.async {
            self.stopInline()   // კამერა ერთდროულად ერთ ნაკადს აძლევს
            let vc = OctaneLiveViewController(url: u, title: title)
            vc.modalPresentationStyle = .fullScreen
            OctaneOrientation.set(true)
            self.bridge?.viewController?.present(vc, animated: true)
            call.resolve()
        }
    }

    private var liveView: OctaneRtspView?
    private var liveUrl: URL?
    private var liveRect = CGRect.zero
    private var liveRadius: CGFloat = 0
    private var liveWanted = false
    private var liveShown = true
    private var liveRetries = 0
    private var liveFirstFrame = false
    private var liveRunning = false
    private var liveGen = 0
    private var liveTimer: Timer?
    private var liveLastError = ""

    private func readRect(_ call: CAPPluginCall) {
        liveRect = CGRect(x: call.getDouble("x", Double(liveRect.minX)), y: call.getDouble("y", Double(liveRect.minY)),
                          width: call.getDouble("w", Double(liveRect.width)), height: call.getDouble("h", Double(liveRect.height)))
        liveRadius = CGFloat(call.getDouble("radius", Double(liveRadius)))
    }

    private func applyRect() {
        guard let v = liveView, let wv = bridge?.webView else { return }
        // WebView-ის CSS px = iOS point; ბარათი ხილული არის (viewport) კოორდინატებშია -
        // viewport იწყება WebView-ის კიდეს + ზედა/გვერდითი დაშორების (notch, status bar) შემდეგ
        let inset = wv.scrollView.adjustedContentInset
        v.frame = liveRect.offsetBy(dx: wv.frame.minX + inset.left, dy: wv.frame.minY + inset.top)
        v.layer.cornerRadius = liveRadius
        v.isHidden = !liveShown || !liveFirstFrame
    }

    private func liveState(_ s: String) {
        notifyListeners("liveState", data: ["state": s, "detail": liveDetail()])
    }

    // 🔎 დიაგნოსტიკა: რომელ ეტაპზეა კამერასთან საუბარი და რამდენი მოვიდა (ბარათში პატარა ტექსტად ჩანს)
    private func liveDetail() -> String {
        let st = liveView?.stats ?? "-"
        let err = liveLastError.isEmpty ? "" : " · წინა: \(liveLastError)"
        return "ცდა \(liveRetries + 1)/7 · \(st)\(err)"
    }

    private func createLivePlayer() {
        releaseLivePlayer()
        guard let u = liveUrl, let v = liveView else { return }
        liveFirstFrame = false
        v.isHidden = true
        liveGen += 1
        let gen = liveGen
        v.onFirstFrame = { [weak self] in
            guard let self = self, self.liveGen == gen else { return }
            self.markFirstFrame()
        }
        v.onError = { [weak self] msg in
            guard let self = self, self.liveGen == gen else { return }
            self.liveLastError = msg
            self.liveFailed()
        }
        liveRunning = true
        v.start(u)
        liveState("loading")
        // დიაგნოსტიკის განახლება წამში ერთხელ, სანამ სურათი გამოჩნდება
        liveTimer?.invalidate()
        liveTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] t in
            guard let self = self, self.liveGen == gen, self.liveRunning, !self.liveFirstFrame else { t.invalidate(); return }
            self.liveState("loading")
        }
    }

    private func markFirstFrame() {
        if liveFirstFrame || !liveRunning { return }
        liveFirstFrame = true
        liveRetries = 0
        liveLastError = ""
        liveTimer?.invalidate()
        liveTimer = nil
        applyRect()
        liveState("playing")
    }

    private func releaseLivePlayer() {
        liveTimer?.invalidate()
        liveTimer = nil
        liveGen += 1
        liveRunning = false
        liveView?.stop()
        liveView?.isHidden = true
    }

    private func liveFailed() {
        if liveWanted && liveRetries < 6 {
            liveRetries += 1
            releaseLivePlayer()
            liveState("loading")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { if self.liveWanted && !self.liveRunning { self.createLivePlayer() } }
        } else {
            releaseLivePlayer()
            liveState("error")
        }
    }

    private func stopInline() {
        liveWanted = false
        releaseLivePlayer()
    }

    @objc func liveInlineStart(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let u = URL(string: s) else { call.reject("NO_URL"); return }
        readRect(call)
        DispatchQueue.main.async {
            if self.liveView == nil, let wv = self.bridge?.webView, let parent = wv.superview {
                let v = OctaneRtspView()
                v.fill = true
                v.backgroundColor = .black
                v.clipsToBounds = true
                v.isUserInteractionEnabled = false   // შეხება ვებ-გვერდზე გადადის
                parent.addSubview(v)
                self.liveView = v
            }
            self.liveUrl = u
            self.liveWanted = true
            self.liveShown = true
            self.liveRetries = 0
            self.liveLastError = ""
            self.applyRect()
            self.createLivePlayer()
            call.resolve()
        }
    }

    @objc func liveInlineRect(_ call: CAPPluginCall) {
        readRect(call)
        DispatchQueue.main.async { self.applyRect(); call.resolve() }
    }

    @objc func liveInlineVisible(_ call: CAPPluginCall) {
        let vis = call.getBool("visible", true)
        DispatchQueue.main.async { self.liveShown = vis; self.applyRect(); call.resolve() }
    }

    @objc func liveInlineStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.stopInline(); call.resolve() }
    }

    // ═══════════ 📱 ეკრანის ზედა ზოლი (საათი/ბატარეა) ═══════════
    // iPhone-ზე გვერდი არ უნდა „ხტოდეს“ და შიგთავსი საათის ქვეშ არ უნდა გადიოდეს
    private var topCover: UIView?

    private func setupScreen() {
        guard let wv = bridge?.webView else { return }
        wv.scrollView.bounces = false
        wv.scrollView.alwaysBounceVertical = false
        wv.scrollView.alwaysBounceHorizontal = false
        if topCover == nil {
            let c = UIView()
            c.backgroundColor = UIColor(red: 0x0d/255.0, green: 0x1d/255.0, blue: 0x48/255.0, alpha: 1)
            c.isUserInteractionEnabled = false
            c.translatesAutoresizingMaskIntoConstraints = false
            wv.addSubview(c)
            NSLayoutConstraint.activate([
                c.topAnchor.constraint(equalTo: wv.topAnchor),
                c.leadingAnchor.constraint(equalTo: wv.leadingAnchor),
                c.trailingAnchor.constraint(equalTo: wv.trailingAnchor),
                c.bottomAnchor.constraint(equalTo: wv.safeAreaLayoutGuide.topAnchor)
            ])
            topCover = c
        }
    }

    @objc func setTheme(_ call: CAPPluginCall) {
        let light = call.getString("theme", "dark") == "light"
        DispatchQueue.main.async {
            self.setupScreen()
            self.topCover?.backgroundColor = light
                ? UIColor(red: 0xcf/255.0, green: 0xe3/255.0, blue: 0xff/255.0, alpha: 1)
                : UIColor(red: 0x0d/255.0, green: 0x1d/255.0, blue: 0x48/255.0, alpha: 1)
            // საათის/ბატარეის ფერი: მუქ თემაზე თეთრი, ნათელზე შავი
            if let w = self.bridge?.webView?.window {
                w.overrideUserInterfaceStyle = light ? .light : .dark
            }
            self.bridge?.viewController?.setNeedsStatusBarAppearanceUpdate()
            call.resolve()
        }
    }

    override public func load() {
        DispatchQueue.main.async { self.setupScreen() }
        // აპი ფონზე → ნაკადს ვაჩერებთ, დაბრუნებისას ვაგრძელებთ
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.releaseLivePlayer()
        }
        NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self, self.liveWanted else { return }
            self.createLivePlayer()
        }
    }
}

/// ჩანაწერის ფლეერი: ტრიალებს, დახურვისას აპი ისევ ვერტიკალური ხდება
class OctanePlayerViewController: AVPlayerViewController {
    var boundaryToken: Any?
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .allButUpsideDown }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil {
            if let t = boundaryToken { player?.removeTimeObserver(t); boundaryToken = nil }
            player?.pause()
            OctaneOrientation.set(false)
        }
    }
}

/// ცოცხალი ხედი სრულ ეკრანზე (საკუთარი RTSP კლიენტი)
class OctaneLiveViewController: UIViewController {
    private let url: URL
    private let titleText: String
    private let videoView = OctaneRtspView()
    private let status = UILabel()
    private let retry = UIButton(type: .system)
    private var started = false

    init(url: URL, title: String) {
        self.url = url
        self.titleText = title
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .allButUpsideDown }
    override var prefersStatusBarHidden: Bool { true }

    private func pill(_ b: UIButton, _ text: String) {
        b.setTitle(text, for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        b.backgroundColor = UIColor(white: 0, alpha: 0.6)
        b.layer.cornerRadius = 22
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 18, bottom: 0, right: 18)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.heightAnchor.constraint(equalToConstant: 44).isActive = true
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        videoView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(videoView)

        status.textColor = .white
        status.font = .systemFont(ofSize: 18, weight: .semibold)
        status.textAlignment = .center
        status.numberOfLines = 0
        status.text = "ცოცხალ ხედს ვრთავ..."
        status.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(status)

        let close = UIButton(type: .system)
        pill(close, "✕  დახურვა")
        close.addTarget(self, action: #selector(closeTap), for: .touchUpInside)
        view.addSubview(close)

        let name = UILabel()
        name.textColor = .white
        name.font = .systemFont(ofSize: 15, weight: .semibold)
        name.text = "● LIVE  " + titleText
        name.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(name)

        pill(retry, "↻  თავიდან ცდა")
        retry.isHidden = true
        retry.addTarget(self, action: #selector(retryTap), for: .touchUpInside)
        view.addSubview(retry)

        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            videoView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            videoView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            videoView.topAnchor.constraint(equalTo: view.topAnchor),
            videoView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            status.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            status.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 24),
            status.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -24),
            close.topAnchor.constraint(equalTo: g.topAnchor, constant: 14),
            close.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 14),
            name.centerYAnchor.constraint(equalTo: close.centerYAnchor),
            name.leadingAnchor.constraint(equalTo: close.trailingAnchor, constant: 14),
            retry.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            retry.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -40)
        ])
        start()
    }

    private func start() {
        started = false
        status.text = "ცოცხალ ხედს ვრთავ..."
        status.isHidden = false
        retry.isHidden = true
        videoView.fill = false
        videoView.onFirstFrame = { [weak self] in
            guard let self = self, !self.started else { return }
            self.started = true
            self.status.isHidden = true
        }
        videoView.onError = { [weak self] msg in
            guard let self = self else { return }
            self.status.text = "ცოცხალი ხედი ვერ ჩაირთო.\nშეამოწმე, რომ ტელეფონი კამერის WiFi-ზეა.\n(\(msg))"
            self.status.isHidden = false
            self.retry.isHidden = false
        }
        videoView.start(url)
    }

    @objc private func retryTap() {
        retry.isHidden = true
        start()
    }
    @objc private func closeTap() { dismiss(animated: true) }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        videoView.stop()
        OctaneOrientation.set(false)
    }
}

/// VLC-ის გაჩერება მთავარ ნაკადზე ეკრანს ყინავს (და iOS აპს ხურავს) - ყოველთვის ფონზე, რიგით
enum OctaneVlc {
    static let queue = DispatchQueue(label: "ge.octane.vlc")

    /// ცოცხალი ნაკადი: TCP, დიდი კადრები, პროგრამული დეკოდერი (iPhone-ის ჩაშენებული კამერის ნაკადზე „Buffering“-ზე იჭედება)
    static func liveOptions(_ m: VLCMedia) {
        m.addOption(":rtsp-tcp")
        m.addOption(":rtsp-frame-buffer-size=1000000")
        m.addOption(":network-caching=400")
        m.addOption(":codec=avcodec")
        m.addOption(":avcodec-hw=none")
        m.addOption(":avcodec-threads=0")
        m.addOption(":clock-jitter=0")
        m.addOption(":clock-synchro=0")
    }
    static func stop(_ p: VLCMediaPlayer, then: (() -> Void)? = nil) {
        queue.async {
            p.stop()
            if let t = then { DispatchQueue.main.async(execute: t) }
        }
    }
}

/// ჩანაწერის ფლეერი (VLC): ▶/❚❚, გადახვევა, დრო; ტრიალებს, დახურვისას აპი ისევ ვერტიკალურია
class OctaneFilePlayerViewController: UIViewController, VLCMediaPlayerDelegate {
    private let url: URL
    private let titleText: String
    private let startMs: Int
    private let endMs: Int
    private let player = VLCMediaPlayer()
    private let videoView = UIView()
    private let status = UILabel()
    private let bar = UIView()
    private let top = UIView()
    private let playBtn = UIButton(type: .system)
    private let slider = UISlider()
    private let timeLbl = UILabel()
    private var dragging = false
    private var started = false
    private var ended = false

    init(url: URL, title: String, startMs: Int, endMs: Int) {
        self.url = url
        self.titleText = title
        self.startMs = startMs
        self.endMs = endMs
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .allButUpsideDown }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        videoView.translatesAutoresizingMaskIntoConstraints = false
        videoView.isUserInteractionEnabled = false
        view.addSubview(videoView)

        status.textColor = .white
        status.font = .systemFont(ofSize: 17, weight: .semibold)
        status.textAlignment = .center
        status.numberOfLines = 0
        status.text = "ვიდეოს ვხსნი..."
        status.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(status)

        // ზედა ზოლი: დახურვა + სახელი
        top.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(top)
        let close = UIButton(type: .system)
        close.setTitle("✕  დახურვა", for: .normal)
        close.setTitleColor(.white, for: .normal)
        close.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        close.backgroundColor = UIColor(white: 0, alpha: 0.6)
        close.layer.cornerRadius = 22
        close.contentEdgeInsets = UIEdgeInsets(top: 0, left: 18, bottom: 0, right: 18)
        close.translatesAutoresizingMaskIntoConstraints = false
        close.addTarget(self, action: #selector(closeTap), for: .touchUpInside)
        top.addSubview(close)
        let name = UILabel()
        name.textColor = .white
        name.font = .systemFont(ofSize: 15, weight: .semibold)
        name.text = titleText
        name.translatesAutoresizingMaskIntoConstraints = false
        top.addSubview(name)

        // ქვედა ზოლი: ▶/❚❚ + გადახვევა + დრო
        bar.backgroundColor = UIColor(white: 0, alpha: 0.55)
        bar.layer.cornerRadius = 22
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)
        playBtn.tintColor = .white
        playBtn.setImage(UIImage(systemName: "pause.fill"), for: .normal)
        playBtn.translatesAutoresizingMaskIntoConstraints = false
        playBtn.addTarget(self, action: #selector(playTap), for: .touchUpInside)
        bar.addSubview(playBtn)
        slider.minimumTrackTintColor = UIColor(red: 0.23, green: 0.51, blue: 0.96, alpha: 1)
        slider.translatesAutoresizingMaskIntoConstraints = false
        slider.addTarget(self, action: #selector(slideStart), for: .touchDown)
        slider.addTarget(self, action: #selector(slideMove), for: .valueChanged)
        slider.addTarget(self, action: #selector(slideEnd), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        bar.addSubview(slider)
        timeLbl.textColor = .white
        timeLbl.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
        timeLbl.text = "0:00 / 0:00"
        timeLbl.setContentHuggingPriority(.required, for: .horizontal)
        timeLbl.setContentCompressionResistancePriority(.required, for: .horizontal)
        timeLbl.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(timeLbl)

        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            videoView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            videoView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            videoView.topAnchor.constraint(equalTo: view.topAnchor),
            videoView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            status.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            status.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 24),
            status.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -24),

            top.topAnchor.constraint(equalTo: g.topAnchor, constant: 10),
            top.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
            top.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -12),
            top.heightAnchor.constraint(equalToConstant: 44),
            close.leadingAnchor.constraint(equalTo: top.leadingAnchor),
            close.centerYAnchor.constraint(equalTo: top.centerYAnchor),
            close.heightAnchor.constraint(equalToConstant: 44),
            name.leadingAnchor.constraint(equalTo: close.trailingAnchor, constant: 14),
            name.trailingAnchor.constraint(lessThanOrEqualTo: top.trailingAnchor),
            name.centerYAnchor.constraint(equalTo: top.centerYAnchor),

            bar.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
            bar.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -12),
            bar.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -12),
            bar.heightAnchor.constraint(equalToConstant: 56),
            playBtn.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 8),
            playBtn.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            playBtn.widthAnchor.constraint(equalToConstant: 44),
            playBtn.heightAnchor.constraint(equalToConstant: 44),
            slider.leadingAnchor.constraint(equalTo: playBtn.trailingAnchor, constant: 8),
            slider.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            timeLbl.leadingAnchor.constraint(equalTo: slider.trailingAnchor, constant: 12),
            timeLbl.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -16),
            timeLbl.centerYAnchor.constraint(equalTo: bar.centerYAnchor)
        ])

        // ეკრანზე შეხება → მართვის ზოლები ქრება / ჩნდება
        view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(toggleUi)))
        start()
    }

    private func start() {
        started = false
        ended = false
        let m = VLCMedia(url: url)
        m.addOption(":network-caching=1500")
        // iPhone-ის აპარატული დეკოდერი კამერის ფაილის ცარიელ კადრებზე „ბრმავდება“ (შავი ეკრანი, ხმა ისმის)
        m.addOption(":codec=avcodec")
        m.addOption(":avcodec-hw=none")
        if startMs > 0 { m.addOption(":start-time=\(Double(startMs) / 1000.0)") }
        if endMs > startMs { m.addOption(":stop-time=\(Double(endMs) / 1000.0)") }
        player.media = m
        player.drawable = videoView
        player.delegate = self
        player.play()
    }

    private func fmt(_ ms: Int32) -> String {
        let s = max(0, Int(ms) / 1000)
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }

    private func updateTime(_ pos: Float? = nil) {
        let len: Int32 = player.media?.length.intValue ?? 0
        var cur: Int32 = player.time.intValue
        if let p = pos { cur = Int32(Float(len) * p) }
        timeLbl.text = fmt(cur) + " / " + fmt(len)
    }

    func mediaPlayerTimeChanged(_ aNotification: Notification) {
        DispatchQueue.main.async {
            if !self.started { self.started = true; self.status.isHidden = true }
            if !self.dragging {
                self.slider.value = self.player.position
                self.updateTime()
            }
        }
    }

    func mediaPlayerStateChanged(_ aNotification: Notification) {
        DispatchQueue.main.async {
            let st = self.player.state
            if st == .error {
                self.status.text = "ვიდეო ვერ ჩაირთო.\nშეამოწმე, რომ ტელეფონი კამერის WiFi-ზეა."
                self.status.isHidden = false
            }
            if st == .ended || st == .stopped { self.ended = true }
            let playing = self.player.isPlaying && !self.ended
            self.playBtn.setImage(UIImage(systemName: playing ? "pause.fill" : "play.fill"), for: .normal)
        }
    }

    @objc private func playTap() {
        if ended {
            // ბოლომდე ჩაირთო → თავიდან
            playBtn.setImage(UIImage(systemName: "pause.fill"), for: .normal)
            OctaneVlc.stop(player) { [weak self] in self?.start() }
        } else if player.isPlaying {
            player.pause()
            playBtn.setImage(UIImage(systemName: "play.fill"), for: .normal)
        } else {
            player.play()
            playBtn.setImage(UIImage(systemName: "pause.fill"), for: .normal)
        }
    }

    @objc private func slideStart() { dragging = true }
    @objc private func slideMove() { updateTime(slider.value) }
    @objc private func slideEnd() {
        dragging = false
        if !ended { player.position = slider.value }
    }

    @objc private func toggleUi() {
        let hide = !bar.isHidden
        bar.isHidden = hide
        top.isHidden = hide
    }

    @objc private func closeTap() { dismiss(animated: true) }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        player.delegate = nil
        OctaneVlc.stop(player)
        OctaneOrientation.set(false)
    }
}
