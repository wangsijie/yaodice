import SwiftUI

struct HomeView: View {
    @Bindable var store: GameStore
    @FocusState private var isCodeFieldFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: 24)

            Text("🎲")
                .font(.system(size: 64))
                .padding(.bottom, 16)

            Text("摇骰子")
                .font(.system(size: 32, weight: .bold))
                .foregroundStyle(AppTheme.text)
                .padding(.bottom, 8)

            Text("多人在线 · 聚会必备")
                .font(.system(size: 15))
                .foregroundStyle(AppTheme.textDim)
                .padding(.bottom, 32)

            Button {
                isCodeFieldFocused = false
                Task { await store.createRoom() }
            } label: {
                Text(store.roomActionPending ? "请稍候..." : "创建房间")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(store.roomActionPending)

            // Divider
            HStack(spacing: 12) {
                Rectangle()
                    .fill(AppTheme.accent)
                    .frame(height: 1)
                Text("或加入房间")
                    .font(.system(size: 14))
                    .foregroundStyle(AppTheme.textDim)
                Rectangle()
                    .fill(AppTheme.accent)
                    .frame(height: 1)
            }
            .frame(maxWidth: 320)
            .padding(.vertical, 16)

            TextField(
                "",
                text: $store.roomCodeInput,
                prompt: Text("0000").foregroundStyle(AppTheme.textDim)
            )
            .keyboardType(.numberPad)
            .multilineTextAlignment(.center)
            .font(.system(size: 28, weight: .bold, design: .monospaced))
            .tracking(8)
            .foregroundStyle(AppTheme.text)
            .focused($isCodeFieldFocused)
            .padding(.vertical, 14)
            .padding(.horizontal, 16)
            .frame(maxWidth: 320)
            .background(
                RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
                    .fill(AppTheme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
                    .stroke(isCodeFieldFocused ? AppTheme.primary : AppTheme.accent, lineWidth: 2)
            )
            .onChange(of: store.roomCodeInput) { _, newValue in
                let filtered = String(newValue.filter(\.isNumber).prefix(4))
                if filtered != newValue {
                    store.roomCodeInput = filtered
                }
            }

            Spacer().frame(height: 12)

            Button {
                isCodeFieldFocused = false
                Task { await store.joinRoom() }
            } label: {
                Text("加入房间")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle(background: AppTheme.accent))
            .disabled(store.roomActionPending)

            if let error = store.homeErrorMessage {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundStyle(AppTheme.primary)
                    .padding(.top, 10)
            }

            Spacer()
        }
        .padding(20)
    }
}
