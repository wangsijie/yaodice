import AVFoundation
import UIKit

@MainActor
final class FeedbackManager {
    static let shared = FeedbackManager()

    private var audioPlayer: AVAudioPlayer?
    private let lightImpact = UIImpactFeedbackGenerator(style: .light)
    private let mediumImpact = UIImpactFeedbackGenerator(style: .medium)
    private let heavyImpact = UIImpactFeedbackGenerator(style: .heavy)
    private let rigidImpact = UIImpactFeedbackGenerator(style: .rigid)
    private let notificationFeedback = UINotificationFeedbackGenerator()

    private init() {
        configureAudioSession()
        prepareAudioPlayer()
    }

    private func configureAudioSession() {
        do {
            // Use ambient so party music from other apps is not interrupted
            try AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // Ignore audio session errors
        }
    }

    private func prepareAudioPlayer() {
        guard let url = Bundle.main.url(forResource: "dice-roll", withExtension: "wav") else {
            return
        }
        do {
            let player = try AVAudioPlayer(contentsOf: url)
            player.prepareToPlay()
            audioPlayer = player
        } catch {
            // Ignore audio setup errors
        }
    }

    func playRollSound() {
        if audioPlayer == nil {
            prepareAudioPlayer()
        }
        guard let player = audioPlayer else { return }
        player.currentTime = 0
        player.play()
    }

    func triggerRollStartHaptic() {
        heavyImpact.prepare()
        rigidImpact.prepare()
        heavyImpact.impactOccurred()
    }

    func triggerRollTickHaptic() {
        rigidImpact.impactOccurred(intensity: 0.55)
    }

    func triggerRollFinishHaptic() {
        mediumImpact.impactOccurred(intensity: 0.9)
    }

    func triggerRevealHaptic() {
        notificationFeedback.notificationOccurred(.success)
    }

    func triggerTapHaptic() {
        lightImpact.impactOccurred()
    }
}
