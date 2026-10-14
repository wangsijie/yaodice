import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class GameStore {
    // MARK: - Constants

    private static let serverURL = URL(string: "https://yaodice.sijie.workers.dev")!
    private static let webSocketBaseURL = URL(string: "wss://yaodice.sijie.workers.dev")!
    private static let customNicknameStorageKey = "yaodice_custom_nickname"
    private static let roomSessionStorageKey = "yaodice_room_session"

    private static let reconnectMaxAttempts = 10
    private static let reconnectBaseDelay: TimeInterval = 1.0
    private static let reconnectMaxDelay: TimeInterval = 30.0
    private static let heartbeatInterval: TimeInterval = 20.0
    private static let heartbeatTimeout: TimeInterval = 8.0
    private static let rollAnimationDuration: TimeInterval = 1.6
    private static let rollAnimationStep: TimeInterval = 0.07

    // MARK: - Navigation & UI State

    var page: AppPage = .home {
        didSet {
            updateIdleTimer()
        }
    }

    var roomCodeInput: String = ""
    var nicknameInput: String = ""
    var homeErrorMessage: String?
    var nicknameErrorMessage: String?
    var toastMessage: String?
    var reconnectToastMessage: String?
    var showReconnectBanner: Bool = false

    var roomActionPending: Bool = false
    var joinPending: Bool = false

    // MARK: - Room & Game State

    var roomCode: String = ""
    var myId: String = ""
    var hostId: String = ""
    var nickname: String = ""
    var players: [PlayerInfo] = []
    var gameMode: GameMode = .all
    var selectedPlayers: [String] = []
    var round: RoundStatePayload?

    var myDice: [Int]?
    var pendingDice: [Int]?
    var isRollingDice: Bool = false
    var rollingDiceValues: [Int] = [1, 2, 3, 4, 5]
    var rollingActiveIndex: Int = 0

    var hasRolled: Bool = false
    var hasRevealed: Bool = false
    var isParticipant: Bool = false
    var rolledPlayers: Set<String> = []
    var revealedPlayers: Set<String> = []

    var lastRevealedResults: [PlayerDiceResult]?
    var diceCountsOnesMode: DiceOnesMode = .wild

    // MARK: - Internal State

    private var reconnectToken: String?
    private var lastGeneratedNickname: String = ""
    private var autoRollAfterRoundStart: Bool = false

    private var webSocketTask: URLSessionWebSocketTask?
    private var intentionalClose: Bool = false
    private var reconnectAttempt: Int = 0
    private var reconnectTask: Task<Void, Never>?
    private var heartbeatTask: Task<Void, Never>?
    private var heartbeatTimeoutTask: Task<Void, Never>?
    private var toastDismissTask: Task<Void, Never>?
    private var errorDismissTask: Task<Void, Never>?

    private var rollAnimationTask: Task<Void, Never>?
    private var rollAnimationStartedAt: Date?

    // MARK: - Computed Properties

    var isHost: Bool {
        !myId.isEmpty && myId == hostId
    }

    var canStartRoundFromLobby: Bool {
        guard isHost else { return false }
        if gameMode == .all {
            return players.filter(\.connected).count >= 2
        } else {
            return selectedPlayers.count == 2
        }
    }

    var canManageRound: Bool {
        let hostPlayer = players.first(where: { $0.id == hostId })
        let isHostConnected = hostPlayer?.connected ?? true
        return myId == hostId || !isHostConnected
    }

    var hasOfflineParticipant: Bool {
        guard let round else { return false }
        return round.participants.contains { participant in
            if let player = players.first(where: { $0.id == participant.id }) {
                return !player.connected
            }
            return false
        }
    }

    var isViewingResults: Bool {
        lastRevealedResults != nil
    }

    // MARK: - Init

    init() {
        restoreRoomSessionOnLaunch()
    }

    // MARK: - Base URL Helpers

    private func apiURL(path: String) -> URL? {
        URL(string: Self.serverURL.absoluteString + path)
    }

    private func webSocketURL(roomCode: String) -> URL? {
        URL(string: Self.webSocketBaseURL.absoluteString + "/ws/\(roomCode)")
    }

    // MARK: - Home Actions

    func createRoom() async {
        guard !roomActionPending else { return }
        guard let url = apiURL(path: "/api/room/create") else {
            showHomeError("服务器地址无效")
            return
        }

        roomActionPending = true
        defer { roomActionPending = false }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 10

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                showHomeError("创建失败，请重试")
                return
            }
            let decoded = try JSONDecoder().decode(CreateRoomResponse.self, from: data)
            roomCode = decoded.code
            saveRoomSession()
            prepareNicknameInput()
            page = .nickname
        } catch {
            showHomeError("创建失败，请重试")
        }
    }

    func joinRoom() async {
        guard !roomActionPending else { return }
        let code = roomCodeInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard code.count == 4, code.allSatisfy(\.isNumber) else {
            showHomeError("请输入4位数字房间号")
            return
        }
        guard let url = apiURL(path: "/api/room/\(code)") else {
            showHomeError("服务器地址无效")
            return
        }

        roomActionPending = true
        defer { roomActionPending = false }

        var request = URLRequest(url: url)
        request.timeoutInterval = 10

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                showHomeError("加入失败，请重试")
                return
            }
            let decoded = try JSONDecoder().decode(RoomInfoResponse.self, from: data)
            guard decoded.exists else {
                showHomeError("房间不存在")
                return
            }
            roomCode = code
            saveRoomSession()
            prepareNicknameInput()
            page = .nickname
        } catch {
            showHomeError("加入失败，请重试")
        }
    }

    // MARK: - Nickname Actions

    func prepareNicknameInput() {
        let savedNick = !nickname.isEmpty
            ? nickname
            : (UserDefaults.standard.string(forKey: Self.customNicknameStorageKey) ?? "")
        if !savedNick.isEmpty {
            lastGeneratedNickname = ""
            nicknameInput = savedNick
        } else {
            generateRandomNickname()
        }
    }

    func generateRandomNickname() {
        FeedbackManager.shared.triggerTapHaptic()
        let generated = NicknameGenerator.random()
        lastGeneratedNickname = generated
        nicknameInput = generated
    }

    func confirmNickname() {
        guard !joinPending else { return }
        let trimmed = String(nicknameInput.trimmingCharacters(in: .whitespacesAndNewlines).prefix(12))
        if trimmed.isEmpty {
            generateRandomNickname()
            return
        }

        nicknameErrorMessage = nil
        joinPending = true
        nickname = trimmed
        if trimmed != lastGeneratedNickname {
            UserDefaults.standard.set(trimmed, forKey: Self.customNicknameStorageKey)
        }
        saveRoomSession()
        connectWebSocket()
    }

    func cancelNicknameAndReturnHome() {
        clearRoomSession()
        resetState()
        page = .home
    }

    // MARK: - Lobby Actions

    func setMode(_ mode: GameMode) {
        guard isHost else { return }
        FeedbackManager.shared.triggerTapHaptic()
        gameMode = mode
        selectedPlayers = []
        _ = sendMessage(.setMode(mode: mode, players: []))
    }

    func toggle1v1Player(_ playerId: String) {
        guard isHost else { return }
        FeedbackManager.shared.triggerTapHaptic()
        if let idx = selectedPlayers.firstIndex(of: playerId) {
            selectedPlayers.remove(at: idx)
        } else if selectedPlayers.count < 2 {
            selectedPlayers.append(playerId)
        }
        _ = sendMessage(.setMode(mode: .oneVsOne, players: selectedPlayers))
    }

    func startRound() {
        FeedbackManager.shared.triggerTapHaptic()
        _ = sendMessage(.startRound)
    }

    func copyRoomCode() {
        UIPasteboard.general.string = roomCode
        FeedbackManager.shared.triggerTapHaptic()
        showToast("已复制房间号 \(roomCode)")
    }

    func leaveRoom() {
        intentionalClose = true
        reconnectTask?.cancel()
        reconnectTask = nil
        reconnectToastMessage = nil
        showReconnectBanner = false
        stopHeartbeat()

        if let task = webSocketTask {
            if let data = try? JSONEncoder().encode(ClientMessage.leave),
               let text = String(data: data, encoding: .utf8) {
                task.send(.string(text)) { _ in }
            }
            task.cancel(with: .normalClosure, reason: Data("Left room".utf8))
            webSocketTask = nil
        }

        clearRoomSession()
        resetState()
        page = .home
        showToast("已离开房间")
    }

    // MARK: - Game & Results Actions

    func rollDice() {
        guard isParticipant, !hasRolled, !isRollingDice else { return }
        guard sendMessage(.roll) else { return }
        beginDiceRollAnimation()
        FeedbackManager.shared.playRollSound()
        FeedbackManager.shared.triggerRollStartHaptic()
    }

    func revealDice() {
        guard !hasRevealed else { return }
        guard sendMessage(.reveal) else { return }
        FeedbackManager.shared.triggerRevealHaptic()
        hasRevealed = true
    }

    func skipPlayer(_ playerId: String) {
        _ = sendMessage(.skipPlayer(playerId: playerId))
    }

    func abortRound() {
        _ = sendMessage(.abortRound)
    }

    func playAgain() {
        FeedbackManager.shared.triggerTapHaptic()
        if round != nil {
            enterCurrentRoundAndRoll()
            return
        }

        autoRollAfterRoundStart = true
        if !sendMessage(.startRound) {
            autoRollAfterRoundStart = false
        }
    }

    func backToLobby() {
        FeedbackManager.shared.triggerTapHaptic()
        resetDiceRollAnimation()
        autoRollAfterRoundStart = false
        round = nil
        myDice = nil
        pendingDice = nil
        hasRolled = false
        hasRevealed = false
        rolledPlayers.removeAll()
        revealedPlayers.removeAll()
        lastRevealedResults = nil
        diceCountsOnesMode = .wild
        page = .lobby
    }

    func setOnesMode(_ mode: DiceOnesMode) {
        guard lastRevealedResults != nil, diceCountsOnesMode != mode else { return }
        FeedbackManager.shared.triggerTapHaptic()
        diceCountsOnesMode = mode
    }

    // MARK: - Dice Roll Animation

    private func receiveMyDice(_ dice: [Int]) {
        pendingDice = dice
        hasRolled = true

        guard isRollingDice, let startedAt = rollAnimationStartedAt else {
            finishDiceRollAnimation()
            return
        }

        let elapsed = Date().timeIntervalSince(startedAt)
        if elapsed >= Self.rollAnimationDuration {
            finishDiceRollAnimation()
        }
    }

    private func beginDiceRollAnimation() {
        resetDiceRollAnimation()

        isRollingDice = true
        pendingDice = nil
        rollingDiceValues = (0..<5).map { _ in Int.random(in: 1...6) }
        rollingActiveIndex = 0
        let startedAt = Date()
        rollAnimationStartedAt = startedAt

        rollAnimationTask = Task { [weak self] in
            var tick = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(Int(Self.rollAnimationStep * 1000)))
                guard let self, !Task.isCancelled, self.isRollingDice else { return }

                let activeIdx = tick % 5
                let currentVal = self.rollingDiceValues[activeIdx]
                var nextVal = Int.random(in: 1...6)
                if nextVal == currentVal {
                    nextVal = (nextVal % 6) + 1
                }
                self.rollingDiceValues[activeIdx] = nextVal
                self.rollingActiveIndex = activeIdx
                tick += 1

                if tick % 2 == 0 {
                    FeedbackManager.shared.triggerRollTickHaptic()
                }

                if Date().timeIntervalSince(startedAt) >= Self.rollAnimationDuration,
                   self.pendingDice != nil {
                    self.finishDiceRollAnimation()
                    return
                }
            }
        }
    }

    private func finishDiceRollAnimation() {
        rollAnimationTask?.cancel()
        rollAnimationTask = nil
        rollAnimationStartedAt = nil

        if let pending = pendingDice {
            myDice = pending
            pendingDice = nil
        }

        isRollingDice = false
        FeedbackManager.shared.triggerRollFinishHaptic()
    }

    private func resetDiceRollAnimation() {
        rollAnimationTask?.cancel()
        rollAnimationTask = nil
        rollAnimationStartedAt = nil
        pendingDice = nil
        isRollingDice = false
        rollingDiceValues = [1, 2, 3, 4, 5]
        rollingActiveIndex = 0
    }

    private func enterCurrentRoundAndRoll() {
        guard round != nil else { return }
        lastRevealedResults = nil
        diceCountsOnesMode = .wild
        page = .game

        if isParticipant {
            rollDice()
        }
    }

    private func clearCurrentRound() {
        resetDiceRollAnimation()
        round = nil
        myDice = nil
        pendingDice = nil
        isRollingDice = false
        hasRolled = false
        hasRevealed = false
        isParticipant = false
        rolledPlayers.removeAll()
        revealedPlayers.removeAll()
    }

    // MARK: - WebSocket & Reconnection

    func connectWebSocket() {
        intentionalClose = false
        reconnectTask?.cancel()
        reconnectTask = nil

        if webSocketTask != nil {
            return
        }

        guard !roomCode.isEmpty, let wsURL = webSocketURL(roomCode: roomCode) else {
            joinPending = false
            showToast("无效的房间连接地址")
            return
        }

        let task = URLSession.shared.webSocketTask(with: wsURL)
        webSocketTask = task
        task.resume()

        startHeartbeat()
        showReconnectBanner = false

        // Send initial join or reconnect handshake
        let handshake: ClientMessage
        if let token = reconnectToken, !token.isEmpty {
            handshake = .reconnect(reconnectToken: token, nickname: nickname)
        } else {
            handshake = .join(nickname: nickname)
        }
        sendRawMessage(handshake, on: task)

        receiveNextMessage(from: task)
    }

    private func receiveNextMessage(from task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor [weak self] in
                guard let self, self.webSocketTask === task else { return }

                switch result {
                case .success(let message):
                    self.onHeartbeatActivity()
                    let text: String?
                    switch message {
                    case .string(let str):
                        text = str
                    case .data(let data):
                        text = String(data: data, encoding: .utf8)
                    @unknown default:
                        text = nil
                    }

                    if let text,
                       let data = text.data(using: .utf8),
                       let decoded = try? JSONDecoder().decode(ServerMessageEnvelope.self, from: data) {
                        if decoded.type != "pong" {
                            self.handleServerMessage(decoded)
                        }
                    }
                    self.receiveNextMessage(from: task)

                case .failure:
                    self.handleSocketClosed(task: task)
                }
            }
        }
    }

    private func handleSocketClosed(task: URLSessionWebSocketTask) {
        guard webSocketTask === task else { return }
        stopHeartbeat()
        let closeCode = task.closeCode.rawValue
        webSocketTask = nil

        if intentionalClose { return }
        if closeCode == 1000 || closeCode == 4001 || closeCode == 4002 {
            joinPending = false
            return
        }

        attemptReconnect()
    }

    private func handleSocketDied() {
        stopHeartbeat()
        if let task = webSocketTask {
            task.cancel()
            webSocketTask = nil
        }
        attemptReconnect()
    }

    func retryConnectionManual() {
        showReconnectBanner = false
        reconnectAttempt = 0
        reconnectToastMessage = "重新连接中... (1/\(Self.reconnectMaxAttempts))"
        connectWebSocket()
    }

    func handleAppDidBecomeActive() {
        guard !roomCode.isEmpty else { return }

        if webSocketTask == nil {
            if reconnectTask == nil {
                reconnectToastMessage = "重新连接中... (\(reconnectAttempt + 1)/\(Self.reconnectMaxAttempts))"
                connectWebSocket()
            }
        } else {
            sendPing(timeout: 3.0)
        }
    }

    private func attemptReconnect(immediate: Bool = false) {
        if reconnectAttempt >= Self.reconnectMaxAttempts {
            reconnectToastMessage = nil
            showReconnectBanner = true
            return
        }

        reconnectAttempt += 1
        let delay = immediate
            ? 0
            : min(Self.reconnectBaseDelay * pow(2.0, Double(reconnectAttempt - 1)), Self.reconnectMaxDelay)

        reconnectToastMessage = "重新连接中... (\(reconnectAttempt)/\(Self.reconnectMaxAttempts))"

        if delay == 0 {
            connectWebSocket()
            return
        }

        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(Int(delay * 1000)))
            guard let self, !Task.isCancelled else { return }
            self.reconnectTask = nil
            self.connectWebSocket()
        }
    }

    private func startHeartbeat() {
        stopHeartbeat()
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.heartbeatInterval))
                guard let self, !Task.isCancelled else { return }
                self.sendPing(timeout: Self.heartbeatTimeout)
            }
        }
    }

    private func stopHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = nil
        heartbeatTimeoutTask?.cancel()
        heartbeatTimeoutTask = nil
    }

    private func onHeartbeatActivity() {
        heartbeatTimeoutTask?.cancel()
        heartbeatTimeoutTask = nil
    }

    private func sendPing(timeout: TimeInterval) {
        guard let task = webSocketTask else { return }
        sendRawMessage(.ping, on: task)
        heartbeatTimeoutTask?.cancel()
        heartbeatTimeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(Int(timeout * 1000)))
            guard let self, !Task.isCancelled else { return }
            self.handleSocketDied()
        }
    }

    @discardableResult
    private func sendMessage(_ message: ClientMessage) -> Bool {
        if let task = webSocketTask {
            sendRawMessage(message, on: task)
            return true
        }
        if !roomCode.isEmpty, reconnectTask == nil {
            reconnectToastMessage = "重新连接中... (\(reconnectAttempt + 1)/\(Self.reconnectMaxAttempts))"
            connectWebSocket()
        }
        showToast("连接中，请稍后再试")
        return false
    }

    private func sendRawMessage(_ message: ClientMessage, on task: URLSessionWebSocketTask) {
        guard let data = try? JSONEncoder().encode(message),
              let text = String(data: data, encoding: .utf8) else {
            return
        }
        task.send(.string(text)) { [weak self] error in
            if error != nil {
                Task { @MainActor [weak self] in
                    guard let self, self.webSocketTask === task else { return }
                    self.handleSocketDied()
                }
            }
        }
    }

    // MARK: - Server Message Handler

    private func handleServerMessage(_ msg: ServerMessageEnvelope) {
        switch msg.type {
        case "room_state":
            let wasReconnecting = reconnectAttempt > 0
            myId = msg.you ?? myId
            hostId = msg.hostId ?? ""
            players = msg.players ?? []
            if let rc = msg.roomCode, !rc.isEmpty {
                roomCode = rc
            }
            gameMode = msg.gameMode ?? .all
            selectedPlayers = msg.selectedPlayers ?? []
            if let token = msg.reconnectToken {
                reconnectToken = token
            }
            saveRoomSession()

            reconnectAttempt = 0
            reconnectToastMessage = nil
            showReconnectBanner = false
            joinPending = false

            if wasReconnecting {
                showToast("已重新连接")
            }

            if let roundState = msg.round {
                round = roundState
                myDice = roundState.yourDice
                let rolledList = roundState.rolled ?? []
                let revealedList = roundState.revealed ?? []
                hasRolled = rolledList.contains(myId)
                hasRevealed = revealedList.contains(myId)
                isParticipant = roundState.participants.contains(where: { $0.id == myId })
                rolledPlayers = Set(rolledList)
                revealedPlayers = Set(revealedList)

                page = .game
                if roundState.allRevealed == true, let results = roundState.allResults {
                    showResults(results)
                } else {
                    lastRevealedResults = nil
                }
            } else if msg.phase == .results, let results = msg.lastResults {
                page = .game
                showResults(results)
            } else {
                lastRevealedResults = nil
                page = .lobby
            }

        case "error":
            joinPending = false
            if msg.code == "nickname_taken" {
                intentionalClose = true
                webSocketTask?.cancel()
                webSocketTask = nil
                page = .nickname
                showNicknameError(msg.message ?? "这个昵称已经在房间里了，请换一个")
            } else {
                showToast(msg.message ?? "操作失败，请重试")
            }

        case "player_joined":
            if let id = msg.id, let nick = msg.nickname {
                if !players.contains(where: { $0.id == id }) {
                    players.append(PlayerInfo(id: id, nickname: nick, connected: true))
                }
                if let host = msg.hostId {
                    hostId = host
                }
                showToast("\(nick) 加入了房间")
            }

        case "player_left":
            if let id = msg.id {
                if msg.left == true {
                    players.removeAll(where: { $0.id == id })
                    selectedPlayers.removeAll(where: { $0 == id })
                } else if let idx = players.firstIndex(where: { $0.id == id }) {
                    players[idx].connected = false
                }
            }
            if let host = msg.hostId {
                hostId = host
            }

        case "player_reconnected":
            if let id = msg.id, let idx = players.firstIndex(where: { $0.id == id }) {
                players[idx].connected = true
                if let nick = msg.nickname, !nick.isEmpty {
                    players[idx].nickname = nick
                }
            }
            if let host = msg.hostId {
                hostId = host
            }
            if let nick = msg.nickname {
                showToast("\(nick) 重新连接了")
            }

        case "mode_changed":
            if let mode = msg.mode {
                gameMode = mode
            }
            selectedPlayers = msg.selectedPlayers ?? []

        case "round_started":
            resetDiceRollAnimation()
            let keepShowingResults = isViewingResults && !autoRollAfterRoundStart
            let participants = msg.participants ?? []
            round = RoundStatePayload(
                mode: msg.mode ?? gameMode,
                participants: participants,
                rolled: [],
                revealed: [],
                yourDice: nil,
                allRevealed: false,
                allResults: nil
            )
            myDice = nil
            pendingDice = nil
            isRollingDice = false
            hasRolled = false
            hasRevealed = false
            isParticipant = participants.contains(where: { $0.id == myId })
            rolledPlayers = []
            revealedPlayers = []

            if keepShowingResults {
                page = .game
            } else if autoRollAfterRoundStart {
                autoRollAfterRoundStart = false
                enterCurrentRoundAndRoll()
            } else {
                lastRevealedResults = nil
                page = .game
            }

        case "round_aborted":
            showToast(msg.reason ?? "当前回合已取消")
            clearCurrentRound()
            lastRevealedResults = nil
            page = .lobby

        case "player_skipped":
            if let participants = msg.participants, round != nil {
                round?.participants = participants
                isParticipant = participants.contains(where: { $0.id == myId })
            }
            showToast("已跳过掉线玩家")

        case "your_dice":
            if let dice = msg.dice {
                receiveMyDice(dice)
            }

        case "player_rolled":
            if let id = msg.id {
                rolledPlayers.insert(id)
            }

        case "player_revealed":
            if let id = msg.id {
                revealedPlayers.insert(id)
            }

        case "all_revealed":
            let wasViewingResults = isViewingResults
            clearCurrentRound()
            if !wasViewingResults, let results = msg.results {
                showResults(results)
            }

        default:
            break
        }
    }

    private func showResults(_ results: [PlayerDiceResult]) {
        lastRevealedResults = results
        diceCountsOnesMode = .wild
        FeedbackManager.shared.triggerRevealHaptic()
    }

    // MARK: - Persistence

    private struct StoredSession: Codable {
        let roomCode: String
        let nickname: String
        let reconnectToken: String?
    }

    private func saveRoomSession() {
        guard !roomCode.isEmpty else { return }
        let session = StoredSession(
            roomCode: roomCode,
            nickname: nickname,
            reconnectToken: reconnectToken
        )
        if let data = try? JSONEncoder().encode(session) {
            UserDefaults.standard.set(data, forKey: Self.roomSessionStorageKey)
        }
    }

    private func clearRoomSession() {
        reconnectToken = nil
        UserDefaults.standard.removeObject(forKey: Self.roomSessionStorageKey)
    }

    private func restoreRoomSessionOnLaunch() {
        guard let data = UserDefaults.standard.data(forKey: Self.roomSessionStorageKey),
              let session = try? JSONDecoder().decode(StoredSession.self, from: data),
              session.roomCode.count == 4,
              session.roomCode.allSatisfy(\.isNumber) else {
            UserDefaults.standard.removeObject(forKey: Self.roomSessionStorageKey)
            return
        }

        roomCode = session.roomCode
        nickname = session.nickname
        reconnectToken = session.reconnectToken

        if let token = reconnectToken, !token.isEmpty {
            reconnectToastMessage = "重新连接中... (1/\(Self.reconnectMaxAttempts))"
            connectWebSocket()
        } else {
            prepareNicknameInput()
            page = .nickname
        }
    }

    private func resetState() {
        resetDiceRollAnimation()
        roomCode = ""
        roomCodeInput = ""
        myId = ""
        hostId = ""
        nickname = ""
        players = []
        round = nil
        gameMode = .all
        selectedPlayers = []
        myDice = nil
        pendingDice = nil
        isRollingDice = false
        hasRolled = false
        hasRevealed = false
        isParticipant = false
        rolledPlayers.removeAll()
        revealedPlayers.removeAll()
        lastRevealedResults = nil
        diceCountsOnesMode = .wild
        joinPending = false
        autoRollAfterRoundStart = false
    }

    // MARK: - Toasts & Idle Timer

    func showToast(_ message: String) {
        toastMessage = message
        toastDismissTask?.cancel()
        toastDismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard let self, !Task.isCancelled else { return }
            self.toastMessage = nil
        }
    }

    private func showHomeError(_ message: String) {
        homeErrorMessage = message
        errorDismissTask?.cancel()
        errorDismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self, !Task.isCancelled else { return }
            self.homeErrorMessage = nil
        }
    }

    private func showNicknameError(_ message: String) {
        nicknameErrorMessage = message
        errorDismissTask?.cancel()
        errorDismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self, !Task.isCancelled else { return }
            self.nicknameErrorMessage = nil
        }
    }

    private func updateIdleTimer() {
        // Prevent screen auto-lock while inside a room at the party table
        UIApplication.shared.isIdleTimerDisabled = (page == .lobby || page == .game)
    }
}
