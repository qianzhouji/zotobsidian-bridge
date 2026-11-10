import AppKit
import Darwin
import Foundation

private let protocolVersion = 1
private let maximumMessageBytes = 1_048_576
private let maximumDisplays = 16
private let maximumCurves = 512
private let animationFrameInterval: TimeInterval = 1.0 / 60.0
private let maximumAnimationDuration: TimeInterval = 0.12

private func renderStatus(curveCount: Int) -> String {
    curveCount > 0 ? "rendered" : "cleared"
}

private func shouldShowOverlay(
    requestedVisible: Bool,
    parentApplicationActive: Bool
) -> Bool {
    requestedVisible && parentApplicationActive
}

private struct Point {
    let x: CGFloat
    let y: CGFloat
}

private struct Curve {
    let id: String
    let from: Point
    let control1: Point
    let control2: Point
    let to: Point
    let startArrow: Bool
    let endArrow: Bool
}

private func interpolate(_ from: Point, _ to: Point, _ progress: CGFloat) -> Point {
    Point(
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress
    )
}

private func interpolate(_ from: Curve, _ to: Curve, _ progress: CGFloat) -> Curve {
    Curve(
        id: to.id,
        from: interpolate(from.from, to.from, progress),
        control1: interpolate(from.control1, to.control1, progress),
        control2: interpolate(from.control2, to.control2, progress),
        to: interpolate(from.to, to.to, progress),
        startArrow: to.startArrow,
        endArrow: to.endArrow
    )
}

private func curvesMatch(_ left: [Curve], _ right: [Curve]) -> Bool {
    guard left.count == right.count else { return false }
    let rightByID = Dictionary(uniqueKeysWithValues: right.map { ($0.id, $0) })
    return left.allSatisfy { curve in
        guard let matching = rightByID[curve.id] else { return false }
        return abs(curve.from.x - matching.from.x) < 0.1 &&
            abs(curve.from.y - matching.from.y) < 0.1 &&
            abs(curve.control1.x - matching.control1.x) < 0.1 &&
            abs(curve.control1.y - matching.control1.y) < 0.1 &&
            abs(curve.control2.x - matching.control2.x) < 0.1 &&
            abs(curve.control2.y - matching.control2.y) < 0.1 &&
            abs(curve.to.x - matching.to.x) < 0.1 &&
            abs(curve.to.y - matching.to.y) < 0.1 &&
            curve.startArrow == matching.startArrow &&
            curve.endArrow == matching.endArrow
    }
}

private func shouldSkipCurveUpdate(
    sameRect: Bool,
    isAnimating: Bool,
    currentCurves: [Curve],
    animationTargets: [Curve],
    incomingCurves: [Curve]
) -> Bool {
    let currentTargets = isAnimating ? animationTargets : currentCurves
    return sameRect && curvesMatch(currentTargets, incomingCurves)
}

private struct LogicalRect {
    let left: CGFloat
    let top: CGFloat
    let width: CGFloat
    let height: CGFloat
}

private struct DisplaySnapshot {
    let id: String
    let rect: LogicalRect
    let visible: Bool
    let curves: [Curve]
}

private final class OverlayView: NSView {
    private var logicalRect: LogicalRect
    private var curves: [Curve] = []
    private var animationStarts: [String: Curve] = [:]
    private var animationTargets: [Curve] = []
    private var animationStartedAt: TimeInterval = 0
    private var animationDuration: TimeInterval = 0
    private var lastUpdateAt: TimeInterval?

    var isAnimating: Bool { animationDuration > 0 }

