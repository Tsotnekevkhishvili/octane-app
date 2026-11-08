import Foundation
import Capacitor
import Network

/**
 * Octane App (iPhone) - TCP კავშირი OBD სკანერთან (192.168.0.10:35000).
 *
 * ანდროიდზე იგივეს cordova-plugin-chrome-apps-sockets-tcp აკეთებს. iPhone-ზე JS-ის
 * ფენა (dist/ios-shim.js) window.chrome.sockets.tcp-ს ამ პლაგინზე გადაამისამართებს,
 * ამიტომ index.html-ის OBD ლოგიკა უცვლელი რჩება.
 *
 *   create()                              → { socketId }
 *   connect({ socketId, host, port, timeout }) → { result: 0 } (ან შეცდომა)
 *   send({ socketId, data })              → data = base64
 *   close({ socketId })
 *   data მოვლენა                        → { socketId, data(base64) }
 */
@objc(ObdTcpPlugin)
public class ObdTcpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ObdTcpPlugin"
    public let jsName = "ObdTcp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "create", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    private var sockets: [Int: NWConnection] = [:]
    private var nextId = 1
    private let queue = DispatchQueue(label: "ge.octane.obdtcp")

    @objc func create(_ call: CAPPluginCall) {
        queue.async {
            let id = self.nextId
            self.nextId += 1
            call.resolve(["socketId": id])
        }
    }

    @objc func connect(_ call: CAPPluginCall) {
        let id = call.getInt("socketId", 0)
        let host = call.getString("host", "192.168.0.10")
        let port = UInt16(call.getInt("port", 35000))
        let timeout = call.getDouble("timeout", 8)
        guard let nwPort = NWEndpoint.Port(rawValue: port) else { call.reject("BAD_PORT"); return }

        queue.async {
            self.sockets[id]?.cancel()
            let params = NWParameters.tcp
            params.requiredInterfaceType = .wifi   // სკანერი ყოველთვის WiFi-ზეა (მობილური ინტერნეტი არ გამოიყენოს)
            let conn = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: params)
            self.sockets[id] = conn
            var answered = false
            let finish: (Bool, String) -> Void = { ok, err in
                if answered { return }
                answered = true
                if ok { call.resolve(["result": 0]) } else { call.reject(err) }
            }
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    finish(true, "")
                    self.receive(id, conn)
                case .failed(let e):
                    finish(false, "CONNECT_FAILED: \(e)")
                    self.drop(id)
                case .waiting(let e):
                    // ქსელი ჯერ არ არის (მაგ. WiFi ჯერ არ შეერთებულა) - ცოტას ვიცდით, მერე ვაჩერებთ
                    self.queue.asyncAfter(deadline: .now() + timeout) {
                        if !answered { finish(false, "CONNECT_WAITING: \(e)"); conn.cancel(); self.drop(id) }
                    }
                case .cancelled:
                    finish(false, "CANCELLED")
                default:
                    break
                }
            }
            conn.start(queue: self.queue)
            self.queue.asyncAfter(deadline: .now() + timeout) {
                if !answered { finish(false, "TIMEOUT"); conn.cancel(); self.drop(id) }
            }
        }
    }

    private func receive(_ id: Int, _ conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let data = data, !data.isEmpty {
                self.notifyListeners("data", data: ["socketId": id, "data": data.base64EncodedString()])
            }
            if isComplete || error != nil {
                self.drop(id)
                return
            }
            self.receive(id, conn)
        }
    }

    private func drop(_ id: Int) {
        queue.async { self.sockets[id] = nil }
    }

    @objc func send(_ call: CAPPluginCall) {
        let id = call.getInt("socketId", 0)
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { call.reject("NO_DATA"); return }
        queue.async {
            guard let conn = self.sockets[id] else { call.reject("NOT_CONNECTED"); return }
            conn.send(content: data, completion: .contentProcessed { error in
                if let e = error { call.reject("SEND_FAILED: \(e)") } else { call.resolve(["bytesSent": data.count]) }
            })
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        let id = call.getInt("socketId", 0)
        queue.async {
            self.sockets[id]?.cancel()
            self.sockets[id] = nil
            call.resolve()
        }
    }
}
