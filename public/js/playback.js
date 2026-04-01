const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]').content;
let sessionRefreshInterval;

// Logout handler
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  window.location.href = '/api/auth/logout';
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSessions();
  // Refresh sessions every 5 seconds
  sessionRefreshInterval = setInterval(loadSessions, 5000);

  // Delegated session control listeners on sessions-container
  const sessionsContainer = document.getElementById('sessions-container');

  sessionsContainer.addEventListener('click', (e) => {
    // Progress bar seek
    const seekBar = e.target.closest('[data-seek-session]');
    if (seekBar) {
      if (typeof seekSession === 'function') seekSession(seekBar.dataset.seekSession, e);
      return;
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const sessionId = btn.dataset.sessionId;
    if (action === 'pause')  { pauseSession(sessionId); return; }
    if (action === 'resume') { resumeSession(sessionId); return; }
    if (action === 'stop')   { stopSession(sessionId); return; }
    if (action === 'next')   { skipNext(sessionId); return; }
    if (action === 'prev')   { skipPrevious(sessionId); return; }
    if (action === 'tracks') { toggleTracks(sessionId); return; }
  });

  sessionsContainer.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-track-type]');
    if (!sel) return;
    const sessionId = sel.dataset.sessionId;
    if (sel.dataset.trackType === 'audio')    changeAudioTrack(sessionId, sel.value);
    if (sel.dataset.trackType === 'subtitle') changeSubtitleTrack(sessionId, sel.value);
  });
});

