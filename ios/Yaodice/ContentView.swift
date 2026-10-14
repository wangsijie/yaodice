import SwiftUI

struct ContentView: View {
    @State private var store = GameStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            AppTheme.bg
                .ignoresSafeArea()

            Group {
                switch store.page {
                case .home:
                    HomeView(store: store)
                case .nickname:
                    NicknameView(store: store)
                case .lobby:
                    LobbyView(store: store)
                case .game:
                    GameView(store: store)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .overlay(alignment: .top) {
            if store.showReconnectBanner {
                Button {
                    store.retryConnectionManual()
                } label: {
                    Text("连接已断开，点击重新连接")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.black)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 16)
                        .background(
                            Capsule()
                                .fill(AppTheme.warning)
                                .shadow(color: .black.opacity(0.4), radius: 8, x: 0, y: 4)
                        )
                }
                .padding(.top, 10)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .overlay(alignment: .bottom) {
            VStack(spacing: 8) {
                if let reconnectToast = store.reconnectToastMessage {
                    toastPill(text: reconnectToast, borderColor: AppTheme.warning)
                }
                if let toast = store.toastMessage {
                    toastPill(text: toast, borderColor: AppTheme.accent)
                }
            }
            .padding(.bottom, 24)
            .animation(.easeInOut(duration: 0.2), value: store.toastMessage)
            .animation(.easeInOut(duration: 0.2), value: store.reconnectToastMessage)
        }
        .preferredColorScheme(.dark)
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                store.handleAppDidBecomeActive()
            }
        }
        .onShake {
            if store.page == .game && !store.isViewingResults {
                store.rollDice()
            }
        }
    }

    private func toastPill(text: String, borderColor: Color) -> some View {
        Text(text)
            .font(.system(size: 14))
            .foregroundStyle(AppTheme.text)
            .padding(.vertical, 10)
            .padding(.horizontal, 20)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(AppTheme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(borderColor, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.35), radius: 6, x: 0, y: 3)
            .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}
