import SwiftUI

struct LobbyView: View {
    @Bindable var store: GameStore

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 12)

                Text("房间")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(AppTheme.text)
                    .padding(.bottom, 16)

                // Room code card (tap to copy)
                Button {
                    store.copyRoomCode()
                } label: {
                    VStack(spacing: 4) {
                        Text(store.roomCode.isEmpty ? "----" : store.roomCode)
                            .font(.system(size: 32, weight: .bold, design: .monospaced))
                            .tracking(6)
                            .foregroundStyle(AppTheme.warning)
                        Text("点击复制房间号")
                            .font(.system(size: 12))
                            .foregroundStyle(AppTheme.textDim)
                    }
                    .padding(.vertical, 16)
                    .padding(.horizontal, 24)
                    .frame(maxWidth: 320)
                    .background(
                        RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
                            .fill(AppTheme.surface)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
                            .strokeBorder(
                                AppTheme.accent,
                                style: StrokeStyle(lineWidth: 2, dash: [6, 4])
                            )
                    )
                }
                .buttonStyle(.plain)

                Spacer().frame(height: 24)

                SectionLabel("玩家")
                    .padding(.bottom, 8)

                VStack(spacing: 8) {
                    ForEach(store.players) { player in
                        HStack(spacing: 10) {
                            Text(player.nickname)
                                .font(.system(size: 15))
                                .foregroundStyle(AppTheme.text)

                            if player.id == store.hostId {
                                TagBadge(text: "房主", background: AppTheme.warning, foreground: .black)
                            }
                            if player.id == store.myId {
                                TagBadge(text: "你", background: AppTheme.primary)
                            }

                            Spacer()

                            Circle()
                                .fill(player.connected ? AppTheme.success : AppTheme.textDim)
                                .frame(width: 8, height: 8)
                        }
                        .padding(.vertical, 10)
                        .padding(.horizontal, 14)
                        .frame(maxWidth: 320)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(AppTheme.surface)
                        )
                    }
                }

                Spacer().frame(height: 12)

                if store.isHost {
                    VStack(spacing: 0) {
                        SectionLabel("模式")
                            .padding(.bottom, 8)

                        HStack(spacing: 8) {
                            modeButton(title: "🎯 所有人摇", mode: .all)
                            modeButton(title: "⚔️ 1v1", mode: .oneVsOne)
                        }
                        .frame(maxWidth: 320)
                        .padding(.bottom, 16)

                        if store.gameMode == .oneVsOne {
                            SectionLabel("选择两名玩家")
                                .padding(.bottom, 8)

                            VStack(spacing: 8) {
                                ForEach(store.players.filter(\.connected)) { player in
                                    let isSelected = store.selectedPlayers.contains(player.id)
                                    Button {
                                        store.toggle1v1Player(player.id)
                                    } label: {
                                        HStack(spacing: 10) {
                                            Text(player.nickname)
                                                .font(.system(size: 15))
                                                .foregroundStyle(AppTheme.text)
                                            if player.id == store.myId {
                                                TagBadge(text: "你", background: AppTheme.primary)
                                            }
                                            Spacer()
                                            if isSelected {
                                                Image(systemName: "checkmark.circle.fill")
                                                    .foregroundStyle(AppTheme.primary)
                                            }
                                        }
                                        .padding(.vertical, 10)
                                        .padding(.horizontal, 14)
                                        .frame(maxWidth: 320)
                                        .background(
                                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                                .fill(AppTheme.surface)
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                                .stroke(isSelected ? AppTheme.primary : Color.clear, lineWidth: 2)
                                        )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.bottom, 12)
                        }

                        Button {
                            store.startRound()
                        } label: {
                            Text("开始摇骰子！")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(!store.canStartRoundFromLobby)
                    }
                } else {
                    Text("等待房主开始游戏...")
                        .font(.system(size: 15))
                        .foregroundStyle(AppTheme.textDim)
                        .padding(.vertical, 8)
                }

                Spacer().frame(height: 24)

                Button {
                    store.leaveRoom()
                } label: {
                    Text("离开房间")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle(background: AppTheme.danger))

                Spacer().frame(height: 24)
            }
            .frame(maxWidth: .infinity)
            .padding(20)
        }
    }

    private func modeButton(title: String, mode: GameMode) -> some View {
        let isActive = store.gameMode == mode
        return Button {
            store.setMode(mode)
        } label: {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(AppTheme.text)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(isActive ? AppTheme.primary : AppTheme.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(isActive ? AppTheme.primary : AppTheme.accent, lineWidth: 2)
                )
        }
        .buttonStyle(.plain)
    }
}