async function loadSessions() {
  const loading = document.getElementById('loading');
  const container = document.getElementById('sessions-container');
  const noSessions = document.getElementById('no-sessions');

  loading.style.display = 'flex';
  container.style.display = 'none';
  noSessions.style.display = 'none';

  try {
    const response = await fetch('/api/playback/user/sessions', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    loading.style.display = 'none';

    if (data.sessions && data.sessions.length > 0) {
      renderSessions(data.sessions);
      container.style.display = 'grid';
    } else {
      noSessions.style.display = 'block';
    }
  } catch (error) {
    loading.style.display = 'none';
    showError(`Failed to load sessions: ${error.message}`);
    noSessions.style.display = 'block';
  }
}

function renderSessions(sessions) {
  const container = document.getElementById('sessions-container');
  const noSessions = document.getElementById('no-sessions');
  container.innerHTML = '';

  // Filter to only show sessions with active playback (have a nowPlayingItem)
  const playingSessions = sessions.filter(session => session.isPlaying && session.nowPlayingItem);

  if (playingSessions.length === 0) {
    container.style.display = 'none';
    noSessions.style.display = 'block';
    return;
  }

  playingSessions.forEach(session => {
    const card = createSessionCard(session);
    container.appendChild(card);
  });
}

function createSessionCard(session) {
  const card = document.createElement('div');
  card.className = 'session-card';

  const statusClass = session.playbackState?.isPlaying ? 'playing' 
    : session.playbackState?.isPaused ? 'paused' 
    : 'stopped';

  const statusText = session.playbackState?.isPlaying ? 'Playing' 
    : session.playbackState?.isPaused ? 'Paused' 
    : 'Stopped';

  const thumbnailUrl = session.nowPlayingItem?.primaryImageUrl || '';
  const itemName = session.nowPlayingItem?.name || 'Unknown';
  const seriesInfo = session.nowPlayingItem?.seriesName 
    ? `${session.nowPlayingItem.seriesName}` + 
      (session.nowPlayingItem.seasonName ? ` - ${session.nowPlayingItem.seasonName}` : '') +
      (session.nowPlayingItem.episodeNumber ? ` E${session.nowPlayingItem.episodeNumber}` : '')
    : '';

  // Calculate progress percentage
  const duration = session.playbackState?.duration || 0;
  const position = session.playbackState?.position || 0;
  const progressPercent = duration > 0 ? Math.round((position / duration) * 100) : 0;

  card.innerHTML = `
    <div class="session-thumbnail">
      ${thumbnailUrl ? `<img src="${thumbnailUrl}" alt="${itemName}">` : '<i class="fas fa-film"></i>'}
      <div class="status-badge ${statusClass}">
        <i class="fas fa-${statusClass === 'playing' ? 'play' : statusClass === 'paused' ? 'pause' : 'stop'}"></i>
        ${statusText}
      </div>
    </div>
    
    <div class="session-content">
      <div class="session-title">${itemName}</div>
      ${seriesInfo ? `<div class="session-subtitle">${seriesInfo}</div>` : ''}
      
      <div class="session-info">
        <div class="session-info-row">
          <span class="session-info-label">
            <i class="fas fa-tv"></i>
            Device
          </span>
          <span>${session.deviceName || 'Unknown'}</span>
        </div>
        <div class="session-info-row">
          <span class="session-info-label">
            <i class="fas fa-mobile-alt"></i>
            App
          </span>
          <span>${session.appName || 'Unknown'}</span>
        </div>
      </div>

      ${session.playbackState ? `
        <div class="session-progress">
          <div class="progress-bar" data-seek-session="${session.sessionId}">
            <div class="progress-fill" style="width: ${progressPercent}%"></div>
          </div>
          <div class="progress-time">
            <span>${formatTime(position)}</span>
            <span>${formatTime(duration)}</span>
          </div>
        </div>
      ` : ''}

      <div class="track-controls" id="tracks-${session.sessionId}" style="display: none;">
        <div class="track-control">
          <label for="audio-${session.sessionId}">Audio Track</label>
          <select id="audio-${session.sessionId}" data-track-type="audio" data-session-id="${session.sessionId}">
            <option value="">Loading...</option>
          </select>
        </div>
        <div class="track-control">
          <label for="subtitle-${session.sessionId}">Subtitles</label>
          <select id="subtitle-${session.sessionId}" data-track-type="subtitle" data-session-id="${session.sessionId}">
            <option value="">Loading...</option>
          </select>
        </div>
      </div>

      <div class="session-controls">
        ${session.playbackState?.isPlaying ? `
          <button class="control-btn secondary" data-action="pause" data-session-id="${session.sessionId}">
            <i class="fas fa-pause"></i>
            Pause
          </button>
        ` : `
          <button class="control-btn primary" data-action="resume" data-session-id="${session.sessionId}">
            <i class="fas fa-play"></i>
            Play
          </button>
        `}
        <button class="control-btn secondary" data-action="prev" data-session-id="${session.sessionId}" title="Skip to previous">
          <i class="fas fa-step-backward"></i>
          Prev
        </button>
        <button class="control-btn secondary" data-action="next" data-session-id="${session.sessionId}" title="Skip to next">
          <i class="fas fa-step-forward"></i>
          Next
        </button>
        <button class="control-btn secondary" data-action="tracks" data-session-id="${session.sessionId}" title="Show track options">
          <i class="fas fa-closed-captioning"></i>
          Tracks
        </button>
        <button class="control-btn danger" data-action="stop" data-session-id="${session.sessionId}">
          <i class="fas fa-stop"></i>
          Stop
        </button>
      </div>
    </div>
  `;

  card.dataset.sessionId = session.sessionId;
  
  // Load tracks after card is added
  setTimeout(() => loadSessionTracks(session.sessionId), 100);

  return card;
}

async function pauseSession(sessionId) {
  await sendCommand(sessionId, '/pause', 'Paused');
}

async function resumeSession(sessionId) {
  await sendCommand(sessionId, '/resume', 'Resumed');
}

async function stopSession(sessionId) {
  await sendCommand(sessionId, '/stop', 'Stopped');
}

async function sendCommand(sessionId, endpoint, action) {
  try {
    const realEndpoint = `/api/playback/${sessionId}${endpoint}`;
    const realResponse = await fetch(realEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': CSRF_TOKEN
      },
      credentials: 'include'
    });

    if (!realResponse.ok) {
      throw new Error(`HTTP ${realResponse.status}`);
    }

    showSuccess(`Playback ${action.toLowerCase()} on device`);
    await loadSessions();
  } catch (error) {
    showError(`Failed to ${action.toLowerCase()}: ${error.message}`);
  }
}

