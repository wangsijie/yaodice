import Foundation

enum AppPage: Equatable {
    case home
    case nickname
    case lobby
    case game
}

enum GameMode: String, Codable, Equatable {
    case all = "all"
    case oneVsOne = "1v1"
}

enum RoomPhase: String, Codable, Equatable {
    case lobby
    case playing
    case results
}

enum DiceOnesMode: String, Equatable {
    case wild
    case plain
}

struct PlayerInfo: Codable, Identifiable, Equatable {
    let id: String
    var nickname: String
    var connected: Bool
}

struct ParticipantInfo: Codable, Identifiable, Equatable {
    let id: String
    var nickname: String
}

struct PlayerDiceResult: Codable, Identifiable, Equatable {
    let id: String
    let nickname: String
    let dice: [Int]
}

struct RoundStatePayload: Codable, Equatable {
    let mode: GameMode
    var participants: [ParticipantInfo]
    var rolled: [String]?
    var revealed: [String]?
    var yourDice: [Int]?
    var allRevealed: Bool?
    var allResults: [PlayerDiceResult]?
}

struct DiceTotals: Equatable {
    let wild: Int
    let countsByFace: [Int: Int]

    func count(for face: Int) -> Int {
        countsByFace[face] ?? 0
    }

    static func calculate(results: [PlayerDiceResult], onesAreWild: Bool) -> DiceTotals {
        var counts: [Int: Int] = [1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0]
        var leopardBonus: [Int: Int] = [1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0]
        var wildBonus = 0

        for result in results {
            for die in result.dice {
                counts[die, default: 0] += 1
            }

            if !onesAreWild {
                if let first = result.dice.first,
                   !result.dice.isEmpty,
                   result.dice.allSatisfy({ $0 == first }) {
                    leopardBonus[first, default: 0] += 2
                }
                continue
            }

            if !result.dice.isEmpty, result.dice.allSatisfy({ $0 == 1 }) {
                wildBonus += 2
                continue
            }

            let nonWildDice = result.dice.filter { $0 != 1 }
            if let leopardNumber = nonWildDice.first,
               nonWildDice.allSatisfy({ $0 == leopardNumber }) {
                let hasWildDice = result.dice.count != nonWildDice.count
                leopardBonus[leopardNumber, default: 0] += hasWildDice ? 1 : 2
            }
        }

        let wildCount = (counts[1] ?? 0) + wildBonus
        var finalCounts: [Int: Int] = [:]
        finalCounts[1] = onesAreWild ? (counts[1] ?? 0) : (counts[1] ?? 0) + (leopardBonus[1] ?? 0)
        for face in 2...6 {
            finalCounts[face] = (counts[face] ?? 0) + (onesAreWild ? wildCount : 0) + (leopardBonus[face] ?? 0)
        }

        return DiceTotals(
            wild: onesAreWild ? wildCount : 0,
            countsByFace: finalCounts
        )
    }
}

// MARK: - API Responses

struct CreateRoomResponse: Codable {
    let code: String
}

struct RoomInfoResponse: Codable {
    let exists: Bool
    let playerCount: Int?
}

// MARK: - WebSocket Messages

enum ClientMessage: Encodable {
    case join(nickname: String)
    case reconnect(reconnectToken: String, nickname: String)
    case setMode(mode: GameMode, players: [String])
    case startRound
    case roll
    case reveal
    case leave
    case ping
    case skipPlayer(playerId: String)
    case abortRound

    private enum CodingKeys: String, CodingKey {
        case type
        case nickname
        case reconnectToken
        case mode
        case players
        case playerId
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .join(let nickname):
            try container.encode("join", forKey: .type)
            try container.encode(nickname, forKey: .nickname)
        case .reconnect(let reconnectToken, let nickname):
            try container.encode("reconnect", forKey: .type)
            try container.encode(reconnectToken, forKey: .reconnectToken)
            try container.encode(nickname, forKey: .nickname)
        case .setMode(let mode, let players):
            try container.encode("set_mode", forKey: .type)
            try container.encode(mode.rawValue, forKey: .mode)
            try container.encode(players, forKey: .players)
        case .startRound:
            try container.encode("start_round", forKey: .type)
        case .roll:
            try container.encode("roll", forKey: .type)
        case .reveal:
            try container.encode("reveal", forKey: .type)
        case .leave:
            try container.encode("leave", forKey: .type)
        case .ping:
            try container.encode("ping", forKey: .type)
        case .skipPlayer(let playerId):
            try container.encode("skip_player", forKey: .type)
            try container.encode(playerId, forKey: .playerId)
        case .abortRound:
            try container.encode("abort_round", forKey: .type)
        }
    }
}

struct ServerMessageEnvelope: Decodable {
    let type: String

    // room_state
    let you: String?
    let reconnectToken: String?
    let roomCode: String?
    let hostId: String?
    let phase: RoomPhase?
    let players: [PlayerInfo]?
    let round: RoundStatePayload?
    let lastResults: [PlayerDiceResult]?
    let gameMode: GameMode?
    let selectedPlayers: [String]?

    // error
    let code: String?
    let message: String?

    // player_joined / player_left / player_reconnected / player_rolled / player_revealed / player_skipped
    let id: String?
    let nickname: String?
    let left: Bool?

    // mode_changed / round_started
    let mode: GameMode?
    let participants: [ParticipantInfo]?

    // round_aborted
    let reason: String?

    // your_dice
    let dice: [Int]?

    // all_revealed
    let results: [PlayerDiceResult]?
}

// MARK: - Nickname Generator

enum NicknameGenerator {
    private static let adjectives = [
        "快乐", "神秘", "飞翔", "淡定", "暴躁", "优雅", "沉默", "勇敢",
        "聪明", "迷糊", "傲娇", "佛系", "硬核", "摸鱼", "咸鱼", "划水"
    ]

    private static let nouns = [
        "熊猫", "青蛙", "企鹅", "老虎", "兔子", "猴子", "柴犬", "猫咪",
        "鹦鹉", "海豚", "考拉", "狐狸", "龙虾", "河豚", "仓鼠", "水獭"
    ]

    static func random() -> String {
        let adj = adjectives.randomElement() ?? "快乐"
        let noun = nouns.randomElement() ?? "熊猫"
        return adj + noun
    }
}
