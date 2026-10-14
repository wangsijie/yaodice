import SwiftUI

struct GameView: View {
    @Bindable var store: GameStore
    @State private var showAbortConfirmation = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 12)

                // Top header
                HStack(spacing: 12) {
                    Text("摇骰子")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(AppTheme.text)

                    if let mode = store.round?.mode ?? Optional(store.gameMode) {
                        Text(mode == .oneVsOne ? "1v1" : "所有人")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(AppTheme.text)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .fill(AppTheme.accent)
                            )
                    }

                    Spacer()

                    Button {
                        store.leaveRoom()
                    } label: {
                        Text("离开")
                    }
                    .buttonStyle(
                        PrimaryButtonStyle(
                            background: AppTheme.danger,
                            fullWidth: false,
                            verticalPadding: 8,
                            horizontalPadding: 16,
                            fontSize: 14
                        )
                    )
                }
                .frame(maxWidth: 320)
                .padding(.bottom, 16)

                if let round = store.round, !store.isViewingResults {
                    activeRoundView(round: round)
                }

                if let results = store.lastRevealedResults {
                    resultsSectionView(results: results)
                }

                Spacer().frame(height: 24)
            }
            .frame(maxWidth: .infinity)
            .padding(20)
        }
        .confirmationDialog(
            "确定要取消当前回合吗？",
            isPresented: $showAbortConfirmation,
            titleVisibility: .visible
        ) {
            Button("取消本局回合", role: .destructive) {
                store.abortRound()
            }
            Button("继续游戏", role: .cancel) {}
        }
    }

    // MARK: - Active Round View

    @ViewBuilder
    private func activeRoundView(round: RoundStatePayload) -> some View {
        SectionLabel("参与者状态")
            .padding(.bottom, 8)

        VStack(spacing: 6) {
            ForEach(round.participants) { participant in
                participantRow(for: participant)
            }
        }
        .frame(maxWidth: 320)
        .padding(.bottom, 12)

        if store.canManageRound && store.hasOfflineParticipant {
            Button {
                showAbortConfirmation = true
            } label: {
                Text("取消本局回合")
                    .font(.system(size: 13))
                    .foregroundStyle(AppTheme.textDim)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 12)
                    .frame(maxWidth: 320)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(
                                AppTheme.textDim,
                                style: StrokeStyle(lineWidth: 1, dash: [5, 4])
                            )
                    )
            }
            .buttonStyle(.plain)
            .padding(.bottom, 16)
        }

        if store.isParticipant {
            VStack(spacing: 0) {
                SectionLabel("你的骰子")

                DiceRowView(
                    dice: store.myDice,
                    isRolling: store.isRollingDice,
                    rollingValues: store.rollingDiceValues,
                    rollingActiveIndex: store.rollingActiveIndex
                )

                Spacer().frame(height: 12)

                if !store.hasRevealed && !store.isRollingDice {
                    if store.hasRolled {
                        Button {
                            store.revealDice()
                        } label: {
                            Text("👀 开！")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(
                            PrimaryButtonStyle(
                                background: AppTheme.success,
                                foreground: .black
                            )
                        )
                    } else {
                        Button {
                            store.rollDice()
                        } label: {
                            Text("🎲 摇！")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(PrimaryButtonStyle())

                        Text("点击按钮或直接摇一摇手机")
                            .font(.system(size: 12))
                            .foregroundStyle(AppTheme.textDim)
                            .padding(.top, 8)
                    }
                }
            }
            .frame(maxWidth: 320)
        } else {
            Text("你是观众，等待结果揭晓...")
                .font(.system(size: 15))
                .foregroundStyle(AppTheme.textDim)
                .padding(.vertical, 20)
        }
    }

    private func participantRow(for participant: ParticipantInfo) -> some View {
        let playerInfo = store.players.first(where: { $0.id == participant.id })
        let isConnected = playerInfo?.connected ?? true
        let isRevealed = store.revealedPlayers.contains(participant.id)
        let isRolled = store.rolledPlayers.contains(participant.id)

        let statusText: String
        let statusBg: Color
        let statusFg: Color

        if isRevealed {
            statusText = "已开"
            statusBg = Color(red: 0x14 / 255.0, green: 0x53 / 255.0, blue: 0x2d / 255.0)
            statusFg = AppTheme.success
        } else if isRolled {
            statusText = isConnected ? "已摇" : "已摇(离线)"
            statusBg = Color(red: 0x1e / 255.0, green: 0x3a / 255.0, blue: 0x5f / 255.0)
            statusFg = AppTheme.warning
        } else if !isConnected {
            statusText = "离线"
            statusBg = Color(red: 0x3f / 255.0, green: 0x1a / 255.0, blue: 0x1a / 255.0)
            statusFg = AppTheme.dangerLight
        } else {
            statusText = "等待中"
            statusBg = AppTheme.accent
            statusFg = AppTheme.textDim
        }

        let showSkip = store.canManageRound && !isConnected && !isRevealed

        return HStack(spacing: 8) {
            Text(participant.nickname)
                .font(.system(size: 14))
                .foregroundStyle(AppTheme.text)

            if participant.id == store.myId {
                TagBadge(text: "你", background: AppTheme.primary)
            }

            Spacer()

            Text(statusText)
                .font(.system(size: 13))
                .foregroundStyle(statusFg)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(statusBg)
                )

            if showSkip {
                Button {
                    store.skipPlayer(participant.id)
                } label: {
                    Text("跳过")
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.dangerLight)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .stroke(AppTheme.dangerLight, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(AppTheme.surface)
        )
    }

    // MARK: - Results Section View

    @ViewBuilder
    private func resultsSectionView(results: [PlayerDiceResult]) -> some View {
        let onesAreWild = store.diceCountsOnesMode == .wild
        let totals = DiceTotals.calculate(results: results, onesAreWild: onesAreWild)
        let note = onesAreWild
            ? "1 是万能点；豹子额外加点，真豹子额外 +2"
            : "1 已被叫过：1 只算普通点数，不再加到其他点数"

        VStack(spacing: 0) {
            Spacer().frame(height: 8)

            SectionLabel("📊 数字统计")
                .padding(.bottom, 8)

            VStack(alignment: .leading, spacing: 10) {
                // Rule Tabs
                HStack(spacing: 6) {
                    ruleTabButton(title: "1 是万能", mode: .wild, isActive: onesAreWild)
                    ruleTabButton(title: "1 已被叫", mode: .plain, isActive: !onesAreWild)
                }
                .padding(4)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(AppTheme.bg)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(AppTheme.accent, lineWidth: 1)
                )

                Text(note)
                    .font(.system(size: 13))
                    .foregroundStyle(AppTheme.textDim)

                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)],
                    spacing: 8
                ) {
                    ForEach([2, 3, 4, 5, 6], id: \.self) { face in
                        diceCountCell(label: "\(face) 点", count: totals.count(for: face))
                    }
                    diceCountCell(
                        label: onesAreWild ? "万能 1" : "1 点",
                        count: onesAreWild ? totals.wild : totals.count(for: 1)
                    )
                }
            }
            .padding(14)
            .frame(maxWidth: 320)
            .background(
                RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
                    .fill(AppTheme.surface)
            )
            .padding(.bottom, 14)

            SectionLabel("🎉 所有人的骰子")
                .padding(.bottom, 8)

            VStack(spacing: 10) {
                ForEach(results) { result in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(result.id == store.myId ? "\(result.nickname) (你)" : result.nickname)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(AppTheme.text)

                        DiceRowView(dice: result.dice)
                            .frame(maxWidth: .infinity)
                    }
                    .padding(14)
                    .frame(maxWidth: 320)
                    .background(
                        RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
                            .fill(AppTheme.surface)
                    )
                }
            }
            .padding(.bottom, 14)

            HStack(spacing: 10) {
                Button {
                    store.playAgain()
                } label: {
                    Text("🎲 再摇一把")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(
                    PrimaryButtonStyle(
                        background: AppTheme.primary,
                        horizontalPadding: 12,
                        fontSize: 16
                    )
                )

                Button {
                    store.backToLobby()
                } label: {
                    Text("返回大厅")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(
                    PrimaryButtonStyle(
                        background: AppTheme.accent,
                        horizontalPadding: 12,
                        fontSize: 16
                    )
                )
            }
            .frame(maxWidth: 320)
        }
    }

    private func ruleTabButton(title: String, mode: DiceOnesMode, isActive: Bool) -> some View {
        Button {
            store.setOnesMode(mode)
        } label: {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isActive ? Color.white : AppTheme.textDim)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(isActive ? AppTheme.primary : Color.clear)
                )
        }
        .buttonStyle(.plain)
    }

    private func diceCountCell(label: String, count: Int) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(AppTheme.text)
            Spacer()
            Text("\(count) 个")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(AppTheme.success)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 10)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(AppTheme.bg)
        )
    }
}