function formatTime(ticks) {
  if (!ticks) return '0:00';
  // Convert from Jellyfin ticks (100-nanosecond intervals) to seconds
  const seconds = Math.round(ticks / 10000000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function showError(message) {
  const messagesDiv = document.getElementById('messages');
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>${message}</span>`;
  messagesDiv.appendChild(errorDiv);

  setTimeout(() => {
    errorDiv.remove();
  }, 5000);
}

function showSuccess(message) {
  const messagesDiv = document.getElementById('messages');
  const successDiv = document.createElement('div');
  successDiv.className = 'success-message';
  successDiv.innerHTML = `<i class="fas fa-check-circle"></i><span>${message}</span>`;
  messagesDiv.appendChild(successDiv);

  setTimeout(() => {
    successDiv.remove();
  }, 3000);
}

async function loadSessionTracks(sessionId) {
  try {
    const response = await fetch(`/api/playback/user/${sessionId}/tracks`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load tracks:', response.status);
      return;
    }

    const data = await response.json();
    const tracks = data.tracks;

    // Populate audio track dropdown
    const audioSelect = document.getElementById(`audio-${sessionId}`);
    if (audioSelect && tracks.audioTracks) {
      audioSelect.innerHTML = '';
      tracks.audioTracks.forEach(track => {
        const option = document.createElement('option');
        option.value = track.id;
        option.textContent = track.displayName;
        if (track.id === tracks.currentAudioTrack) {
          option.selected = true;
        }
        audioSelect.appendChild(option);
      });
    }

    // Populate subtitle track dropdown
    const subtitleSelect = document.getElementById(`subtitle-${sessionId}`);
    if (subtitleSelect && tracks.subtitleTracks) {
      subtitleSelect.innerHTML = '';
      
      // Add "No Subtitles" option
      const noneOption = document.createElement('option');
      noneOption.value = '-1';
      noneOption.textContent = '(No Subtitles)';
      if (tracks.currentSubtitleTrack === null || tracks.currentSubtitleTrack === undefined) {
        noneOption.selected = true;
      }
      subtitleSelect.appendChild(noneOption);

      // Add subtitle options
      tracks.subtitleTracks.forEach(track => {
        const option = document.createElement('option');
        option.value = track.id;
        option.textContent = track.displayName;
        if (track.id === tracks.currentSubtitleTrack) {
          option.selected = true;
        }
        subtitleSelect.appendChild(option);
      });
    }

    // Show track controls if tracks are available
    const tracksContainer = document.getElementById(`tracks-${sessionId}`);
    if (tracksContainer && (tracks.audioTracks.length > 0 || tracks.subtitleTracks.length > 0)) {
      tracksContainer.style.display = 'grid';
    }
  } catch (error) {
    console.error('Error loading tracks:', error);
  }
}

function toggleTracks(sessionId) {
  const tracksContainer = document.getElementById(`tracks-${sessionId}`);
  if (tracksContainer) {
    tracksContainer.style.display = tracksContainer.style.display === 'none' ? 'grid' : 'none';
  }
}

async function changeAudioTrack(sessionId, trackIndex) {
  if (!trackIndex) return;

  try {
    const response = await fetch(`/api/playback/user/${sessionId}/audio/${trackIndex}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': CSRF_TOKEN
      },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    showSuccess('Audio track changed');
  } catch (error) {
    showError(`Failed to change audio track: ${error.message}`);
    // Reload tracks to revert selection
    loadSessionTracks(sessionId);
  }
}

async function changeSubtitleTrack(sessionId, trackIndex) {
  if (trackIndex === undefined || trackIndex === '') return;

  try {
    const response = await fetch(`/api/playback/user/${sessionId}/subtitles/${trackIndex}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': CSRF_TOKEN
      },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    showSuccess(trackIndex === '-1' ? 'Subtitles disabled' : 'Subtitle track changed');
  } catch (error) {
    showError(`Failed to change subtitle track: ${error.message}`);
    // Reload tracks to revert selection
    loadSessionTracks(sessionId);
  }
}

async function skipNext(sessionId) {
  try {
    const response = await fetch(`/api/playback/user/${sessionId}/skip/next`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': CSRF_TOKEN
      },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    showSuccess('Skipped to next item');
    // Reload sessions to show new item
    setTimeout(loadSessions, 1000);
  } catch (error) {
    showError(`Failed to skip to next: ${error.message}`);
  }
}

async function skipPrevious(sessionId) {
  try {
    const response = await fetch(`/api/playback/user/${sessionId}/skip/previous`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': CSRF_TOKEN
      },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    showSuccess('Skipped to previous item');
    // Reload sessions to show new item
    setTimeout(loadSessions, 1000);
  } catch (error) {
    showError(`Failed to skip to previous: ${error.message}`);
  }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (sessionRefreshInterval) {
    clearInterval(sessionRefreshInterval);
  }
});
