import SwiftUI

enum AppTheme {
    static let bg = Color(red: 0x1a / 255.0, green: 0x1a / 255.0, blue: 0x2e / 255.0)          // #1a1a2e
    static let surface = Color(red: 0x16 / 255.0, green: 0x21 / 255.0, blue: 0x3e / 255.0)     // #16213e
    static let primary = Color(red: 0xe9 / 255.0, green: 0x45 / 255.0, blue: 0x60 / 255.0)     // #e94560
    static let primaryDark = Color(red: 0xc7 / 255.0, green: 0x3e / 255.0, blue: 0x54 / 255.0) // #c73e54
    static let accent = Color(red: 0x0f / 255.0, green: 0x34 / 255.0, blue: 0x60 / 255.0)      // #0f3460
    static let text = Color(red: 0xee / 255.0, green: 0xee / 255.0, blue: 0xee / 255.0)        // #eeeeee
    static let textDim = Color(red: 0x99 / 255.0, green: 0x99 / 255.0, blue: 0x99 / 255.0)     // #999999
    static let success = Color(red: 0x4a / 255.0, green: 0xde / 255.0, blue: 0x80 / 255.0)     // #4ade80
    static let warning = Color(red: 0xfb / 255.0, green: 0xbf / 255.0, blue: 0x24 / 255.0)     // #fbbf24
    static let danger = Color(red: 0x7f / 255.0, green: 0x1d / 255.0, blue: 0x1d / 255.0)      // #7f1d1d
    static let dangerLight = Color(red: 1.0, green: 0x6b / 255.0, blue: 0x6b / 255.0)          // #ff6b6b
    static let cornerRadius: CGFloat = 12
}

struct PrimaryButtonStyle: ButtonStyle {
    var background: Color = AppTheme.primary
    var foreground: Color = .white
    var fullWidth: Bool = true
    var verticalPadding: CGFloat = 14
    var horizontalPadding: CGFloat = 28
    var fontSize: CGFloat = 17

    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: fontSize, weight: .semibold))
            .foregroundStyle(foreground)
            .padding(.vertical, verticalPadding)
            .padding(.horizontal, horizontalPadding)
            .frame(maxWidth: fullWidth ? 320 : nil)
            .background(
                RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
                    .fill(background)
            )
            .scaleEffect(configuration.isPressed && isEnabled ? 0.97 : 1.0)
            .opacity(isEnabled ? (configuration.isPressed ? 0.9 : 1.0) : 0.4)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

struct SectionLabel: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .medium))
            .tracking(1)
            .foregroundStyle(AppTheme.textDim)
            .frame(maxWidth: 320, alignment: .leading)
    }
}

struct TagBadge: View {
    let text: String
    let background: Color
    var foreground: Color = .white

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(foreground)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(background)
            )
    }
}
