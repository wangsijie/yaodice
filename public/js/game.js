// ============ Game Rendering ============
const ROLL_ANIMATION_DURATION_MS = 1600;
const ROLL_ANIMATION_STEP_MS = 70;

let rollAnimationInterval = null;
let rollAnimationFinishTimer = null;
let rollAnimationStartedAt = 0;
let rollingDiceValues = [];
let rollingDiceTick = 0;
let lastRevealedResults = null;
let diceCountsOnesMode = 'wild';
let autoRollAfterRoundStart = false;

function renderGame() {
  if (!state.round) return;
  const participants = state.round.participants;

  document.getElementById('game-mode-badge').textContent =
    state.round.mode === '1v1' ? '1v1' : '所有人';

  // Participant status
  const statusEl = document.getElementById('participants-status');
  statusEl.innerHTML = participants.map(p => {
    const pid = p.id;
    let statusClass = 'waiting';
    let statusText = '等待中';
    if (state.revealedPlayers.has(pid)) {
      statusClass = 'revealed';
      statusText = '已开';
    } else if (state.rolledPlayers.has(pid)) {
      statusClass = 'rolled';
      statusText = '已摇';
    }
    return `
      <div class="participant-row">
        <span>${escHtml(p.nickname)}</span>
        ${pid === state.myId ? '<span class="you-badge" style="font-size:0.7rem">你</span>' : ''}
        <span class="p-status ${statusClass}">${statusText}</span>
      </div>`;
  }).join('');

  // Show/hide areas based on participation
  const isParticipant = state.isParticipant;
  document.getElementById('your-dice-area').style.display = isParticipant ? 'block' : 'none';
  document.getElementById('spectator-hint').style.display = isParticipant ? 'none' : 'block';

  if (isParticipant) {
    renderMyDice();
    const btnRoll = document.getElementById('btn-roll');
    const btnReveal = document.getElementById('btn-reveal');

    if (state.hasRevealed) {
      btnRoll.style.display = 'none';
      btnReveal.style.display = 'none';
    } else if (state.isRollingDice) {
      btnRoll.style.display = 'none';
      btnReveal.style.display = 'none';
    } else if (state.hasRolled) {
      btnRoll.style.display = 'none';
      btnReveal.style.display = 'block';
    } else {
      btnRoll.style.display = 'block';
      btnReveal.style.display = 'none';
    }
  }
}

function renderMyDice() {
  const container = document.getElementById('your-dice');
  if (state.isRollingDice) {
    renderRollingDice();
    return;
  }
  if (state.myDice) {
    container.innerHTML = state.myDice.map(d => diceHTML(d)).join('');
  } else {
    container.innerHTML = Array(5).fill('<div class="die hidden-die"></div>').join('');
  }
}

function rollDice() {
  if (state.hasRolled || state.isRollingDice) return;
  if (!sendMsg({ type: 'roll' })) return;
  beginDiceRollAnimation();
  playRollSound();
}

function receiveMyDice(dice) {
  state.pendingDice = dice;
  state.hasRolled = true;

  if (!state.isRollingDice) {
    finishDiceRollAnimation();
    return;
  }

  const elapsed = Date.now() - rollAnimationStartedAt;
  if (elapsed >= ROLL_ANIMATION_DURATION_MS) {
    finishDiceRollAnimation();
  }
}

function beginDiceRollAnimation() {
  resetDiceRollAnimation();

  state.isRollingDice = true;
  state.pendingDice = null;
  rollingDiceValues = Array.from({ length: 5 }, () => randomDie());
  rollingDiceTick = 0;
  rollAnimationStartedAt = Date.now();

  const container = document.getElementById('your-dice');
  container.classList.add('rolling');
  renderRollingDice();
  renderGame();

  rollAnimationInterval = setInterval(() => {
    const activeIndex = rollingDiceTick % rollingDiceValues.length;
    rollingDiceValues[activeIndex] = randomDie(rollingDiceValues[activeIndex]);
    rollingDiceTick++;
    renderRollingDice(activeIndex);
  }, ROLL_ANIMATION_STEP_MS);

  rollAnimationFinishTimer = setTimeout(() => {
    if (state.pendingDice) finishDiceRollAnimation();
  }, ROLL_ANIMATION_DURATION_MS);
}

function finishDiceRollAnimation() {
  clearDiceRollTimers();

  if (state.pendingDice) {
    state.myDice = state.pendingDice;
    state.pendingDice = null;
  }

  state.isRollingDice = false;
  const container = document.getElementById('your-dice');
  container.classList.remove('rolling');
  renderGame();
}

function resetDiceRollAnimation() {
  clearDiceRollTimers();
  state.pendingDice = null;
  state.isRollingDice = false;
  rollingDiceValues = [];
  rollingDiceTick = 0;

  const container = document.getElementById('your-dice');
  if (container) container.classList.remove('rolling');
}

function clearDiceRollTimers() {
  if (rollAnimationInterval) {
    clearInterval(rollAnimationInterval);
    rollAnimationInterval = null;
  }
  if (rollAnimationFinishTimer) {
    clearTimeout(rollAnimationFinishTimer);
    rollAnimationFinishTimer = null;
  }
}

function renderRollingDice(activeIndex = rollingDiceTick % 5) {
  const container = document.getElementById('your-dice');
  if (!container) return;

  if (rollingDiceValues.length !== 5) {
    rollingDiceValues = Array.from({ length: 5 }, () => randomDie());
  }

  container.innerHTML = rollingDiceValues.map((d, i) =>
    diceHTML(d).replace('class="die ', `class="die rolling-die ${i === activeIndex ? 'rolling-active ' : ''}`)
  ).join('');
}

