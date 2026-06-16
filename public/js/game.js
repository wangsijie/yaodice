// ============ Game Rendering ============
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
  if (state.myDice) {
    container.innerHTML = state.myDice.map(d => diceHTML(d)).join('');
  } else {
    container.innerHTML = Array(5).fill('<div class="die hidden-die"></div>').join('');
  }
}

function rollDice() {
  if (state.hasRolled) return;
  if (!sendMsg({ type: 'roll' })) return;
  playRollSound();
  const container = document.getElementById('your-dice');
  container.classList.add('shaking');
  setTimeout(() => container.classList.remove('shaking'), 600);
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
  // Only host can start next round directly
  document.getElementById('btn-play-again').style.display =
    state.myId === state.hostId ? 'block' : 'none';
  document.getElementById('btn-back-lobby').style.flex =
    state.myId === state.hostId ? '1' : 'unset';
  document.getElementById('btn-back-lobby').style.width =
    state.myId === state.hostId ? 'auto' : '100%';
}

function renderDiceCounts(results) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const leopardBonus = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let wildBonus = 0;

  results.forEach(r => {
    r.dice.forEach(d => {
      counts[d] += 1;
    });

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
  document.getElementById('dice-counts').innerHTML = `
    <div class="dice-count-note">1 是万能点；豹子额外加点，真豹子额外 +2</div>
    <div class="dice-count-grid">
      ${[2, 3, 4, 5, 6].map(n => `
        <div class="dice-count-item">
          <span>${n} 点</span>
          <span class="dice-count-value">${counts[n] + wildCount + leopardBonus[n]} 个</span>
        </div>
      `).join('')}
      <div class="dice-count-item">
        <span>万能 1</span>
        <span class="dice-count-value">${wildCount} 个</span>
      </div>
    </div>
  `;
}

function playAgain() {
  document.getElementById('results-area').style.display = 'none';
  sendMsg({ type: 'start_round' });
}

function backToLobby() {
  state.round = null;
  state.myDice = null;
  state.hasRolled = false;
  state.hasRevealed = false;
  state.rolledPlayers.clear();
  state.revealedPlayers.clear();
  document.getElementById('results-area').style.display = 'none';
  showPage('lobby');
  renderLobby();
}
