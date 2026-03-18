// ── URL Params ───────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const roomId   = params.get('room');
const username = params.get('username') || 'ผู้ชม';
const isHostParam = params.get('host') === '1';

if (!roomId || !username || username === 'ผู้ชม' && !isHostParam) {
  // Missing params — go back
  if (!roomId) { window.location.href = '/'; }
}

// ── State ────────────────────────────────────────────────────────────────
let player       = null;
let isHost       = false;
let mySocketId   = null;
let playerReady  = false;
let isSyncing    = false;
let syncTimeout  = null;

// ── Socket ───────────────────────────────────────────────────────────────
const socket = io();

socket.on('connect', () => {
  mySocketId = socket.id;
  if (isHostParam) {
    socket.emit('create-room', { roomId, username });
  } else {
    socket.emit('join-room', { roomId, username });
  }
});

socket.on('room-created', ({ roomId: rid }) => {
  isHost = true;
  document.getElementById('room-code-display').textContent = rid;
  document.getElementById('video-input-bar').style.display = 'flex';
  document.getElementById('placeholder-text').textContent = 'วางลิงก์ YouTube ด้านบนเพื่อเริ่มดู';
});

socket.on('room-joined', ({ roomId: rid, videoId, state, currentTime, isHost: h }) => {
  isHost = h;
  document.getElementById('room-code-display').textContent = rid;
  if (h) {
    document.getElementById('video-input-bar').style.display = 'flex';
  }
  if (videoId) {
    waitForYTAndCreate(videoId, state, currentTime);
  }
});

socket.on('room-update', (data) => {
  if (!data) return;
  document.getElementById('room-code-display').textContent = data.roomId;
  document.getElementById('user-count').textContent = `👥 ${data.users.length} คน`;
  renderUsers(data.users);

  const me = data.users.find(u => u.id === mySocketId);
  if (me && me.isHost && !isHost) {
    isHost = true;
    document.getElementById('video-input-bar').style.display = 'flex';
    document.getElementById('player-overlay').style.display = 'none';
    showToast('คุณได้รับตำแหน่งโฮสต์แล้ว 👑');
  }
});

socket.on('video-changed', ({ videoId }) => {
  waitForYTAndCreate(videoId, 'paused', 0);
});

socket.on('sync-player', ({ state, currentTime }) => {
  if (!player || !playerReady || isHost) return;
  isSyncing = true;
  const diff = Math.abs(player.getCurrentTime() - currentTime);
  if (diff > 2) player.seekTo(currentTime, true);
  if (state === 'playing') player.playVideo();
  else player.pauseVideo();
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => { isSyncing = false; }, 500);

  const el = document.getElementById('sync-status');
  el.textContent = '✓ ซิงค์แล้ว';
  setTimeout(() => { el.textContent = ''; }, 2000);
});

socket.on('sync-seek', ({ currentTime }) => {
  if (!player || !playerReady || isHost) return;
  player.seekTo(currentTime, true);
});

socket.on('host-changed', ({ newHostId }) => {
  if (newHostId === mySocketId) {
    isHost = true;
    document.getElementById('video-input-bar').style.display = 'flex';
    document.getElementById('player-overlay').style.display = 'none';
    showToast('คุณได้รับตำแหน่งโฮสต์แล้ว 👑');
  }
});

socket.on('chat-message', (msg) => {
  appendChat(msg);
});

socket.on('error', ({ message }) => {
  showToast(message, true);
  setTimeout(() => { window.location.href = '/'; }, 3000);
});

// ── YouTube IFrame API ───────────────────────────────────────────────────
(function loadYTScript() {
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
})();

window.onYouTubeIframeAPIReady = function () {
  // API ready — player will be created when video is set
};