    init(frame: NSRect, logicalRect: LogicalRect) {
        self.logicalRect = logicalRect
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    func update(logicalRect: LogicalRect, curves: [Curve]) {
        let now = ProcessInfo.processInfo.systemUptime
        let displayed = presentationCurves(at: now)
        let oldRect = self.logicalRect
        let canAnimate = sameRect(oldRect, logicalRect) && !displayed.isEmpty
        if shouldSkipCurveUpdate(
            sameRect: sameRect(oldRect, logicalRect),
            isAnimating: animationDuration > 0,
            currentCurves: self.curves,
            animationTargets: animationTargets,
            incomingCurves: curves
        ) {
            self.logicalRect = logicalRect
            self.curves = displayed
            lastUpdateAt = now
            return
        }
        var dirtyRects = displayed.map(curveBounds)
        self.logicalRect = logicalRect
        self.curves = displayed
        let interval = lastUpdateAt.map { now - $0 } ?? animationFrameInterval
        lastUpdateAt = now

        let targetByID = Dictionary(uniqueKeysWithValues: curves.map { ($0.id, $0) })
        let startByID = Dictionary(uniqueKeysWithValues: displayed.map { ($0.id, $0) })
        let hasMovingCurve = curves.contains { target in
            guard let start = startByID[target.id] else { return false }
            return !sameCurve(start, target)
        }
        if canAnimate && hasMovingCurve {
            animationStarts = startByID
            animationTargets = curves
            animationStartedAt = now
            animationDuration = min(max(interval, animationFrameInterval), maximumAnimationDuration)
        } else {
            animationStarts.removeAll(keepingCapacity: true)
            animationTargets.removeAll(keepingCapacity: true)
            animationDuration = 0
            self.curves = curves
        }
        dirtyRects.append(contentsOf: curves.map(curveBounds))
        invalidate(dirtyRects)
    }

    @discardableResult
    func advanceAnimation(at now: TimeInterval = ProcessInfo.processInfo.systemUptime) -> Bool {
        guard animationDuration > 0 else { return false }
        let progress = min(1, max(0, (now - animationStartedAt) / animationDuration))
        let previous = curves
        curves = animationTargets.map { target in
            guard let start = animationStarts[target.id] else { return target }
            return interpolate(start, target, CGFloat(progress))
        }
        invalidate(previous.map(curveBounds) + curves.map(curveBounds))
        if progress >= 1 {
            curves = animationTargets
            animationStarts.removeAll(keepingCapacity: true)
            animationTargets.removeAll(keepingCapacity: true)
            animationDuration = 0
            return false
        }
        return true
    }

    private func presentationCurves(at now: TimeInterval) -> [Curve] {
        guard animationDuration > 0 else { return curves }
        let progress = CGFloat(min(1, max(0, (now - animationStartedAt) / animationDuration)))
        return animationTargets.map { target in
            guard let start = animationStarts[target.id] else { return target }
            return interpolate(start, target, progress)
        }
    }

    private func invalidate(_ rects: [NSRect]) {
        for rect in rects {
            let clipped = rect.intersection(bounds)
            if !clipped.isNull && !clipped.isEmpty { setNeedsDisplay(clipped) }
        }
    }

    private func sameRect(_ left: LogicalRect, _ right: LogicalRect) -> Bool {
        abs(left.left - right.left) < 0.5 &&
            abs(left.top - right.top) < 0.5 &&
            abs(left.width - right.width) < 0.5 &&
            abs(left.height - right.height) < 0.5
    }

    private func sameCurve(_ left: Curve, _ right: Curve) -> Bool {
        left.id == right.id &&
            samePoint(left.from, right.from) &&
            samePoint(left.control1, right.control1) &&
            samePoint(left.control2, right.control2) &&
            samePoint(left.to, right.to) &&
            left.startArrow == right.startArrow &&
            left.endArrow == right.endArrow
    }

    private func samePoint(_ left: Point, _ right: Point) -> Bool {
        abs(left.x - right.x) < 0.1 && abs(left.y - right.y) < 0.1
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState()
        context.setStrokeColor(NSColor(calibratedRed: 0x78 / 255, green: 0xad / 255, blue: 0xd2 / 255, alpha: 0.72).cgColor)
        context.setFillColor(NSColor(calibratedRed: 0x78 / 255, green: 0xad / 255, blue: 0xd2 / 255, alpha: 0.72).cgColor)
        context.setLineWidth(1.5)
        context.setLineCap(.round)
        context.setLineDash(phase: 0, lengths: [6, 5])

        for curve in curves {
            guard curveBounds(curve).intersects(dirtyRect) else { continue }
            let from = local(curve.from)
            let control1 = local(curve.control1)
            let control2 = local(curve.control2)
            let to = local(curve.to)
            let path = CGMutablePath()
            path.move(to: from)
            path.addCurve(to: to, control1: control1, control2: control2)
            context.addPath(path)
            context.strokePath()
            context.setLineDash(phase: 0, lengths: [])
            if curve.startArrow { drawArrow(at: from, toward: control1, in: context) }
            if curve.endArrow { drawArrow(at: to, toward: control2, in: context) }
            context.setLineDash(phase: 0, lengths: [6, 5])
        }

        context.restoreGState()
    }

    private func local(_ point: Point) -> CGPoint {
        CGPoint(
            x: (point.x - logicalRect.left) * bounds.width / logicalRect.width,
            y: bounds.height - (point.y - logicalRect.top) * bounds.height / logicalRect.height
        )
    }

    private func curveBounds(_ curve: Curve) -> NSRect {
        let points = [curve.from, curve.control1, curve.control2, curve.to]
            .map(local)
        let minX = points.map(\.x).min() ?? 0
        let maxX = points.map(\.x).max() ?? 0
        let minY = points.map(\.y).min() ?? 0
        let maxY = points.map(\.y).max() ?? 0
        let padding: CGFloat = 16
        return NSRect(
            x: minX - padding,
            y: minY - padding,
            width: max(1, maxX - minX + padding * 2),
            height: max(1, maxY - minY + padding * 2)
        )
    }

    private func drawArrow(at tip: CGPoint, toward control: CGPoint, in context: CGContext) {
        let dx = tip.x - control.x
        let dy = tip.y - control.y
        let length = max(1, hypot(dx, dy))
        let ux = dx / length
        let uy = dy / length
        let base = CGPoint(x: tip.x - ux * 10, y: tip.y - uy * 10)
        let side = CGPoint(x: -uy * 4.5, y: ux * 4.5)
        let arrow = CGMutablePath()
        arrow.move(to: tip)
        arrow.addLine(to: CGPoint(x: base.x + side.x, y: base.y + side.y))
        arrow.addLine(to: CGPoint(x: base.x - side.x, y: base.y - side.y))
        arrow.closeSubpath()
        context.addPath(arrow)
        context.fillPath()
    }
}

private final class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

private final class DisplaySurface {
    let panel: OverlayPanel
    let view: OverlayView
    private var requestedVisible = false
    private var parentApplicationActive = false

