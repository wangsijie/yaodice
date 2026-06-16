// ============ Helpers ============
function diceHTML(n) {
  const layouts = {
    1: [[2,2]],
    2: [[1,3],[3,1]],
    3: [[1,3],[2,2],[3,1]],
    4: [[1,1],[1,3],[3,1],[3,3]],
    5: [[1,1],[1,3],[2,2],[3,1],[3,3]],
    6: [[1,1],[1,3],[2,1],[2,3],[3,1],[3,3]],
  };
  const dots = (layouts[n] || []).map(([r,c]) =>
    `<span class="dot" style="grid-row:${r};grid-column:${c}"></span>`
  ).join('');
  return `<div class="die die-${n}">${dots}</div>`;
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function showToast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function hideError(id) {
  const el = document.getElementById(id);
  el.textContent = '';
  el.style.display = 'none';
}

function resetJoinPending() {
  joinPending = false;
  const confirmBtn = document.getElementById('btn-confirm-nickname');
  const randomBtn = document.getElementById('btn-random-nick');
  if (confirmBtn) confirmBtn.disabled = false;
  if (randomBtn) randomBtn.disabled = false;
}
