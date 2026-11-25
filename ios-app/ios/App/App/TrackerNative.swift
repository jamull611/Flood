// Native features of the iPad/iPhone app for the Adjuster Claim Tracker:
//  - LiDAR room scanning with Apple's RoomPlan (walls, doors, windows, openings, fixtures)
//  - saving files (zip, PDF, 3D model) through the share sheet
// The tracker page calls these as Capacitor.nativePromise('TrackerNative', <method>, {...}).
import UIKit
import Capacitor
import ARKit
import RoomPlan
import ReplayKit
import Photos
import CoreImage

/// The app's main screen: the tracker web page, with the TrackerNative plugin added.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TrackerNativePlugin())
    }
}

@objc(TrackerNativePlugin)
public class TrackerNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TrackerNativePlugin"
    public let jsName = "TrackerNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanRoom", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "export3D", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resetScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeScanPhoto", returnType: CAPPluginReturnPromise),
    ]
    // Photos taken during scans, waiting for the page to collect them (one at a time keeps memory low).
    private var scanPhotos: [String: Data] = [:]

    // Rooms scanned one after another share one AR session, so they come out in the same
    // coordinates and line up on the floor plan. A new session starts after resetScan or a restart.
    private var arSession: ARSession?
    private var sessionId = ""
    private var rooms: [CapturedRoom] = []
    private var scanner: RoomScanViewController?

    @objc func info(_ call: CAPPluginCall) {
        call.resolve([
            "platform": "ios",
            "roomScan": RoomCaptureSession.isSupported,
            "roomsThisSession": rooms.count,
            "model": UIDevice.current.model,
            "system": UIDevice.current.systemVersion,
        ])
    }

    @objc func scanRoom(_ call: CAPPluginCall) {
        guard RoomCaptureSession.isSupported else {
            call.reject("This device has no LiDAR scanner. Room scanning needs an iPad Pro (2020 or newer) or an iPhone Pro.", "unsupported")
            return
        }
        let title = call.getString("title") ?? "Scan a room"
        let autoPhotos = call.getBool("autoPhotos") ?? false
        let record = call.getBool("record") ?? false
        DispatchQueue.main.async {
            // One scanner screen (and one AR session) is kept for the whole visit: starting a fresh scanner
            // for each room restarts tracking, and the rooms then land on top of each other.
            if self.arSession == nil || self.scanner == nil {
                self.arSession = ARSession(); self.sessionId = UUID().uuidString
                let vc = RoomScanViewController(arSession: self.arSession!)
                vc.modalPresentationStyle = .fullScreen
                self.scanner = vc
            }
            let vc = self.scanner!
            vc.prepare(title: title, autoPhotos: autoPhotos, record: record)
            vc.onFinish = { room, error in
                var photos: [[String: Any]] = []
                for p in vc.photos {
                    let id = UUID().uuidString
                    self.scanPhotos[id] = p.data
                    photos.append(["id": id, "taken": p.taken.timeIntervalSince1970 * 1000, "w": p.w, "h": p.h])
                }
                vc.photos = []
                let video = vc.videoStatus ?? ""
                if let room = room {
                    self.rooms.append(room)
                    var out = RoomExport.room(room)
                    out["session"] = self.sessionId
                    out["index"] = self.rooms.count - 1
                    call.resolve(["room": out, "photos": photos, "video": video])
                } else if !photos.isEmpty {
                    // Cancelled, but keep the photos that were taken.
                    call.resolve(["photos": photos, "video": video, "cancelled": true, "error": error?.localizedDescription ?? ""])
                } else if let error = error {
                    call.reject(error.localizedDescription, "scan")
                } else {
                    call.reject("Scan cancelled", "cancelled")
                }
            }
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }

    /// Builds one 3D model (USDZ) of the rooms scanned this session and offers to save or share it.
    @objc func export3D(_ call: CAPPluginCall) {
        guard !rooms.isEmpty else { call.reject("No rooms scanned since the app was opened. The 3D model needs this session's scans.", "empty"); return }
        let name = Self.cleanName(call.getString("name") ?? "Floor plan") + ".usdz"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        let rooms = self.rooms
        Task {
            do {
                try? FileManager.default.removeItem(at: url)
                if rooms.count == 1 {
                    try rooms[0].export(to: url)
                } else {
                    let structure = try await StructureBuilder(options: [.beautifyObjects]).capturedStructure(from: rooms)
                    try structure.export(to: url)
                }
                await MainActor.run { self.share(url, call: call) }
            } catch {
                call.reject("Couldn't build the 3D model: \(error.localizedDescription)", "export")
            }
        }
    }

    @objc func resetScan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.arSession?.pause()
            self.arSession = nil
            self.scanner = nil
            self.rooms = []
            call.resolve()
        }
    }

    @objc func takeScanPhoto(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let data = scanPhotos.removeValue(forKey: id) else { call.reject("Photo not found", "missing"); return }
        call.resolve(["data": data.base64EncodedString()])
    }

    @objc func saveFile(_ call: CAPPluginCall) {
        let name = Self.cleanName(call.getString("name") ?? "file")
        guard let data = Data(base64Encoded: call.getString("data") ?? "") else { call.reject("No file data", "save"); return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try? FileManager.default.removeItem(at: url)
            try data.write(to: url)
        } catch { call.reject(error.localizedDescription, "save"); return }
        DispatchQueue.main.async { self.share(url, call: call) }
    }

    private func share(_ url: URL, call: CAPPluginCall) {
        guard let host = bridge?.viewController else { call.reject("No screen to show the share sheet", "save"); return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = host.view
            pop.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        sheet.completionWithItemsHandler = { _, done, _, error in
            if let error = error { call.reject(error.localizedDescription, "save") }
            else if done { call.resolve(["where": "the place you picked"]) }
            else { call.reject("Not saved", "cancelled") }
        }
        host.present(sheet, animated: true)
    }

    static func cleanName(_ s: String) -> String {
        let bad = CharacterSet(charactersIn: "\\/:*?\"<>|")
        let t = s.components(separatedBy: bad).joined(separator: " ").trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? "file" : t
    }
}

