import Foundation
import AVFoundation

/**
 * ▶️ კამერაზე მყოფი ვიდეოს ჩვენება iPhone-ის ჩაშენებული ფლეერით - გადმოწერის გარეშე.
 *
 * კამერის MP4-ში ყოველი მე-6 კადრი ცარიელია და iPhone-ის დეკოდერი მასზე ბრმავდება (შავი ეკრანი, ხმა ისმის).
 * ფლეერს ფაილს ამ შუამავლით ვაწვდით: ვიდეოს მონაცემებს (mdat) კამერიდან ნაწილ-ნაწილ (HTTP Range) ვკითხულობთ,
 * ბოლოში მდებარე სარჩევს (moov) კი ერთხელ ვტვირთავთ, ცარიელ კადრებს ვშლით (OctaneMp4Fix) და გასწორებულს ვაძლევთ.
 *
 * ლეპტოპით შემოწმდა: კამერა Range-ს იღებს (206, Accept-Ranges: bytes), bytes=-N ფორმას - არა; სიჩქარე ~3.6 MB/წმ.
 */
final class OctaneCamVideoLoader: NSObject, AVAssetResourceLoaderDelegate, URLSessionDataDelegate {
    static let scheme = "octanecam"

    let queue = DispatchQueue(label: "ge.octane.camvideo")
    private let realUrl: URL
    private var session: URLSession!

    private var state = 0          // 0 - არ დაწყებულა, 1 - მზადდება, 2 - მზადაა, 3 - შეცდომა
    private var failError: Error? = nil
    private var moovOff: Int64 = 0  // რეალურ ფაილში moov-ის დასაწყისი (მანამდე ყველაფერი კამერიდან მოდის უცვლელად)
    private var newMoov = Data()   // გასწორებული moov
    private var virtualLen: Int64 = 0
    private var waiting = [AVAssetResourceLoadingRequest]()

    private final class Job {
        let req: AVAssetResourceLoadingRequest
        let task: URLSessionDataTask
        let tailFrom: Int64
        let tailTo: Int64
        init(req: AVAssetResourceLoadingRequest, task: URLSessionDataTask, tailFrom: Int64, tailTo: Int64) {
            self.req = req
            self.task = task
            self.tailFrom = tailFrom
            self.tailTo = tailTo
        }
    }
    private var jobs = [Int: Job]()