    init(screen: NSScreen, logicalRect: LogicalRect) {
        let panel = OverlayPanel(
            contentRect: screen.frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.animationBehavior = .none
        let view = OverlayView(frame: NSRect(origin: .zero, size: screen.frame.size), logicalRect: logicalRect)
        panel.contentView = view
        self.panel = panel
        self.view = view
    }

    func setRequestedVisible(_ visible: Bool) {
        requestedVisible = visible
        syncVisibility()
    }

    func setParentApplicationActive(_ active: Bool) {
        parentApplicationActive = active
        syncVisibility()
    }

    private func syncVisibility() {
        guard shouldShowOverlay(
            requestedVisible: requestedVisible,
            parentApplicationActive: parentApplicationActive
        ) else {
            if panel.isVisible { panel.orderOut(nil) }
            return
        }
        if !panel.isVisible { panel.orderFrontRegardless() }
    }
}

private final class OverlayController {
    private let parentPID: pid_t
    private let outputLock = NSLock()
    private var surfaces: [String: DisplaySurface] = [:]
    private var closed = false
    private var animationTimer: Timer?
    private var parentApplicationActive = false
    private var workspaceObservers: [NSObjectProtocol] = []

    init(parentPID: pid_t) {
        self.parentPID = parentPID
    }

    func start() {
        observeWorkspaceActivation()
        setParentApplicationActive(isParentApplicationFrontmost())
        write([
            "type": "ready",
            "protocol": protocolVersion,
            "pid": ProcessInfo.processInfo.processIdentifier,
            "parentPID": parentPID,
            "capabilities": [
                "transparent": true,
                "nonActivating": true,
                "controlledZOrder": true,
                "systemMousePassthrough": true,
                "multiDisplay": true,
                "tracksNativeDrag": true
            ],
            "screens": NSScreen.screens.map(screenDescriptor)
        ])
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.readCommands()
        }
        Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            guard let self, !self.closed else { return }
            if kill(self.parentPID, 0) != 0 && errno == ESRCH {
                self.shutdown(reason: "parent-exited")
            }
        }
    }

