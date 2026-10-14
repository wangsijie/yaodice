import SwiftUI

struct DieView: View {
    let value: Int?
    var isRollingActive: Bool = false

    private static let pipLayouts: [Int: Set<Int>] = [
        // 3x3 grid indices:
        // 0 1 2
        // 3 4 5
        // 6 7 8
        1: [4],
        2: [2, 6],
        3: [2, 4, 6],
        4: [0, 2, 6, 8],
        5: [0, 2, 4, 6, 8],
        6: [0, 2, 3, 5, 6, 8]
    ]

    var body: some View {
        Group {
            if let value, (1...6).contains(value) {
                let pips = Self.pipLayouts[value] ?? []
                let pipColor = (value == 1 || value == 4) ? AppTheme.primary : AppTheme.bg

                VStack(spacing: 3) {
                    ForEach(0..<3, id: \.self) { row in
                        HStack(spacing: 3) {
                            ForEach(0..<3, id: \.self) { col in
                                let index = row * 3 + col
                                Circle()
                                    .fill(pips.contains(index) ? pipColor : Color.clear)
                                    .frame(width: 9.5, height: 9.5)
                            }
                        }
                    }
                }
                .padding(7)
                .frame(width: 48, height: 48)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.white)
                )
                .shadow(
                    color: isRollingActive ? AppTheme.warning.opacity(0.45) : Color.black.opacity(0.35),
                    radius: isRollingActive ? 7 : 5,
                    x: 0,
                    y: 3
                )
                .offset(y: isRollingActive ? -4 : 0)
                .rotationEffect(.degrees(isRollingActive ? 6 : 0))
                .scaleEffect(isRollingActive ? 1.07 : 1.0)
                .animation(.easeInOut(duration: 0.08), value: isRollingActive)
            } else {
                Text("?")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(AppTheme.textDim)
                    .frame(width: 48, height: 48)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(AppTheme.accent)
                    )
                    .shadow(color: Color.black.opacity(0.35), radius: 5, x: 0, y: 3)
            }
        }
    }
}

struct DiceRowView: View {
    let dice: [Int]?
    var isRolling: Bool = false
    var rollingValues: [Int] = []
    var rollingActiveIndex: Int = 0

    var body: some View {
        HStack(spacing: 8) {
            if isRolling, rollingValues.count == 5 {
                ForEach(0..<5, id: \.self) { index in
                    DieView(
                        value: rollingValues[index],
                        isRollingActive: index == rollingActiveIndex
                    )
                }
            } else if let dice, !dice.isEmpty {
                ForEach(Array(dice.enumerated()), id: \.offset) { _, value in
                    DieView(value: value)
                }
            } else {
                ForEach(0..<5, id: \.self) { _ in
                    DieView(value: nil)
                }
            }
        }
        .padding(.vertical, 8)
    }
}