function randomDie(previous) {
  let next = Math.floor(Math.random() * 6) + 1;
  if (previous && next === previous) next = (next % 6) + 1;
  return next;
}

function revealDice() {
  if (state.hasRevealed) return;
  if (!sendMsg({ type: 'reveal' })) return;
  state.hasRevealed = true;
  renderGame();
}

function showResults(results) {
  document.getElementById('results-area').style.display = 'block';
  document.getElementById('btn-roll').style.display = 'none';
  document.getElementById('btn-reveal').style.display = 'none';

  lastRevealedResults = results;
  diceCountsOnesMode = 'wild';
  renderDiceCounts(results);

  const list = document.getElementById('results-list');
  list.innerHTML = results.map(r => `
    <div class="result-card">
      <div class="result-name">
        ${escHtml(r.nickname)}
        ${r.id === state.myId ? ' (你)' : ''}
      </div>
      <div class="dice-container">
        ${r.dice.map(d => diceHTML(d)).join('')}
      </div>
    </div>
  `).join('');

  document.getElementById('results-buttons').style.display = 'flex';
  document.getElementById('btn-play-again').style.display = 'block';
  document.getElementById('btn-back-lobby').style.flex = '1';
  document.getElementById('btn-back-lobby').style.width = 'auto';
}

function setDiceCountsOnesMode(mode) {
  if (!lastRevealedResults || diceCountsOnesMode === mode) return;
  diceCountsOnesMode = mode;
  renderDiceCounts(lastRevealedResults);
}

function renderDiceCounts(results) {
  const onesAreWild = diceCountsOnesMode === 'wild';
  const totals = calculateDiceTotals(results, onesAreWild);
  const diceNumbers = [2, 3, 4, 5, 6];
  const note = onesAreWild
    ? '1 是万能点；豹子额外加点，真豹子额外 +2'
    : '1 已被叫过：1 只算普通点数，不再加到其他点数';

  document.getElementById('dice-counts').innerHTML = `
    <div class="dice-rule-tabs" role="tablist" aria-label="1 点规则">
      <button
        type="button"
        class="dice-rule-tab ${onesAreWild ? 'active' : ''}"
        role="tab"
        aria-selected="${onesAreWild}"
        onclick="setDiceCountsOnesMode('wild')"
      >1 是万能</button>
      <button
        type="button"
        class="dice-rule-tab ${!onesAreWild ? 'active' : ''}"
        role="tab"
        aria-selected="${!onesAreWild}"
        onclick="setDiceCountsOnesMode('plain')"
      >1 已被叫</button>
    </div>
    <div class="dice-count-note">${note}</div>
    <div class="dice-count-grid">
      ${diceNumbers.map(n => `
        <div class="dice-count-item">
          <span>${n} 点</span>
          <span class="dice-count-value">${totals[n]} 个</span>
        </div>
      `).join('')}
      <div class="dice-count-item">
        <span>${onesAreWild ? '万能 1' : '1 点'}</span>
        <span class="dice-count-value">${onesAreWild ? totals.wild : totals[1]} 个</span>
      </div>
    </div>
  `;
}

function calculateDiceTotals(results, onesAreWild) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const leopardBonus = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let wildBonus = 0;

  results.forEach(r => {
    r.dice.forEach(d => {
      counts[d] += 1;
    });

    if (!onesAreWild) {
      const leopardNumber = r.dice[0];
      if (r.dice.length > 0 && r.dice.every(d => d === leopardNumber)) {
        leopardBonus[leopardNumber] += 2;
      }
      return;
    }

    if (r.dice.length > 0 && r.dice.every(d => d === 1)) {
      wildBonus += 2;
      return;
    }

    const nonWildDice = r.dice.filter(d => d !== 1);
    const leopardNumber = nonWildDice[0];
    const isLeopard = leopardNumber && nonWildDice.every(d => d === leopardNumber);
    if (isLeopard) {
      const hasWildDice = r.dice.length !== nonWildDice.length;
      leopardBonus[leopardNumber] += hasWildDice ? 1 : 2;
    }
  });

  const wildCount = counts[1] + wildBonus;
  return {
    wild: onesAreWild ? wildCount : 0,
    1: onesAreWild ? counts[1] : counts[1] + leopardBonus[1],
    2: counts[2] + (onesAreWild ? wildCount : 0) + leopardBonus[2],
    3: counts[3] + (onesAreWild ? wildCount : 0) + leopardBonus[3],
    4: counts[4] + (onesAreWild ? wildCount : 0) + leopardBonus[4],
    5: counts[5] + (onesAreWild ? wildCount : 0) + leopardBonus[5],
    6: counts[6] + (onesAreWild ? wildCount : 0) + leopardBonus[6],
  };
}

function playAgain() {
  if (!sendMsg({ type: 'start_round' })) return;
  autoRollAfterRoundStart = true;
  document.getElementById('results-area').style.display = 'none';
  lastRevealedResults = null;
  diceCountsOnesMode = 'wild';
}

function maybeAutoRollAfterRoundStart() {
  if (!autoRollAfterRoundStart) return;
  autoRollAfterRoundStart = false;
  if (state.isParticipant) {
    rollDice();
  }
}

function backToLobby() {
  resetDiceRollAnimation();
  autoRollAfterRoundStart = false;
  state.round = null;
  state.myDice = null;
  state.pendingDice = null;
  state.hasRolled = false;
  state.hasRevealed = false;
  state.rolledPlayers.clear();
  state.revealedPlayers.clear();
  lastRevealedResults = null;
  diceCountsOnesMode = 'wild';
  document.getElementById('results-area').style.display = 'none';
  showPage('lobby');
  renderLobby();
}
