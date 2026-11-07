import Foundation
import Network
import UIKit
import AVFoundation
import CoreMedia

/**
 * 📺 რეგისტრატორის ცოცხალი ხედი (RTSP → H.264 → ეკრანი), VLC-ის გარეშე.
 *
 * VLC-ის RTSP მოდული ამ კამერისგან ერთ ბაიტსაც ვერ იღებდა (ანდროიდზე ExoPlayer კი ხსნის).
 * აქ თავად ვესაუბრებით კამერას ისევე, როგორც ExoPlayer: OPTIONS → DESCRIBE → SETUP (TCP) → PLAY,
 * ვიდეოს პაკეტებს (RTP) ვაწყობთ კადრებად და iPhone-ის ჩაშენებულ დეკოდერს ვაწვდით.
 */
final class OctaneRtspClient {
    private enum Phase: String { case connect = "CONNECT", options = "OPTIONS", describe = "DESCRIBE", setup = "SETUP", play = "PLAY", stream = "STREAM" }

    private let url: URL
    private let q = DispatchQueue(label: "ge.octane.rtsp")
    private var conn: NWConnection?
    private var buf = [UInt8]()
    private var cseq = 0
    private var phase = Phase.connect
    private var session = ""
    private var controlUrl = ""
    private var baseUrl = ""
    private var stopped = false
    private var keepAlive: DispatchSourceTimer?

    // H.264
    private var sps: [UInt8]? = nil
    private var pps: [UInt8]? = nil
    private var format: CMVideoFormatDescription? = nil
    private var fuBuf = [UInt8]()
    private var auNals = [[UInt8]]()
    private var auTs: UInt32 = 0
    private var haveIdr = false

    // სტატისტიკა (დიაგნოსტიკისთვის)
    private(set) var bytesIn = 0
    private(set) var rtpPackets = 0
    private(set) var frames = 0
    private(set) var lastError = ""

    var onSample: ((CMSampleBuffer) -> Void)?
    var onError: ((String) -> Void)?

    init(url: URL) { self.url = url }

    /// მთავარი ნაკადიდან იკითხება - მონაცემებს ჩვენივე რიგზე ვკითხულობთ
    var stats: String {
        return q.sync { () -> String in
            let kb = self.bytesIn / 1024
            let err = self.lastError.isEmpty ? "" : " ⚠ \(self.lastError)"
            return "\(self.phase.rawValue) · \(kb)KB · rtp \(self.rtpPackets) · კადრი \(self.frames)" + err
        }
    }

    func start() {
        q.async { self.open() }
    }

    func stop() {
        q.async {
            if self.stopped { return }
            self.stopped = true
            self.keepAlive?.cancel()
            self.keepAlive = nil
            if !self.session.isEmpty { self.send("TEARDOWN", self.controlUrl.isEmpty ? self.url.absoluteString : self.controlUrl) }
            let c = self.conn
            self.conn = nil
            // TEARDOWN-ს გაგზავნის დრო მივცეთ
            self.q.asyncAfter(deadline: .now() + 0.3) { c?.cancel() }
        }
    }

    // ─────────── კავშირი ───────────

    private func open() {
        guard let host = url.host else { fail("NO_HOST"); return }
        let portNum = UInt16(url.port ?? 554)
        guard let port = NWEndpoint.Port(rawValue: portNum) else { fail("BAD_PORT"); return }
        let params = NWParameters.tcp
        params.requiredInterfaceType = .wifi   // კამერა ყოველთვის WiFi-ზეა
        let c = NWConnection(host: NWEndpoint.Host(host), port: port, using: params)
        conn = c
        c.stateUpdateHandler = { [weak self] state in
            guard let self = self, !self.stopped else { return }
            switch state {
            case .ready:
                self.phase = .options
                self.send("OPTIONS", self.url.absoluteString)
                self.receive(c)
            case .failed(let e):
                self.fail("TCP: \(e)")
            case .waiting(let e):
                self.lastError = "TCP waiting: \(e)"
            default:
                break
            }
        }
        c.start(queue: q)
        // 12 წამში სურათი არ მოვიდა → შეცდომა (სად გაჩერდა - phase-ში ჩანს)
        q.asyncAfter(deadline: .now() + 12) { [weak self] in
            guard let self = self, !self.stopped, self.frames == 0 else { return }
            self.fail("TIMEOUT @\(self.phase.rawValue)")
        }
    }

    private func fail(_ msg: String) {
        if stopped { return }
        lastError = msg
        stopped = true
        keepAlive?.cancel()
        keepAlive = nil
        conn?.cancel()
        conn = nil
        onError?(msg)
    }