/// Full-screen scanner. Walk the room; tap Done to finish, then Save room once the result is shown.
final class RoomScanViewController: UIViewController, RoomCaptureViewDelegate {
    var onFinish: ((CapturedRoom?, Error?) -> Void)?
    private let arSession: ARSession
    private var titleText = ""
    private var captureView: RoomCaptureView!
    private var result: CapturedRoom?
    private var scanning = false
    private var finished = false
    private let doneButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private let titleLabel = UILabel()
    private let shutterButton = UIButton(type: .system)
    private let countLabel = UILabel()
    private let flash = UIView()

    // Photos taken during this room's scan (shutter button, or automatically as you move around).
    struct ScanPhoto { let data: Data; let taken: Date; let w: Int; let h: Int }
    var photos: [ScanPhoto] = []
    var videoStatus: String?
    private var autoPhotos = false
    private var record = false
    private var recording = false
    private var autoTimer: Timer?
    private var lastShot: (pos: simd_float3, dir: simd_float3, at: Date)?
    private let ci = CIContext()
    private let maxAuto = 40

    init(arSession: ARSession) {
        self.arSession = arSession
        super.init(nibName: nil, bundle: nil)
    }

    /// Ready for the next room (the same capture view and AR session are reused).
    func prepare(title: String, autoPhotos: Bool, record: Bool) {
        titleText = title
        result = nil
        scanning = false
        finished = false
        photos = []
        videoStatus = nil
        lastShot = nil
        self.autoPhotos = autoPhotos
        self.record = record
        if isViewLoaded { countLabel.text = "" }
        if isViewLoaded {
            titleLabel.text = title
            doneButton.configuration?.title = "Done"
            doneButton.isEnabled = true
        }
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        captureView = RoomCaptureView(frame: view.bounds, arSession: arSession)
        captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        captureView.delegate = self
        view.addSubview(captureView)

        titleLabel.text = titleText
        titleLabel.textColor = .white
        titleLabel.font = .boldSystemFont(ofSize: 18)
        titleLabel.textAlignment = .center
        style(doneButton, "Done", filled: true)
        style(cancelButton, "Cancel", filled: false)
        doneButton.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)
        var sc = UIButton.Configuration.filled()
        sc.image = UIImage(systemName: "camera.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 26, weight: .semibold))
        sc.cornerStyle = .capsule
        sc.baseBackgroundColor = .white
        sc.baseForegroundColor = .black
        sc.contentInsets = NSDirectionalEdgeInsets(top: 18, leading: 18, bottom: 18, trailing: 18)
        shutterButton.configuration = sc
        shutterButton.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)
        countLabel.textColor = .white
        countLabel.font = .boldSystemFont(ofSize: 15)
        countLabel.textAlignment = .center
        flash.backgroundColor = .white
        flash.alpha = 0
        flash.isUserInteractionEnabled = false
        flash.frame = view.bounds
        flash.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        for v in [titleLabel, doneButton, cancelButton, shutterButton, countLabel] as [UIView] { v.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(v) }
        view.addSubview(flash)
        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            cancelButton.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 16),
            cancelButton.topAnchor.constraint(equalTo: g.topAnchor, constant: 12),
            doneButton.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -16),
            doneButton.topAnchor.constraint(equalTo: g.topAnchor, constant: 12),
            titleLabel.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            titleLabel.centerYAnchor.constraint(equalTo: doneButton.centerYAnchor),
            shutterButton.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            shutterButton.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -24),
            countLabel.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            countLabel.bottomAnchor.constraint(equalTo: shutterButton.topAnchor, constant: -8),
        ])
    }

    private func style(_ b: UIButton, _ text: String, filled: Bool) {
        var c = filled ? UIButton.Configuration.filled() : UIButton.Configuration.gray()
        c.title = text
        c.cornerStyle = .capsule
        c.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 20, bottom: 10, trailing: 20)
        b.configuration = c
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !scanning && !finished && result == nil else { return }
        titleLabel.text = titleText
        countLabel.text = ""
        shutterButton.isHidden = false
        scanning = true
        UIApplication.shared.isIdleTimerDisabled = true
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
        if autoPhotos {
            autoTimer?.invalidate()
            autoTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.autoShot() }
        }
        if record { startRecording() }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        UIApplication.shared.isIdleTimerDisabled = false
    }

    @objc private func doneTapped() {
        if scanning {
            scanning = false
            autoTimer?.invalidate()
            shutterButton.isHidden = true
            // Keep the AR session running so the next room lines up with this one.
            captureView.captureSession.stop(pauseARSession: false)
            doneButton.configuration?.title = "Finishing…"
            doneButton.isEnabled = false
        } else if let room = result {
            finish(room, nil)
        }
    }

    @objc private func cancelTapped() {
        autoTimer?.invalidate()
        if scanning { scanning = false; captureView.captureSession.stop(pauseARSession: false) }
        finish(nil, nil)
    }

    private func finish(_ room: CapturedRoom?, _ error: Error?) {
        guard !finished else { return }
        finished = true
        autoTimer?.invalidate()
        let close = { self.dismiss(animated: true) { self.onFinish?(room, error) } }
        if recording { stopRecording(then: close) } else { close() }
    }

    // MARK: photos from the scanner's own camera feed

    @objc private func shutterTapped() {
        guard scanning else { return }
        takePhoto(auto: false)
    }

    /// Takes a photo when you've moved about a meter or turned about 35° since the last one.
    private func autoShot() {
        guard scanning, let frame = arSession.currentFrame, case .normal = frame.camera.trackingState else { return }
        let autoCount = photos.count
        guard autoCount < maxAuto else { return }
        let t = frame.camera.transform
        let pos = simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let dir = -simd_normalize(simd_float3(t.columns.2.x, t.columns.2.y, t.columns.2.z))
        if let last = lastShot {
            let moved = simd_distance(pos, last.pos), turned = acos(max(-1, min(1, simd_dot(dir, last.dir))))
            if Date().timeIntervalSince(last.at) < 2 || (moved < 1.0 && turned < 0.6) { return }
        }
        takePhoto(auto: true)
    }

    private func takePhoto(auto: Bool) {
        guard let frame = arSession.currentFrame else { return }
        let t = frame.camera.transform
        lastShot = (simd_float3(t.columns.3.x, t.columns.3.y, t.columns.3.z), -simd_normalize(simd_float3(t.columns.2.x, t.columns.2.y, t.columns.2.z)), Date())
        let orientation: CGImagePropertyOrientation
        switch view.window?.windowScene?.interfaceOrientation ?? .portrait {
        case .landscapeLeft: orientation = .down
        case .landscapeRight: orientation = .up
        case .portraitUpsideDown: orientation = .left
        default: orientation = .right
        }
        let buffer = frame.capturedImage
        if !auto {
            flash.alpha = 0.8
            UIView.animate(withDuration: 0.25) { self.flash.alpha = 0 }
        }
        DispatchQueue.global(qos: .userInitiated).async {
            var img = CIImage(cvPixelBuffer: buffer).oriented(orientation)
            let longSide = max(img.extent.width, img.extent.height), scale = min(1, 1600 / longSide)
            if scale < 1 { img = img.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) }
            guard let cg = self.ci.createCGImage(img, from: img.extent),
                  let data = UIImage(cgImage: cg).jpegData(compressionQuality: 0.8) else { return }
            DispatchQueue.main.async {
                self.photos.append(ScanPhoto(data: data, taken: Date(), w: cg.width, h: cg.height))
                self.countLabel.text = "📷 \(self.photos.count)"
            }
        }
    }

    // MARK: video of the scan, saved to the Photos app

    private func startRecording() {
        let rec = RPScreenRecorder.shared()
        guard rec.isAvailable, !rec.isRecording else { videoStatus = "Screen recording isn't available right now."; return }
        rec.isMicrophoneEnabled = false
        rec.startRecording { error in
            DispatchQueue.main.async {
                if let error = error { self.videoStatus = "Video not recorded: \(error.localizedDescription)" }
                else { self.recording = true }
            }
        }
    }

    private func stopRecording(then done: @escaping () -> Void) {
        recording = false
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("scan-\(UUID().uuidString).mp4")
        RPScreenRecorder.shared().stopRecording(withOutput: url) { error in
            if let error = error {
                DispatchQueue.main.async { self.videoStatus = "Video not saved: \(error.localizedDescription)"; done() }
                return
            }
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                guard status == .authorized || status == .limited else {
                    DispatchQueue.main.async { self.videoStatus = "Video not saved: allow Claim Tracker to add to Photos in Settings."; done() }
                    return
                }
                PHPhotoLibrary.shared().performChanges({
                    PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url)
                }) { ok, err in
                    try? FileManager.default.removeItem(at: url)
                    DispatchQueue.main.async {
                        self.videoStatus = ok ? "saved" : "Video not saved: \(err?.localizedDescription ?? "unknown error")"
                        done()
                    }
                }
            }
        }
    }

    // RoomCaptureViewDelegate
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool { true }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        if let error = error, processedResult.walls.isEmpty { finish(nil, error); return }
        result = processedResult
        scanning = false
        doneButton.configuration?.title = "Save room"
        doneButton.isEnabled = true
    }
}

