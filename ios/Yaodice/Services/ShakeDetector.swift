import SwiftUI
import UIKit

extension Notification.Name {
    static let deviceDidShake = Notification.Name("YaodiceDeviceDidShakeNotification")
}

extension UIWindow {
    open override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        super.motionEnded(motion, with: event)
        if motion == .motionShake {
            NotificationCenter.default.post(name: .deviceDidShake, object: nil)
        }
    }
}

struct ShakeDetectorModifier: ViewModifier {
    let onShake: () -> Void

    func body(content: Content) -> some View {
        content.onReceive(NotificationCenter.default.publisher(for: .deviceDidShake)) { _ in
            onShake()
        }
    }
}

extension View {
    func onShake(perform action: @escaping () -> Void) -> some View {
        modifier(ShakeDetectorModifier(onShake: action))
    }
}