    private func receive(_ c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 262144) { [weak self] data, _, isComplete, error in
            guard let self = self, !self.stopped else { return }
            if let d = data, !d.isEmpty {
                self.bytesIn += d.count
                self.buf.append(contentsOf: d)
                self.process()
            }
            if let e = error { self.fail("RECV: \(e)"); return }
            if isComplete { self.fail("კამერამ კავშირი დახურა @\(self.phase.rawValue)"); return }
            self.receive(c)
        }
    }

    private func send(_ method: String, _ uri: String, _ extra: [String] = []) {
        cseq += 1
        var s = "\(method) \(uri) RTSP/1.0\r\nCSeq: \(cseq)\r\nUser-Agent: OctaneApp\r\n"
        if !session.isEmpty { s += "Session: \(session)\r\n" }
        for e in extra { s += e + "\r\n" }
        s += "\r\n"
        conn?.send(content: Data(s.utf8), completion: .contentProcessed { _ in })
    }

    // ─────────── შემოსული ნაკადის დაშლა ───────────

    private func findHeaderEnd(_ from: Int) -> Int? {
        var i = from
        while i + 3 < buf.count {
            if buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10 { return i }
            i += 1
        }
        return nil
    }

    private func process() {
        var pos = 0
        while !stopped && pos < buf.count {
            let b0 = buf[pos]
            if b0 == 0x24 {   // '$' - ჩაშენებული RTP/RTCP პაკეტი
                if buf.count - pos < 4 { break }
                let ch = Int(buf[pos + 1])
                let len = (Int(buf[pos + 2]) << 8) | Int(buf[pos + 3])
                if buf.count - pos < 4 + len { break }
                if ch == 0 { handleRtp(Array(buf[(pos + 4)..<(pos + 4 + len)])) }
                pos += 4 + len
            } else if b0 == 0x52 {   // 'R' - RTSP პასუხი
                guard let he = findHeaderEnd(pos) else {
                    if buf.count - pos > 65536 { pos = buf.count }   // ნაგავი
                    break
                }
                let header = String(decoding: buf[pos..<he], as: UTF8.self)
                let headers = parseHeaders(header)
                let clen = Int(headers["content-length"] ?? "0") ?? 0
                if buf.count < he + 4 + clen { break }
                let body = String(decoding: buf[(he + 4)..<(he + 4 + clen)], as: UTF8.self)
                pos = he + 4 + clen
                if header.hasPrefix("RTSP/") { handleResponse(header, headers, body) }
            } else {
                pos += 1   // სინქრონიზაციის აღდგენა
            }
        }
        if pos > 0 {
            if pos >= buf.count { buf.removeAll(keepingCapacity: true) } else { buf.removeFirst(pos) }
        }
    }

    private func parseHeaders(_ header: String) -> [String: String] {
        var h = [String: String]()
        let lines = header.components(separatedBy: "\r\n")
        for line in lines.dropFirst() {
            guard let r = line.range(of: ":") else { continue }
            let k = line[line.startIndex..<r.lowerBound].trimmingCharacters(in: .whitespaces).lowercased()
            let v = line[r.upperBound...].trimmingCharacters(in: .whitespaces)
            h[k] = v
        }
        return h
    }

    private func handleResponse(_ header: String, _ headers: [String: String], _ body: String) {
        let first = header.components(separatedBy: "\r\n").first ?? ""
        let parts = first.components(separatedBy: " ")
        let code = parts.count > 1 ? (Int(parts[1]) ?? 0) : 0
        if phase == .stream { return }   // keep-alive-ის პასუხი
        if code != 200 { fail("RTSP \(code) @\(phase.rawValue)"); return }
        switch phase {
        case .options:
            phase = .describe
            send("DESCRIBE", url.absoluteString, ["Accept: application/sdp"])
        case .describe:
            var base = headers["content-base"] ?? headers["content-location"] ?? url.absoluteString
            if base.isEmpty { base = url.absoluteString }
            baseUrl = base
            parseSdp(body, base)
            phase = .setup
            send("SETUP", controlUrl, ["Transport: RTP/AVP/TCP;unicast;interleaved=0-1"])
        case .setup:
            let s = headers["session"] ?? ""
            session = s.components(separatedBy: ";").first?.trimmingCharacters(in: .whitespaces) ?? ""
            phase = .play
            send("PLAY", baseUrl.isEmpty ? url.absoluteString : baseUrl, ["Range: npt=0.000-"])
        case .play:
            phase = .stream
            startKeepAlive()
        default:
            break
        }
    }

    private func parseSdp(_ sdp: String, _ base: String) {
        var inVideo = false
        var control = ""
        var sprop = ""
        for raw in sdp.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.hasPrefix("m=") { inVideo = line.hasPrefix("m=video"); continue }
            if !inVideo { continue }
            if line.hasPrefix("a=control:") { control = String(line.dropFirst(10)) }
            if line.hasPrefix("a=fmtp:"), let r = line.range(of: "sprop-parameter-sets=") {
                sprop = String(line[r.upperBound...]).components(separatedBy: ";").first ?? ""
            }
        }
        if control.isEmpty || control == "*" {
            controlUrl = base
        } else if control.lowercased().hasPrefix("rtsp://") {
            controlUrl = control
        } else {
            controlUrl = base.hasSuffix("/") ? base + control : base + "/" + control
        }
        for p in sprop.components(separatedBy: ",") {
            var b64 = p.trimmingCharacters(in: .whitespaces)
            while b64.count % 4 != 0 { b64 += "=" }
            guard let d = Data(base64Encoded: b64), let h = d.first else { continue }
            let t = h & 0x1f
            if t == 7 { sps = [UInt8](d) }
            if t == 8 { pps = [UInt8](d) }
        }
    }

    private func startKeepAlive() {
        let t = DispatchSource.makeTimerSource(queue: q)
        t.schedule(deadline: .now() + 20, repeating: 20)
        t.setEventHandler { [weak self] in
            guard let self = self, !self.stopped else { return }
            self.send("OPTIONS", self.url.absoluteString)
        }
        t.resume()
        keepAlive = t
    }

    // ─────────── RTP → H.264 კადრები ───────────

    private func handleRtp(_ p: [UInt8]) {
        guard p.count > 12, (p[0] >> 6) == 2 else { return }
        rtpPackets += 1
        let cc = Int(p[0] & 0x0f)
        let hasExt = (p[0] & 0x10) != 0
        let hasPad = (p[0] & 0x20) != 0
        let marker = (p[1] & 0x80) != 0
        let t0 = UInt32(p[4]) << 24
        let t1 = UInt32(p[5]) << 16
        let t2 = UInt32(p[6]) << 8
        let ts = t0 | t1 | t2 | UInt32(p[7])
        var off = 12 + 4 * cc
        if hasExt {
            guard p.count >= off + 4 else { return }
            let el = (Int(p[off + 2]) << 8) | Int(p[off + 3])
            off += 4 + 4 * el
        }
        var end = p.count
        if hasPad { end -= Int(p[p.count - 1]) }
        guard off < end else { return }

        if ts != auTs && !auNals.isEmpty { flushAU() }
        auTs = ts

        let pl = Array(p[off..<end])
        let nalType = pl[0] & 0x1f
        if nalType >= 1 && nalType <= 23 {
            auNals.append(pl)
        } else if nalType == 24 {   // STAP-A
            var i = 1
            while i + 2 <= pl.count {
                let n = (Int(pl[i]) << 8) | Int(pl[i + 1])
                i += 2
                if n == 0 || i + n > pl.count { break }
                auNals.append(Array(pl[i..<(i + n)]))
                i += n
            }
        } else if nalType == 28 {   // FU-A
            guard pl.count > 2 else { return }
            let fu = pl[1]
            if (fu & 0x80) != 0 {
                fuBuf = [(pl[0] & 0xe0) | (fu & 0x1f)]
                fuBuf.append(contentsOf: pl[2...])
            } else if !fuBuf.isEmpty {
                fuBuf.append(contentsOf: pl[2...])
            }
            if (fu & 0x40) != 0 && !fuBuf.isEmpty {
                auNals.append(fuBuf)
                fuBuf = []
            }
        }
        if marker { flushAU() }
    }

    private func flushAU() {
        let nals = auNals
        auNals = []
        var idr = false
        var payload = [UInt8]()
        for n in nals {
            guard let h = n.first else { continue }
            let t = h & 0x1f
            if t == 7 { if sps == nil || sps! != n { sps = n; format = nil }; continue }
            if t == 8 { if pps == nil || pps! != n { pps = n; format = nil }; continue }
            if t == 9 { continue }   // AUD
            if t == 5 { idr = true }
            let l = UInt32(n.count)
            payload.append(UInt8((l >> 24) & 0xff))
            payload.append(UInt8((l >> 16) & 0xff))
            payload.append(UInt8((l >> 8) & 0xff))
            payload.append(UInt8(l & 0xff))
            payload.append(contentsOf: n)
        }
        if payload.isEmpty { return }
        if format == nil, let s = sps, let p = pps { format = OctaneRtspClient.makeFormat(s, p) }
        guard let fmt = format else { return }
        if !haveIdr {
            if !idr { return }   // პირველი სრული კადრის მოლოდინი
            haveIdr = true
        }
        guard let sb = OctaneRtspClient.makeSample(payload, fmt) else { return }
        frames += 1
        onSample?(sb)
    }

    private static func makeFormat(_ sps: [UInt8], _ pps: [UInt8]) -> CMVideoFormatDescription? {
        var fmt: CMFormatDescription? = nil
        let status: OSStatus = sps.withUnsafeBufferPointer { s -> OSStatus in
            return pps.withUnsafeBufferPointer { p -> OSStatus in
                guard let sa = s.baseAddress, let pa = p.baseAddress else { return -1 }
                let ptrs: [UnsafePointer<UInt8>] = [sa, pa]
                let sizes: [Int] = [sps.count, pps.count]
                return CMVideoFormatDescriptionCreateFromH264ParameterSets(
                    allocator: kCFAllocatorDefault,
                    parameterSetCount: 2,
                    parameterSetPointers: ptrs,
                    parameterSetSizes: sizes,
                    nalUnitHeaderLength: 4,
                    formatDescriptionOut: &fmt)
            }
        }
        return status == noErr ? fmt : nil
    }

    private static func makeSample(_ data: [UInt8], _ fmt: CMVideoFormatDescription) -> CMSampleBuffer? {
        var block: CMBlockBuffer? = nil
        var st = CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault,
            memoryBlock: nil,
            blockLength: data.count,
            blockAllocator: kCFAllocatorDefault,
            customBlockSource: nil,
            offsetToData: 0,
            dataLength: data.count,
            flags: 0,
            blockBufferOut: &block)
        guard st == kCMBlockBufferNoErr, let bb = block else { return nil }
        st = data.withUnsafeBytes { raw -> OSStatus in
            guard let base = raw.baseAddress else { return -1 }
            return CMBlockBufferReplaceDataBytes(with: base, blockBuffer: bb, offsetIntoDestination: 0, dataLength: data.count)
        }
        guard st == kCMBlockBufferNoErr else { return nil }
        var sample: CMSampleBuffer? = nil
        var size = data.count
        st = CMSampleBufferCreateReady(
            allocator: kCFAllocatorDefault,
            dataBuffer: bb,
            formatDescription: fmt,
            sampleCount: 1,
            sampleTimingEntryCount: 0,
            sampleTimingArray: nil,
            sampleSizeEntryCount: 1,
            sampleSizeArray: &size,
            sampleBufferOut: &sample)
        guard st == noErr, let sb = sample else { return nil }
        // ცოცხალი ნაკადი - კადრი მაშინვე გამოჩნდეს (დროის ნიშნულების გარეშე)
        if let arr = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: true), CFArrayGetCount(arr) > 0 {
            let dict = unsafeBitCast(CFArrayGetValueAtIndex(arr, 0), to: CFMutableDictionary.self)
            CFDictionarySetValue(dict,
                                 Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
                                 Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
        }
        return sb
    }
}

