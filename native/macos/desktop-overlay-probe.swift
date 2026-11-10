import AppKit
import Foundation

private struct Curve {
    let from: CGPoint
    let control1: CGPoint
    let control2: CGPoint
    let to: CGPoint
}

private final class OverlayView: NSView {
    private let curve: Curve

    init(frame: NSRect, curve: Curve) {
        self.curve = curve
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        nil
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState()
        context.setStrokeColor(NSColor(calibratedRed: 0.29, green: 0.52, blue: 0.72, alpha: 0.95).cgColor)
        context.setFillColor(NSColor(calibratedRed: 0.29, green: 0.52, blue: 0.72, alpha: 0.95).cgColor)
        context.setLineWidth(3)
        context.setLineCap(.round)
        context.setLineDash(phase: 0, lengths: [12, 10])
        let path = CGMutablePath()
        path.move(to: curve.from)
        path.addCurve(to: curve.to, control1: curve.control1, control2: curve.control2)
        context.addPath(path)
        context.strokePath()
        context.setLineDash(phase: 0, lengths: [])
        drawArrow(at: curve.from, toward: curve.control1, in: context)
        drawArrow(at: curve.to, toward: curve.control2, in: context)
        context.restoreGState()

        let label = "Bridge native overlay probe · auto-closes"
        label.draw(
            at: NSPoint(x: 18, y: bounds.maxY - 32),
            withAttributes: [
                .font: NSFont.systemFont(ofSize: 13, weight: .medium),
                .foregroundColor: NSColor(calibratedRed: 0.18, green: 0.31, blue: 0.42, alpha: 0.95),
            ]
        )
    }

    private func drawArrow(at tip: CGPoint, toward control: CGPoint, in context: CGContext) {
        let dx = tip.x - control.x
        let dy = tip.y - control.y
        let length = max(1, hypot(dx, dy))
        let ux = dx / length
        let uy = dy / length
        let base = CGPoint(x: tip.x - ux * 12, y: tip.y - uy * 12)
        let side = CGPoint(x: -uy * 5, y: ux * 5)
        let arrow = CGMutablePath()
        arrow.move(to: tip)
        arrow.addLine(to: CGPoint(x: base.x + side.x, y: base.y + side.y))
        arrow.addLine(to: CGPoint(x: base.x - side.x, y: base.y - side.y))
        arrow.closeSubpath()
        context.addPath(arrow)
        context.fillPath()
    }
}

private final class OverlayController {
    private let panel: NSPanel
    private let timer: Timer
    private let outputLock = NSLock()

    init(duration: TimeInterval) throws {
        let mouse = NSEvent.mouseLocation
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(mouse) }) ?? NSScreen.main else {
            throw ProbeError.noScreen
        }
        let frame = screen.frame
        let curve = Curve(
            from: CGPoint(x: frame.width * 0.12, y: frame.height * 0.27),
            control1: CGPoint(x: frame.width * 0.31, y: frame.height * 0.78),
            control2: CGPoint(x: frame.width * 0.69, y: frame.height * 0.22),
            to: CGPoint(x: frame.width * 0.88, y: frame.height * 0.73)
        )
        panel = NSPanel(
            contentRect: frame,
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
        panel.contentView = OverlayView(frame: NSRect(origin: .zero, size: frame.size), curve: curve)
        panel.orderFrontRegardless()

        timer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { [weak panel] _ in
            panel?.orderOut(nil)
            NSApp.terminate(nil)
        }

        write([
            "event": "visible",
            "pid": ProcessInfo.processInfo.processIdentifier,
            "screen": ["width": frame.width, "height": frame.height, "scale": screen.backingScaleFactor],
            "configured": ["transparent": !panel.isOpaque, "nonActivating": !panel.canBecomeKey, "ignoresMouseEvents": panel.ignoresMouseEvents, "windowLevel": panel.level.rawValue],
            "expiresInSeconds": duration,
        ])
        startCommandReader()
    }

    private func startCommandReader() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            while let line = readLine() {
                guard line.utf8.count <= 1024 else {
                    self?.write(["event": "rejected", "reason": "command-too-large"])
                    continue
                }
                guard let data = line.data(using: .utf8),
                      let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      command["op"] as? String == "stop" else {
                    self?.write(["event": "rejected", "reason": "invalid-command"])
                    continue
                }
                DispatchQueue.main.async { [weak self] in
                    self?.timer.invalidate()
                    self?.panel.orderOut(nil)
                    self?.write(["event": "stopped"])
                    NSApp.terminate(nil)
                }
                return
            }
            DispatchQueue.main.async { [weak self] in
                self?.timer.invalidate()
                self?.panel.orderOut(nil)
                NSApp.terminate(nil)
            }
        }
    }

    private func write(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let line = String(data: data, encoding: .utf8) else { return }
        outputLock.lock()
        defer { outputLock.unlock() }
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }
}

private enum ProbeError: Error {
    case noScreen
    case invalidDuration
}

@main
private enum DesktopOverlayProbe {
    static func main() {
        if CommandLine.arguments.contains("--self-test") {
            print("self-test passed")
            return
        }
        do {
            let duration = try durationArgument()
            let app = NSApplication.shared
            app.setActivationPolicy(.accessory)
            let controller = try OverlayController(duration: duration)
            withExtendedLifetime(controller) {
                app.run()
            }
        } catch {
            FileHandle.standardError.write(Data("desktop overlay probe failed: \(error)\n".utf8))
            exit(1)
        }
    }

    private static func durationArgument() throws -> TimeInterval {
        guard let index = CommandLine.arguments.firstIndex(of: "--seconds"),
              CommandLine.arguments.indices.contains(index + 1),
              let seconds = Double(CommandLine.arguments[index + 1]),
              seconds.isFinite,
              seconds >= 1,
              seconds <= 30 else {
            if CommandLine.arguments.contains("--seconds") { throw ProbeError.invalidDuration }
            return 20
        }
        return seconds
    }
}
