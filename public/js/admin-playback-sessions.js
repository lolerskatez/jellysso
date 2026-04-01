// CSRF Token — set via inline bridge script in the EJS view
const csrfToken = window._csrfToken || document.querySelector('meta[name="csrf-token"]')?.content || '';
let allSessions = [];

// Format time in ticks to MM:SS
function formatTime(ticks) {
    if (!ticks) return '0:00';
    const seconds = Math.floor(ticks / 10000000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Get session status badge
function getStatusBadge(session) {
    if (session.playbackState?.isPlaying) {
        return `<span class="session-status status-playing"><i class="fas fa-play"></i> Playing</span>`;
    } else if (session.playbackState?.isPaused) {
        return `<span class="session-status status-paused"><i class="fas fa-pause"></i> Paused</span>`;
    } else {
        return `<span class="session-status status-stopped"><i class="fas fa-stop"></i> Stopped</span>`;
    }
}

// Calculate progress percentage
function getProgressPercentage(session) {
    if (!session.nowPlayingItem?.duration || !session.playbackState?.positionTicks) {
        return 0;
    }
    return (session.playbackState.positionTicks / session.nowPlayingItem.duration) * 100;
}

// Load and display sessions
async function loadSessions() {
    try {
        const response = await fetch('/api/admin/playback/sessions');
        if (!response.ok) throw new Error('Failed to load sessions');

        const data = await response.json();
        allSessions = data.sessions || [];

        // Load stats
        loadStats();

        // Render sessions
        renderSessions(allSessions);
    } catch (error) {
        console.error('Error loading sessions:', error);
        showNotification('Failed to load playback sessions: ' + error.message, 'error');
    }
}

// Load statistics
async function loadStats() {
    try {
        const response = await fetch('/api/admin/playback/sessions/stats');
        if (!response.ok) throw new Error('Failed to load stats');

        const data = await response.json();
        const stats = data.stats;

        document.querySelectorAll('.stat-card')[0].querySelector('.stat-value').textContent = stats.totalSessions;
        document.querySelectorAll('.stat-card')[1].querySelector('.stat-value').textContent = stats.activeSessions;
        document.querySelectorAll('.stat-card')[2].querySelector('.stat-value').textContent = stats.pausedSessions;
        document.querySelectorAll('.stat-card')[3].querySelector('.stat-value').textContent = stats.uniqueUsers;
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Render sessions grouped by user
function renderSessions(sessions) {
    const listContainer = document.getElementById('sessionsList');

    if (sessions.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-check-circle"></i>
                <p>No active playback sessions</p>
            </div>
        `;
        return;
    }

    // Group sessions by user
    const userGroups = {};
    sessions.forEach(session => {
        if (!userGroups[session.userId]) {
            userGroups[session.userId] = {
                userId: session.userId,
                userName: session.userName,
                sessions: []
            };
        }
        userGroups[session.userId].sessions.push(session);
    });

    // Render user sections
    let html = '';
    Object.values(userGroups).forEach((userGroup) => {
        const userInitial = userGroup.userName.charAt(0).toUpperCase();
        html += `
            <div class="user-section">
                <div class="user-header expanded" data-action="toggle-user">
                    <div class="user-header-info">
                        <div class="user-avatar">${userInitial}</div>
                        <div class="user-name">${escapeHtml(userGroup.userName)}</div>
                        <div class="user-session-count">${userGroup.sessions.length} session${userGroup.sessions.length !== 1 ? 's' : ''}</div>
                    </div>
                </div>
                <div class="user-sessions" style="display: block;">
                    ${userGroup.sessions.map(session => createSessionCard(session, userGroup.userName)).join('')}
                </div>
            </div>
        `;
    });

    listContainer.innerHTML = html;
}

// Create session card HTML
function createSessionCard(session, userName) {
    const progress = getProgressPercentage(session);
    const currentTime = formatTime(session.playbackState?.positionTicks || 0);
    const totalTime = formatTime(session.nowPlayingItem?.duration || 0);
    const thumbnail = session.nowPlayingItem?.primaryImageTag 
        ? `https://${window.location.host}/Image/Primary?tag=${session.nowPlayingItem.primaryImageTag}&itemId=${session.nowPlayingItem.id}`
        : '';

    return `
        <div class="session-card" data-session-id="${session.sessionId}">
            <div class="session-thumbnail">
                ${thumbnail ? `<img src="${thumbnail}" alt="${session.nowPlayingItem?.name}">` : '<i class="fas fa-film"></i>'}
            </div>
            <div class="session-info">
                <div class="session-title" title="${session.nowPlayingItem?.name || 'Unknown'}">${escapeHtml(session.nowPlayingItem?.name || 'Unknown')}</div>
                <div class="session-meta">
                    <div class="meta-item" title="Device: ${session.deviceName}">
                        <i class="fas fa-mobile-alt"></i> ${escapeHtml(session.deviceName)}
                    </div>
                    <div class="meta-item" title="App: ${session.appName}">
                        <i class="fas fa-window-restore"></i> ${escapeHtml(session.appName)}
                    </div>
                    <div class="meta-item">${getStatusBadge(session)}</div>
                    <div class="meta-item" title="Client: ${session.client}">
                        <i class="fas fa-info-circle"></i> ${escapeHtml(session.client || 'Unknown')}
                    </div>
                </div>
                <div class="progress-container">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progress}%;"></div>
                    </div>
                    <div class="progress-time">${currentTime} / ${totalTime}</div>
                </div>
            </div>
            <div class="session-controls">
                ${session.playbackState?.isPlaying ? `
                    <button class="control-btn" data-session-id="${session.sessionId}" data-session-user="${escapeHtml(userName)}" data-action="pause">
                        <i class="fas fa-pause"></i> Pause
                    </button>
                ` : ''}
                ${!session.playbackState?.isPlaying ? `
                    <button class="control-btn" data-session-id="${session.sessionId}" data-session-user="${escapeHtml(userName)}" data-action="resume">
                        <i class="fas fa-play"></i> Resume
                    </button>
                ` : ''}
                <button class="control-btn" data-session-id="${session.sessionId}" data-session-user="${escapeHtml(userName)}" data-action="prev" title="Skip to previous">
                    <i class="fas fa-step-backward"></i> Prev
                </button>
                <button class="control-btn" data-session-id="${session.sessionId}" data-session-user="${escapeHtml(userName)}" data-action="next" title="Skip to next">
                    <i class="fas fa-step-forward"></i> Next
                </button>
                <button class="control-btn" data-session-id="${session.sessionId}" data-action="tracks" title="Show track options">
                    <i class="fas fa-closed-captioning"></i> Tracks
                </button>
                <button class="control-btn stop" data-session-id="${session.sessionId}" data-session-user="${escapeHtml(userName)}" data-action="stop">
                    <i class="fas fa-stop"></i> Stop
                </button>
            </div>
            <div class="track-controls-section" id="tracks-${session.sessionId}" style="display: none;">
                <div>
                    <span class="track-label">Audio Track</span>
                    <select class="track-select" id="audio-${session.sessionId}" data-track-type="audio" data-session-id="${session.sessionId}">
                        <option value="">Loading...</option>
                    </select>
                </div>
                <div>
                    <span class="track-label">Subtitles</span>
                    <select class="track-select" id="subtitle-${session.sessionId}" data-track-type="subtitle" data-session-id="${session.sessionId}">
                        <option value="">Loading...</option>
                    </select>
                </div>
            </div>
        </div>
    `;
}

// Load tracks for a session in admin view
async function loadAdminSessionTracks(sessionId) {
    try {
        const response = await fetch(`/api/admin/playback/${sessionId}/tracks`);
        if (!response.ok) return;

        const data = await response.json();
        const tracks = data.tracks;

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

        const subtitleSelect = document.getElementById(`subtitle-${sessionId}`);
        if (subtitleSelect && tracks.subtitleTracks) {
            subtitleSelect.innerHTML = '';
            
            const noneOption = document.createElement('option');
            noneOption.value = '-1';
            noneOption.textContent = '(No Subtitles)';
            if (tracks.currentSubtitleTrack === null || tracks.currentSubtitleTrack === undefined) {
                noneOption.selected = true;
            }
            subtitleSelect.appendChild(noneOption);

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

        const tracksContainer = document.getElementById(`tracks-${sessionId}`);
        if (tracksContainer && (tracks.audioTracks.length > 0 || tracks.subtitleTracks.length > 0)) {
            tracksContainer.style.display = 'grid';
        }
    } catch (error) {
        console.error('Error loading admin tracks:', error);
    }
}

function toggleSessionTracks(sessionId) {
    const tracksContainer = document.getElementById(`tracks-${sessionId}`);
    if (tracksContainer) {
        if (tracksContainer.style.display === 'none') {
            tracksContainer.style.display = 'grid';
            loadAdminSessionTracks(sessionId);
        } else {
            tracksContainer.style.display = 'none';
        }
    }
}

async function changeAdminAudioTrack(sessionId, trackIndex) {
    if (!trackIndex) return;

    try {
        const response = await fetch(`/api/admin/playback/${sessionId}/audio/${trackIndex}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            }
        });

        if (!response.ok) throw new Error('Failed to change audio track');
        showNotification('Audio track changed', 'success');
    } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
        loadAdminSessionTracks(sessionId);
    }
}

async function changeAdminSubtitleTrack(sessionId, trackIndex) {
    if (trackIndex === undefined || trackIndex === '') return;

    try {
        const response = await fetch(`/api/admin/playback/${sessionId}/subtitles/${trackIndex}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            }
        });

        if (!response.ok) throw new Error('Failed to change subtitle track');
        showNotification(trackIndex === '-1' ? 'Subtitles disabled' : 'Subtitle track changed', 'success');
    } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
        loadAdminSessionTracks(sessionId);
    }
}

// Toggle user section expanded/collapsed
function toggleUserSection(header) {
    header.classList.toggle('expanded');
    header.classList.toggle('collapsed');
    const sessions = header.nextElementSibling;
    sessions.style.display = header.classList.contains('expanded') ? 'grid' : 'none';
}

// Control functions
async function pauseSession(sessionId, userName) {
    await controlSession(sessionId, 'pause', userName);
}

async function resumeSession(sessionId, userName) {
    await controlSession(sessionId, 'resume', userName);
}

async function stopSession(sessionId, userName) {
    await controlSession(sessionId, 'stop', userName);
}

async function controlSession(sessionId, action, userName) {
    try {
        const response = await fetch(`/api/admin/playback/${sessionId}/${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({})
        });

        if (!response.ok) throw new Error('Failed to ' + action);

        showNotification(`${action.charAt(0).toUpperCase() + action.slice(1)} on ${userName}'s session`, 'success');
        
        // Refresh after a short delay
        setTimeout(loadSessions, 500);
    } catch (error) {
        console.error('Error:', error);
        showNotification(`Failed to ${action} session: ${error.message}`, 'error');
    }
}

async function stopAllSessions() {
    if (!confirm('Are you sure? This will stop ALL active playback sessions across the system.')) {
        return;
    }

    try {
        document.getElementById('stopAllBtn').disabled = true;
        const response = await fetch('/api/admin/playback/stop-all', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ reason: 'Admin initiated stop all' })
        });

        if (!response.ok) throw new Error('Failed to stop all sessions');

        const data = await response.json();
        showNotification(`Stopped ${data.stopped} playback sessions`, 'success');
        
        // Refresh after a short delay
        setTimeout(loadSessions, 500);
    } catch (error) {
        console.error('Error:', error);
        showNotification(`Failed to stop all sessions: ${error.message}`, 'error');
    } finally {
        document.getElementById('stopAllBtn').disabled = false;
    }
}

async function skipNextAdmin(sessionId, userName) {
    await skipSessionAdmin(sessionId, 'next', userName);
}

async function skipPreviousAdmin(sessionId, userName) {
    await skipSessionAdmin(sessionId, 'previous', userName);
}

async function skipSessionAdmin(sessionId, direction, userName) {
    try {
        const endpoint = direction === 'next' ? '/next' : '/previous';
        const response = await fetch(`/api/admin/playback/${sessionId}/skip${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({})
        });

        if (!response.ok) throw new Error(`Failed to skip ${direction}`);

        showNotification(`Skipped ${direction} on ${userName}'s session`, 'success');
        
        // Refresh after a short delay
        setTimeout(loadSessions, 1000);
    } catch (error) {
        console.error('Error:', error);
        showNotification(`Failed to skip ${direction}: ${error.message}`, 'error');
    }
}

async function refreshSessions() {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('loading');
    await loadSessions();
    btn.classList.remove('loading');
}

// Show notification
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 4000);
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadSessions();
    // Auto-refresh every 10 seconds
    setInterval(loadSessions, 10000);

    // Static buttons
    document.getElementById('refreshBtn').addEventListener('click', refreshSessions);
    document.getElementById('stopAllBtn').addEventListener('click', stopAllSessions);

    // Dynamic session controls (delegated on sessionsList)
    const sessionsList = document.getElementById('sessionsList');

    sessionsList.addEventListener('click', (e) => {
        // User section toggle
        const userHeader = e.target.closest('[data-action="toggle-user"]');
        if (userHeader) { toggleUserSection(userHeader); return; }

        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const sessionId = btn.dataset.sessionId;
        const sessionUser = btn.dataset.sessionUser || '';

        if (action === 'pause')  { pauseSession(sessionId, sessionUser); return; }
        if (action === 'resume') { resumeSession(sessionId, sessionUser); return; }
        if (action === 'stop')   { stopSession(sessionId, sessionUser); return; }
        if (action === 'next')   { skipNextAdmin(sessionId, sessionUser); return; }
        if (action === 'prev')   { skipPreviousAdmin(sessionId, sessionUser); return; }
        if (action === 'tracks') { toggleSessionTracks(sessionId); return; }
    });

    // Track selects (delegated change on sessionsList)
    sessionsList.addEventListener('change', (e) => {
        const sel = e.target.closest('[data-track-type]');
        if (!sel) return;
        const sessionId = sel.dataset.sessionId;
        if (sel.dataset.trackType === 'audio') changeAdminAudioTrack(sessionId, sel.value);
        if (sel.dataset.trackType === 'subtitle') changeAdminSubtitleTrack(sessionId, sel.value);
    });
});
