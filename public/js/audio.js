// ============ Audio ============
function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  return audioContext;
}

function createRollAudioElement() {
  if (rollAudioElement) return rollAudioElement;

  rollAudioElement = new Audio('/dice-roll.wav');
  rollAudioElement.preload = 'auto';
  rollAudioElement.volume = 1;
  return rollAudioElement;
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  const ctx = getAudioContext();
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});

  const audio = createRollAudioElement();
  audio.muted = true;
  audio.play().then(() => {
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
  }).catch(() => {
    audio.muted = false;
  });
}

function playFallbackRollSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const play = () => {
    try {
      const now = ctx.currentTime;
      const duration = 0.65;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const fade = 1 - i / data.length;
        data[i] = (Math.random() * 2 - 1) * fade * 0.95;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(180, now + duration);
      filter.Q.value = 1.4;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
      noise.stop(now + duration);

      [0, 0.08, 0.16, 0.25, 0.34, 0.46].forEach((offset) => {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(260 + Math.random() * 240, now + offset);
        oscGain.gain.setValueAtTime(0.24, now + offset);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.07);
        osc.connect(oscGain);
        oscGain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.07);
      });
    } catch {
      // Ignore audio failures; rolling should still work.
    }
  };

  if (ctx.state === 'suspended') {
    ctx.resume().then(play).catch(() => {});
  } else {
    play();
  }
}

function playRollSound() {
  const audio = createRollAudioElement();
  audio.currentTime = 0;
  audio.play().catch(playFallbackRollSound);
}

document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('touchstart', unlockAudio, { once: true });
document.addEventListener('click', unlockAudio, { once: true });