    private func readCommands() {
        var frame = Data()
        var discardingOversizedFrame = false
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = buffer.withUnsafeMutableBytes { bytes in
                Darwin.read(STDIN_FILENO, bytes.baseAddress, bytes.count)
            }
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                write(["type": "error", "code": "input-read-failed"])
                break
            }
            for byte in buffer.prefix(count) {
                if byte == 0x0A {
                    if discardingOversizedFrame {
                        write(["type": "error", "code": "message-too-large"])
                        discardingOversizedFrame = false
                    } else {
                        handleCommandFrame(frame)
                    }
                    frame.removeAll(keepingCapacity: true)
                } else if !discardingOversizedFrame {
                    guard frame.count < maximumMessageBytes else {
                        frame.removeAll(keepingCapacity: true)
                        discardingOversizedFrame = true
                        continue
                    }
                    frame.append(byte)
                }
            }
        }
        DispatchQueue.main.async { [weak self] in self?.shutdown(reason: "stdin-closed") }
    }

    private func handleCommandFrame(_ data: Data) {
        guard let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            write(["type": "error", "code": "invalid-message"])
            return
        }
        DispatchQueue.main.async { [weak self] in self?.handle(message) }
    }

    private func handle(_ message: [String: Any]) {
        guard !closed else { return }
        guard message["protocol"] as? Int == protocolVersion,
              let type = message["type"] as? String else {
            write(["type": "error", "code": "protocol-mismatch"])
            return
        }

        switch type {
        case "sync":
            guard let generation = message["generation"] as? Int,
                  let rawDisplays = message["displays"] as? [[String: Any]],
                  rawDisplays.count <= maximumDisplays,
                  let snapshots = parseSnapshots(rawDisplays) else {
                write(["type": "error", "code": "invalid-snapshot"])
                return
            }
            guard apply(snapshots) else {
                write([
                    "type": "error",
                    "code": "display-mapping-failed",
                    "generation": generation
                ])
                return
            }
            let curveCount = parentApplicationActive
                ? snapshots
                    .filter { $0.visible }
                    .reduce(0) { $0 + $1.curves.count }
                : 0
            write([
                "type": "ack",
                "operation": "sync",
                "generation": generation,
                "status": renderStatus(curveCount: curveCount),
                "activeWindows": surfaces.count,
                "visibleWindows": surfaces.values.filter { $0.panel.isVisible }.count,
                "curveCount": curveCount
            ])
        case "ping":
            write(["type": "pong", "nonce": message["nonce"] ?? NSNull()])
        case "shutdown":
            write(["type": "ack", "operation": "shutdown"])
            shutdown(reason: "requested")
        default:
            write(["type": "error", "code": "unknown-operation"])
        }
    }

    private func parseSnapshots(_ values: [[String: Any]]) -> [DisplaySnapshot]? {
        var result: [DisplaySnapshot] = []
        var totalCurves = 0
        var identifiers = Set<String>()
        for value in values {
            guard let id = value["id"] as? String,
                  !id.isEmpty, id.utf8.count <= 512,
                  identifiers.insert(id).inserted,
                  let rawRect = value["rect"] as? [String: Any],
                  let rect = parseRect(rawRect),
                  let visible = value["visible"] as? Bool,
                  let rawCurves = value["curves"] as? [[String: Any]],
                  rawCurves.count <= 256 else { return nil }
            totalCurves += rawCurves.count
            if totalCurves > maximumCurves { return nil }
            var curves: [Curve] = []
            for rawCurve in rawCurves {
                guard let curve = parseCurve(rawCurve) else { return nil }
                curves.append(curve)
            }
            result.append(DisplaySnapshot(id: id, rect: rect, visible: visible, curves: curves))
        }
        return result
    }

    private func parseRect(_ value: [String: Any]) -> LogicalRect? {
        guard let left = number(value["left"]), let top = number(value["top"]),
              let width = number(value["width"]), let height = number(value["height"]),
              abs(left) <= 10_000_000, abs(top) <= 10_000_000,
              width > 0, height > 0, width <= 32_768, height <= 32_768,
              abs(left + width) <= 10_000_000, abs(top + height) <= 10_000_000 else { return nil }
        return LogicalRect(left: left, top: top, width: width, height: height)
    }

    private func parseCurve(_ value: [String: Any]) -> Curve? {
        guard let id = value["id"] as? String, !id.isEmpty, id.utf8.count <= 512,
              let from = parsePoint(value["from"]), let control1 = parsePoint(value["control1"]),
              let control2 = parsePoint(value["control2"]), let to = parsePoint(value["to"]),
              let startArrow = value["startArrow"] as? Bool,
              let endArrow = value["endArrow"] as? Bool else { return nil }
        return Curve(id: id, from: from, control1: control1, control2: control2, to: to, startArrow: startArrow, endArrow: endArrow)
    }

    private func parsePoint(_ value: Any?) -> Point? {
        guard let object = value as? [String: Any],
              let x = number(object["x"]), let y = number(object["y"]),
              abs(x) <= 10_000_000, abs(y) <= 10_000_000 else { return nil }
        return Point(x: x, y: y)
    }

    private func number(_ value: Any?) -> CGFloat? {
        guard let number = value as? NSNumber else { return nil }
        let result = CGFloat(number.doubleValue)
        return result.isFinite ? result : nil
    }

    private func apply(_ snapshots: [DisplaySnapshot]) -> Bool {
        let mainTop = NSScreen.main?.frame.maxY ?? 0
        var resolved: [(DisplaySnapshot, NSScreen)] = []
        for snapshot in snapshots {
            let matches = NSScreen.screens.filter { screen in
                let frame = screen.frame
                let expected = LogicalRect(
                    left: frame.minX,
                    top: mainTop - frame.maxY,
                    width: frame.width,
                    height: frame.height
                )
                return abs(expected.left - snapshot.rect.left) <= 2 &&
                    abs(expected.top - snapshot.rect.top) <= 2 &&
                    abs(expected.width - snapshot.rect.width) <= 2 &&
                    abs(expected.height - snapshot.rect.height) <= 2
            }
            guard matches.count == 1, let screen = matches.first else { return false }
            resolved.append((snapshot, screen))
        }

        let nextIDs = Set(resolved.map { $0.0.id })
        for (id, surface) in surfaces where !nextIDs.contains(id) {
            surface.panel.orderOut(nil)
            surfaces.removeValue(forKey: id)
        }
        for (snapshot, screen) in resolved {
            guard snapshot.visible, !snapshot.curves.isEmpty else {
                surfaces[snapshot.id]?.setRequestedVisible(false)
                continue
            }
            let surface = surfaces[snapshot.id] ?? DisplaySurface(screen: screen, logicalRect: snapshot.rect)
            surfaces[snapshot.id] = surface
            surface.setParentApplicationActive(parentApplicationActive)
            surface.view.update(logicalRect: snapshot.rect, curves: snapshot.curves)
            if surface.panel.frame != screen.frame {
                surface.panel.setFrame(screen.frame, display: false)
            }
            surface.setRequestedVisible(true)
        }
        startAnimationTimerIfNeeded()
        return true
    }

    private func startAnimationTimerIfNeeded() {
        guard animationTimer == nil,
              surfaces.values.contains(where: { $0.view.isAnimating }) else { return }
        let timer = Timer(timeInterval: animationFrameInterval, repeats: true) { [weak self] _ in
            self?.advanceAnimations()
        }
        animationTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func advanceAnimations() {
        let stillAnimating = surfaces.values.reduce(false) { active, surface in
            surface.view.advanceAnimation() || active
        }
        if !stillAnimating {
            animationTimer?.invalidate()
            animationTimer = nil
        }
    }

    private func screenDescriptor(_ screen: NSScreen) -> [String: Any] {
        let frame = screen.frame
        let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        return [
            "id": number?.stringValue ?? "unknown",
            "left": frame.minX,
            "top": (NSScreen.main?.frame.maxY ?? 0) - frame.maxY,
            "width": frame.width,
            "height": frame.height,
            "scale": screen.backingScaleFactor
        ]
    }

    private func observeWorkspaceActivation() {
        let center = NSWorkspace.shared.notificationCenter
        workspaceObservers.append(
            center.addObserver(
                forName: NSWorkspace.didActivateApplicationNotification,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                guard let self else { return }
                let application = notification.userInfo?[
                    NSWorkspace.applicationUserInfoKey
                ] as? NSRunningApplication
                self.setParentApplicationActive(
                    application?.processIdentifier == self.parentPID
                )
            }
        )
        workspaceObservers.append(
            center.addObserver(
                forName: NSWorkspace.didDeactivateApplicationNotification,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                guard let self else { return }
                let application = notification.userInfo?[
                    NSWorkspace.applicationUserInfoKey
                ] as? NSRunningApplication
                if application?.processIdentifier == self.parentPID {
                    self.setParentApplicationActive(false)
                }
            }
        )
    }

    private func isParentApplicationFrontmost() -> Bool {
        NSWorkspace.shared.frontmostApplication?.processIdentifier == parentPID
    }

    private func setParentApplicationActive(_ active: Bool) {
        guard parentApplicationActive != active else { return }
        parentApplicationActive = active
        for surface in surfaces.values {
            surface.setParentApplicationActive(active)
        }
    }

    private func shutdown(reason: String) {
        guard !closed else { return }
        closed = true
        animationTimer?.invalidate()
        animationTimer = nil
        let center = NSWorkspace.shared.notificationCenter
        for observer in workspaceObservers {
            center.removeObserver(observer)
        }
        workspaceObservers.removeAll()
        for surface in surfaces.values { surface.panel.orderOut(nil) }
        surfaces.removeAll()
        if reason == "stdin-closed" || reason == "parent-exited" {
            write(["type": "stopped", "reason": reason])
        }
        NSApp.terminate(nil)
    }

    private func write(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let line = String(data: data, encoding: .utf8) else { return }
        outputLock.lock()
        defer { outputLock.unlock() }
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }
}