/// Turns a scanned room into plain numbers for the tracker page: a top-down (x, z) view in meters.
enum RoomExport {
    static func r(_ v: Float) -> Double { (Double(v) * 1000).rounded() / 1000 }
    static func xz(_ t: simd_float4x4, _ p: simd_float3) -> [Double] {
        let w = t * simd_float4(p.x, p.y, p.z, 1)
        return [r(w.x), r(w.z)]
    }
    static func segment(_ s: CapturedRoom.Surface) -> [String: Any] {
        let half = s.dimensions.x / 2
        return [
            "a": xz(s.transform, simd_float3(-half, 0, 0)),
            "b": xz(s.transform, simd_float3(half, 0, 0)),
            "w": r(s.dimensions.x),
            "h": r(s.dimensions.y),
            "y": r(s.transform.columns.3.y),
        ]
    }
    static func room(_ room: CapturedRoom) -> [String: Any] {
        var doors: [[String: Any]] = [], windows: [[String: Any]] = [], openings: [[String: Any]] = []
        for d in room.doors {
            var s = segment(d)
            if case .door(let isOpen) = d.category { s["open"] = isOpen }
            doors.append(s)
        }
        for w in room.windows { windows.append(segment(w)) }
        for o in room.openings { openings.append(segment(o)) }
        let objects: [[String: Any]] = room.objects.map { o in
            let hx = o.dimensions.x / 2, hz = o.dimensions.z / 2
            let corners = [simd_float3(-hx, 0, -hz), simd_float3(hx, 0, -hz), simd_float3(hx, 0, hz), simd_float3(-hx, 0, hz)].map { xz(o.transform, $0) }
            return ["type": String(describing: o.category), "corners": corners, "h": r(o.dimensions.y), "y": r(o.transform.columns.3.y - o.dimensions.y / 2)]
        }
        let floors: [[[Double]]] = room.floors.map { f in f.polygonCorners.map { xz(f.transform, $0) } }
        let floorY = room.floors.first.map { r($0.transform.columns.3.y) } ?? room.walls.map { r($0.transform.columns.3.y - $0.dimensions.y / 2) }.min() ?? 0
        let sections: [[String: Any]] = room.sections.map { s in
            ["label": String(describing: s.label), "at": [r(s.center.x), r(s.center.z)]]
        }
        return [
            "walls": room.walls.map(segment),
            "doors": doors, "windows": windows, "openings": openings,
            "objects": objects, "floors": floors, "floorY": floorY, "sections": sections,
        ]
    }
}
