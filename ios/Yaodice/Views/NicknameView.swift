import SwiftUI

struct NicknameView: View {
    @Bindable var store: GameStore
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    isFocused = false
                    store.cancelNicknameAndReturnHome()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                        Text("返回")
                    }
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.textDim)
                }
                Spacer()
            }
            .frame(maxWidth: 320)
            .padding(.bottom, 16)

            Text("😎")
                .font(.system(size: 64))
                .padding(.bottom, 16)

            Text("你的昵称")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(AppTheme.text)
                .padding(.bottom, 16)

            TextField(
                "",
                text: $store.nicknameInput,
                prompt: Text("输入昵称").foregroundStyle(AppTheme.textDim)
            )
            .multilineTextAlignment(.center)
            .font(.system(size: 18))
            .foregroundStyle(AppTheme.text)
            .focused($isFocused)
            .submitLabel(.done)
            .onSubmit {
                store.confirmNickname()
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 16)
            .frame(maxWidth: 320)
            .background(
                RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
                    .fill(AppTheme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
                    .stroke(isFocused ? AppTheme.primary : AppTheme.accent, lineWidth: 2)
            )
            .onChange(of: store.nicknameInput) { _, newValue in
                if newValue.count > 12 {
                    store.nicknameInput = String(newValue.prefix(12))
                }
            }

            Spacer().frame(height: 12)

            Button {
                store.generateRandomNickname()
            } label: {
                Text("🎲 随机一个")
            }
            .buttonStyle(
                PrimaryButtonStyle(
                    background: AppTheme.accent,
                    fullWidth: false,
                    verticalPadding: 8,
                    horizontalPadding: 16,
                    fontSize: 15
                )
            )
            .disabled(store.joinPending)

            Spacer().frame(height: 24)

            Button {
                isFocused = false
                store.confirmNickname()
            } label: {
                Text(store.joinPending ? "进入中..." : "进入房间")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(store.joinPending)

            if let error = store.nicknameErrorMessage {
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