    init(realUrl: URL) {
        self.realUrl = realUrl
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.allowsCellularAccess = false          // კამერა მხოლოდ WiFi-ზეა
        cfg.waitsForConnectivity = false
        cfg.timeoutIntervalForRequest = 20
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        let oq = OperationQueue()
        oq.underlyingQueue = queue
        oq.maxConcurrentOperationCount = 1
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: oq)
    }

    /// AVURLAsset octanecam:// მისამართით - ფლეერი მონაცემებს ამ კლასს სთხოვს
    static func makeAsset(_ url: URL) -> (AVURLAsset, OctaneCamVideoLoader)? {
        guard var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        c.scheme = scheme
        guard let fake = c.url else { return nil }
        let loader = OctaneCamVideoLoader(realUrl: url)
        let asset = AVURLAsset(url: fake)
        asset.resourceLoader.setDelegate(loader, queue: loader.queue)
        return (asset, loader)
    }

    /// ფლეერი დაიხურა - კამერიდან კითხვას ვაჩერებთ
    func shutdown() {
        queue.async {
            for (_, j) in self.jobs { j.task.cancel() }
            self.jobs.removeAll()
            self.waiting.removeAll()
            self.session.invalidateAndCancel()
        }
    }

    // ─────────── მომზადება: ფაილის ზომა + moov ───────────

    private static func be32(_ b: [UInt8], _ o: Int) -> UInt32 {
        let a = UInt32(b[o]) << 24
        let c = UInt32(b[o + 1]) << 16
        let d = UInt32(b[o + 2]) << 8
        return a | c | d | UInt32(b[o + 3])
    }

    /// კამერიდან [from, to) ბაიტები; total - ფაილის სრული ზომა (Content-Range-დან)
    private func fetch(_ from: Int64, _ to: Int64, _ done: @escaping (Data?, Int64) -> Void) {
        var r = URLRequest(url: realUrl)
        r.setValue("bytes=\(from)-\(to - 1)", forHTTPHeaderField: "Range")
        let t = session.dataTask(with: r) { data, resp, err in
            var total: Int64 = 0
            var ok = false
            if let h = resp as? HTTPURLResponse {
                ok = h.statusCode == 206
                if let cr = h.value(forHTTPHeaderField: "Content-Range"), let slash = cr.lastIndex(of: "/") {
                    total = Int64(String(cr[cr.index(after: slash)...]).trimmingCharacters(in: .whitespaces)) ?? 0
                }
            }
            done((ok && err == nil) ? data : nil, total)
        }
        t.resume()
    }

    private func prepare() {
        state = 1
        fetch(0, 16) { data, total in
            guard data != nil, total > 16 else { self.fail("კამერამ ფაილი არ გასცა"); return }
            self.walk(0, total, 0)
        }
    }

    /// ზედა დონის ყუთებს (ftyp, mdat, moov...) ვუყვებით, სანამ moov-ს ვიპოვით
    private func walk(_ off: Int64, _ total: Int64, _ hops: Int) {
        if hops > 8 || off + 8 > total { passThrough(total); return }
        fetch(off, min(off + 16, total)) { data, _ in
            guard let d = data, d.count >= 8 else { self.fail("ფაილის წაკითხვა ვერ მოხერხდა"); return }
            let h = [UInt8](d)
            var size = Int64(OctaneCamVideoLoader.be32(h, 0))
            let type = String(bytes: h[4..<8], encoding: .ascii) ?? ""
            if size == 1 {
                guard h.count >= 16 else { self.passThrough(total); return }
                size = (Int64(OctaneCamVideoLoader.be32(h, 8)) << 32) | Int64(OctaneCamVideoLoader.be32(h, 12))
            } else if size == 0 {
                size = total - off
            }
            if size < 8 || off + size > total { self.passThrough(total); return }
            if type == "moov" {
                if size > 64_000_000 { self.passThrough(total); return }
                self.fetch(off, off + size) { md, _ in
                    guard let m = md, Int64(m.count) == size else { self.fail("ვიდეოს სარჩევი ვერ ჩამოიტვირთა"); return }
                    let fixed = OctaneMp4Fix.fixMoovBox([UInt8](m))
                    self.moovOff = off
                    self.newMoov = Data(fixed)
                    self.virtualLen = off + Int64(fixed.count)
                    self.ready()
                }
            } else {
                self.walk(off + size, total, hops + 1)
            }
        }
    }

    /// moov ვიდეოს წინ არის (ან ვერ ვიპოვეთ) - ფაილს უცვლელად ვაწვდით
    private func passThrough(_ total: Int64) {
        moovOff = total
        newMoov = Data()
        virtualLen = total
        ready()
    }

    private func ready() {
        state = 2
        let w = waiting
        waiting.removeAll()
        for r in w where !r.isCancelled && !r.isFinished { serve(r) }
    }

    private func fail(_ msg: String) {
        state = 3
        let e = NSError(domain: "ge.octane.camvideo", code: 1, userInfo: [NSLocalizedDescriptionKey: msg])
        failError = e
        let w = waiting
        waiting.removeAll()
        for r in w where !r.isCancelled && !r.isFinished { r.finishLoading(with: e) }
    }

    // ─────────── ფლეერის მოთხოვნები ───────────

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest) -> Bool {
        switch state {
        case 2:
            serve(loadingRequest)
        case 3:
            loadingRequest.finishLoading(with: failError)
        default:
            waiting.append(loadingRequest)
            if state == 0 { prepare() }
        }
        return true
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel loadingRequest: AVAssetResourceLoadingRequest) {
        waiting.removeAll { $0 === loadingRequest }
        let ids = jobs.filter { $0.value.req === loadingRequest }.map { $0.key }
        for id in ids {
            jobs[id]?.task.cancel()
            jobs[id] = nil
        }
    }

    private func serve(_ req: AVAssetResourceLoadingRequest) {
        if let info = req.contentInformationRequest {
            info.contentType = AVFileType.mp4.rawValue
            info.contentLength = virtualLen
            info.isByteRangeAccessSupported = true
        }
        guard let dr = req.dataRequest else { req.finishLoading(); return }
        let start = dr.currentOffset
        var end: Int64 = dr.requestsAllDataToEndOfResource ? virtualLen : dr.requestedOffset + Int64(dr.requestedLength)
        if end > virtualLen { end = virtualLen }
        if start >= end { req.finishLoading(); return }
        if start >= moovOff {
            respondTail(dr, start, end)
            req.finishLoading()
            return
        }
        let realEnd = min(end, moovOff)
        var r = URLRequest(url: realUrl)
        r.setValue("bytes=\(start)-\(realEnd - 1)", forHTTPHeaderField: "Range")
        let t = session.dataTask(with: r)
        let hasTail = end > moovOff
        jobs[t.taskIdentifier] = Job(req: req, task: t, tailFrom: hasTail ? moovOff : 0, tailTo: hasTail ? end : 0)
        t.resume()
    }

    /// გასწორებული moov-ის ნაწილი [from, to) (ვირტუალური ფაილის კოორდინატებში)
    private func respondTail(_ dr: AVAssetResourceLoadingDataRequest, _ from: Int64, _ to: Int64) {
        let a = Int(from - moovOff)
        let b = Int(to - moovOff)
        guard a >= 0, b <= newMoov.count, a < b else { return }
        dr.respond(with: newMoov.subdata(in: a..<b))
    }

    // ─────────── კამერიდან მოსული ბაიტები → ფლეერს ───────────

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let j = jobs[dataTask.taskIdentifier] else { return }
        if j.req.isCancelled || j.req.isFinished {
            dataTask.cancel()
            jobs[dataTask.taskIdentifier] = nil
            return
        }
        j.req.dataRequest?.respond(with: data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let j = jobs.removeValue(forKey: task.taskIdentifier) else { return }
        if j.req.isCancelled || j.req.isFinished { return }
        if let e = error {
            j.req.finishLoading(with: e)
            return
        }
        if j.tailTo > j.tailFrom, let dr = j.req.dataRequest { respondTail(dr, j.tailFrom, j.tailTo) }
        j.req.finishLoading()
    }
}