@main
private enum DesktopOverlayHelper {
    static func main() {
        if CommandLine.arguments.contains("--self-test") {
            guard renderStatus(curveCount: 0) == "cleared",
                  renderStatus(curveCount: 1) == "rendered",
                  !shouldShowOverlay(
                      requestedVisible: true,
                      parentApplicationActive: false
                  ),
                  shouldShowOverlay(
                      requestedVisible: true,
                      parentApplicationActive: true
                  ),
                  !shouldShowOverlay(
                      requestedVisible: false,
                      parentApplicationActive: true
                  ) else {
                FileHandle.standardError.write(
                    Data("render status self-test failed\n".utf8)
                )
                exit(1)
            }
            let start = Curve(
                id: "edge",
                from: Point(x: 0, y: 10),
                control1: Point(x: 10, y: 20),
                control2: Point(x: 20, y: 30),
                to: Point(x: 30, y: 40),
                startArrow: false,
                endArrow: false
            )
            let target = Curve(
                id: "edge",
                from: Point(x: 20, y: 30),
                control1: Point(x: 30, y: 40),
                control2: Point(x: 40, y: 50),
                to: Point(x: 50, y: 60),
                startArrow: true,
                endArrow: true
            )
            guard !shouldSkipCurveUpdate(
                      sameRect: true,
                      isAnimating: false,
                      currentCurves: [],
                      animationTargets: [],
                      incomingCurves: [target]
                  ),
                  shouldSkipCurveUpdate(
                      sameRect: true,
                      isAnimating: false,
                      currentCurves: [target],
                      animationTargets: [],
                      incomingCurves: [target]
                  ),
                  shouldSkipCurveUpdate(
                      sameRect: true,
                      isAnimating: true,
                      currentCurves: [start],
                      animationTargets: [target],
                      incomingCurves: [target]
                  ) else {
                FileHandle.standardError.write(
                    Data("first-draw invalidation self-test failed\n".utf8)
                )
                exit(1)
            }
            let middle = interpolate(start, target, 0.5)
            guard middle.from.x == 10, middle.from.y == 20,
                  middle.to.x == 40, middle.to.y == 50,
                  middle.startArrow, middle.endArrow else {
                FileHandle.standardError.write(Data("interpolation self-test failed\n".utf8))
                exit(1)
            }
            print("self-test passed")
            return
        }
        guard CommandLine.arguments.contains("--daemon"),
              let parentPID = integerArgument("--parent-pid"), parentPID > 1 else {
            FileHandle.standardError.write(Data("usage: --daemon --parent-pid <pid>\n".utf8))
            exit(2)
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let controller = OverlayController(parentPID: pid_t(parentPID))
        controller.start()
        withExtendedLifetime(controller) { app.run() }
    }

    private static func integerArgument(_ key: String) -> Int32? {
        guard let index = CommandLine.arguments.firstIndex(of: key),
              CommandLine.arguments.indices.contains(index + 1) else { return nil }
        return Int32(CommandLine.arguments[index + 1])
    }
}