/// ეკრანის ნაწილი, სადაც ცოცხალი ვიდეო ჩანს
final class OctaneRtspView: UIView {
    override class var layerClass: AnyClass { return AVSampleBufferDisplayLayer.self }
    private var displayLayer: AVSampleBufferDisplayLayer { return layer as! AVSampleBufferDisplayLayer }
    private var client: OctaneRtspClient?
    private var gotFrame = false

    var onFirstFrame: (() -> Void)?
    var onError: ((String) -> Void)?
    var fill = true

    var stats: String { return client?.stats ?? "-" }

    func start(_ url: URL) {
        stop()
        gotFrame = false
        backgroundColor = .black
        displayLayer.videoGravity = fill ? .resizeAspectFill : .resizeAspect
        let c = OctaneRtspClient(url: url)
        c.onSample = { [weak self, weak c] sb in
            DispatchQueue.main.async {
                guard let self = self, let c = c, self.client === c else { return }
                if self.displayLayer.status == .failed { self.displayLayer.flush() }
                self.displayLayer.enqueue(sb)
                if !self.gotFrame {
                    self.gotFrame = true
                    self.onFirstFrame?()
                }
            }
        }
        c.onError = { [weak self, weak c] msg in
            DispatchQueue.main.async {
                guard let self = self, let c = c, self.client === c else { return }
                self.onError?(msg)
            }
        }
        client = c
        c.start()
    }

    func stop() {
        client?.onSample = nil
        client?.onError = nil
        client?.stop()
        client = nil
        displayLayer.flushAndRemoveImage()
    }
}