function createPlayer(videoId) {
  document.getElementById('player-placeholder').classList.add('hidden');
  document.getElementById('player-container').classList.remove('hidden');
  document.getElementById('now-playing').style.display = 'flex';
  document.getElementById('np-title').textContent = `youtu.be/${videoId}`;

  if (player) {
    player.loadVideoById(videoId);
    return;
  }

  player = new YT.Player('yt-player', {
    height: '100%',
    width: '100%',
    videoId,
    playerVars: {
      autoplay: 1,
      controls: isHost ? 1 : 0,
      disablekb: isHost ? 0 : 1,
      modestbranding: 1,
      rel: 0,
      fs: 1
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange
    }
  });
}

function onPlayerReady() {
  playerReady = true;
  if (!isHost) {
    socket.emit('request-sync');
    document.getElementById('player-overlay').style.display = 'block';
  }
}

function onPlayerStateChange(event) {
  if (!isHost || !playerReady || isSyncing) return;

  const state       = event.data;
  const currentTime = player.getCurrentTime();

  if (state === YT.PlayerState.PLAYING) {
    socket.emit('player-state', { state: 'playing', currentTime });
  } else if (state === YT.PlayerState.PAUSED) {
    socket.emit('player-state', { state: 'paused', currentTime });
    socket.emit('player-seek', { currentTime });
  }
}

// Periodic time sync from host
setInterval(() => {
  if (isHost && player && playerReady && player.getPlayerState() === YT.PlayerState.PLAYING) {
    socket.emit('player-state', { state: 'playing', currentTime: player.getCurrentTime() });
  }
}, 3000);

// ── Helpers ──────────────────────────────────────────────────────────────
function waitForYTAndCreate(videoId, state, currentTime) {
  if (window.YT && window.YT.Player) {
    createPlayer(videoId);
    if (!isHost) {
      setTimeout(() => {
        if (player && playerReady) {
          if (currentTime > 0) player.seekTo(currentTime, true);
          if (state === 'playing') player.playVideo();
          else player.pauseVideo();
        }
      }, 1500);
    }
  } else {
    setTimeout(() => waitForYTAndCreate(videoId, state, currentTime), 300);
  }
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) return m[1];
  }
  return null;
}

function setVideo() {
  const url     = document.getElementById('video-url-input').value.trim();
  const videoId = extractVideoId(url);
  if (!videoId) { showToast('URL ไม่ถูกต้อง กรุณาใส่ลิงก์ YouTube', true); return; }
  socket.emit('set-video', { videoId });
  document.getElementById('video-url-input').value = '';
}

function copyRoomCode() {
  const code = document.getElementById('room-code-display').textContent;
  navigator.clipboard.writeText(code).then(() => {
    showToast('คัดลอกรหัสห้องแล้ว! แชร์ให้เพื่อน 🎉');
  }).catch(() => {
    showToast('รหัสห้อง: ' + code);
  });
}

function sendChat() {
  const input   = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;
  socket.emit('send-chat', { message });
  input.value = '';
}

function renderUsers(users) {
  const list = document.getElementById('user-list');
  list.innerHTML = users.map(u => `
    <div class="user-item ${u.isHost ? 'host' : ''}">
      <span class="user-avatar">${escapeHtml(u.name.charAt(0).toUpperCase())}</span>
      <span class="user-name">${escapeHtml(u.name)}</span>
      ${u.isHost ? '<span class="host-tag">👑</span>' : ''}
      ${u.id === mySocketId ? '<span class="you-tag">(คุณ)</span>' : ''}
    </div>
  `).join('');
}

function appendChat({ system, username: uname, message, timestamp }) {
  const container = document.getElementById('chat-messages');
  const div       = document.createElement('div');
  if (system) {
    div.className   = 'chat-system';
    div.textContent = message;
  } else {
    div.className   = 'chat-msg';
    div.innerHTML   = `
      <div class="msg-header">
        <span class="msg-user">${escapeHtml(uname)}</span>
        <span class="msg-time">${timestamp || ''}</span>
      </div>
      <div class="msg-body">${escapeHtml(message)}</div>
    `;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function showToast(msg, isError = false) {
  const toast     = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
  setTimeout(() => { toast.className = 'toast hidden'; }, 3500);
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}
