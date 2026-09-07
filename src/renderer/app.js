'use strict';

const $ = (id) => document.getElementById(id);
const steps = [...document.querySelectorAll('.step-view')];
const stepRows = [...document.querySelectorAll('.step-row')];
const railBtns = [...document.querySelectorAll('.rail-btn[data-step]')];
const stepTitles = ['Upload your file', 'Song identity', 'Release info', 'Credits & details', 'Artwork & advanced', 'Review & save'];
const knownTagKeys = new Set([
  'title','artist','album','album_artist','albumartist','album artist','genre','date','year','track','tracknumber','disc','discnumber',
  'composer','conductor','lyricist','textwriter','publisher','organization','copyright','encoded_by','encodedby','encoder','bpm','tbpm','isrc',
  'grouping','content_group','comment','description','lyrics','unsyncedlyrics','unsynced_lyrics','language','title-sort','titlesort','sort_title',
  'artist-sort','artistsort','sort_artist','album-sort','albumsort','sort_album','compilation','cpil'
]);

const state = {
  step: 0,
  file: null,
  coverAction: 'keep',
  replacementCover: null,
  savedPath: null,
  saving: false
};

const playlistState = {
  entries: [],
  saving: false
};

function playlistPathMode() {
  return document.querySelector('input[name="playlistPathMode"]:checked')?.value || 'relative';
}

function syncPlaylistPathMode() {
  const mode = playlistPathMode();
  $('playlistDevicePathRow').classList.toggle('hidden', mode !== 'device');
  $('playlistDevicePath').disabled = mode !== 'device' || playlistState.saving;
  if (mode === 'device') {
    const root = $('playlistDevicePath').value.trim() || '/Music';
    $('playlistStatus').textContent = `Rockbox paths will use ${root.replace(/\/$/, '') || '/'} + each filename.`;
  }
}

const audio = $('audio');
audio.volume = 0.16;

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  const units = ['B','KB','MB','GB'];
  let value = bytes, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function setStatus(text) {
  $('footerStatus').textContent = text;
  $('statusLeft').textContent = text;
}

function setStep(index) {
  if (index > 0 && !state.file) return;
  state.step = Math.max(0, Math.min(5, index));
  steps.forEach((el, i) => el.classList.toggle('active', i === state.step));
  stepRows.forEach((el, i) => {
    el.classList.toggle('active', i === state.step);
    el.classList.toggle('done', Boolean(state.file) && i < state.step);
  });
  railBtns.forEach((el, i) => el.classList.toggle('active', i === state.step));
  $('sidebarTitle').textContent = stepTitles[state.step];
  $('stepPill').textContent = `${state.step + 1} / 6`;
  $('backBtn').disabled = state.step === 0;
  $('nextBtn').disabled = !state.file || state.saving;
  $('nextBtn').textContent = state.step === 5 ? (state.saving ? 'Saving…' : 'Save metadata') : 'Next →';
  if (state.step === 5) refreshReview();
  document.querySelector('.workspace-scroll').scrollTop = 0;
}

function setUnlocked(unlocked) {
  stepRows.forEach((row, i) => row.classList.toggle('locked', !unlocked && i > 0));
  railBtns.forEach((btn, i) => btn.disabled = !unlocked && i > 0);
}

function getValue(id) { return $(id).value.trim(); }
function setValue(id, value) { $(id).value = value || ''; }

function collectMetadata() {
  return {
    title: getValue('title'), artist: getValue('artist'), noAlbum: $('noAlbum').checked,
    album: getValue('album'), albumArtist: getValue('albumArtist'), grouping: getValue('grouping'),
    genre: getValue('genre'), date: getValue('date'), trackNumber: getValue('trackNumber'), trackTotal: getValue('trackTotal'),
    discNumber: getValue('discNumber'), discTotal: getValue('discTotal'), bpm: getValue('bpm'), language: getValue('language'),
    compilation: $('compilation').checked, composer: getValue('composer'), lyricist: getValue('lyricist'), conductor: getValue('conductor'),
    publisher: getValue('publisher'), copyright: getValue('copyright'), isrc: getValue('isrc'), encodedBy: getValue('encodedBy'),
    encoder: getValue('encoder'), comment: getValue('comment'), lyrics: getValue('lyrics'), titleSort: getValue('titleSort'),
    artistSort: getValue('artistSort'), albumSort: getValue('albumSort'), customTags: collectCustomTags()
  };
}

function fillMetadata(common) {
  for (const [id, key] of Object.entries({
    title:'title', artist:'artist', album:'album', albumArtist:'albumArtist', grouping:'grouping', genre:'genre', date:'date',
    trackNumber:'trackNumber', trackTotal:'trackTotal', discNumber:'discNumber', discTotal:'discTotal', bpm:'bpm', language:'language',
    composer:'composer', lyricist:'lyricist', conductor:'conductor', publisher:'publisher', copyright:'copyright', isrc:'isrc',
    encodedBy:'encodedBy', encoder:'encoder', comment:'comment', lyrics:'lyrics', titleSort:'titleSort', artistSort:'artistSort', albumSort:'albumSort'
  })) setValue(id, common[key]);
  $('noAlbum').checked = !common.album;
  $('compilation').checked = ['1','true','yes'].includes(String(common.compilation || '').toLowerCase());
  syncAlbumState();
}

function syncAlbumState() {
  const noAlbum = $('noAlbum').checked;
  $('album').disabled = noAlbum;
  $('albumArtist').disabled = noAlbum;
  document.querySelector('.album-fields').style.opacity = noAlbum ? '.55' : '1';
}

function renderCustomTags(tags) {
  $('customTags').innerHTML = '';
  const rows = Object.entries(tags || {}).filter(([key]) => !knownTagKeys.has(String(key).toLowerCase()));
  if (!rows.length) renderCustomEmpty();
  else rows.forEach(([key, value]) => addCustomTag(key, value));
}

function renderCustomEmpty() {
  if ($('customTags').children.length) return;
  const empty = document.createElement('div');
  empty.className = 'custom-empty';
  empty.textContent = 'No extra tags yet. Add one if your library uses a custom field.';
  $('customTags').appendChild(empty);
}

function addCustomTag(key = '', value = '') {
  const empty = $('customTags').querySelector('.custom-empty');
  if (empty) empty.remove();
  const row = document.createElement('div');
  row.className = 'custom-tag-row';
  row.innerHTML = '<input class="custom-key" placeholder="Tag key"><input class="custom-value" placeholder="Value"><button title="Remove tag">×</button>';
  row.querySelector('.custom-key').value = key;
  row.querySelector('.custom-value').value = value;
  row.querySelector('button').addEventListener('click', () => { row.remove(); renderCustomEmpty(); });
  $('customTags').appendChild(row);
}

function collectCustomTags() {
  return [...$('customTags').querySelectorAll('.custom-tag-row')].map((row) => ({
    key: row.querySelector('.custom-key').value.trim(), value: row.querySelector('.custom-value').value.trim()
  })).filter((row) => row.key && row.value);
}

function setCoverImage(dataUrl) {
  const targets = [$('coverPreview'), $('playerArt'), $('reviewCover')];
  for (const target of targets) {
    target.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="Cover artwork">` : '<span>♫</span>';
  }
}

function selectCoverAction(action) {
  if (!state.file) return;
  if (action === 'replace' && !state.file.artworkWritable) {
    setStatus(`This ${state.file.extension.toUpperCase()} container does not support MMU artwork replacement.`);
    return;
  }
  state.coverAction = action;
  document.querySelectorAll('[data-cover-action]').forEach((btn) => btn.classList.toggle('active', btn.dataset.coverAction === action));
  if (action === 'keep') setCoverImage(state.file.coverDataUrl);
  if (action === 'remove') setCoverImage(null);
  if (action === 'replace' && state.replacementCover) setCoverImage(state.replacementCover.dataUrl);
}

async function pickReplacementCover() {
  if (!state.file || !state.file.artworkWritable) return selectCoverAction('replace');
  try {
    const result = await window.mmu.media.chooseArtwork();
    if (!result) return;
    state.replacementCover = result;
    selectCoverAction('replace');
    setCoverImage(result.dataUrl);
    setStatus(`Using new artwork: ${result.name}`);
  } catch (error) { setStatus(error.message || 'Could not load artwork.'); }
}

function suggestedOutputName() {
  const meta = collectMetadata();
  const ext = state.file ? state.file.extension : '';
  const base = [meta.artist, meta.title].filter(Boolean).join(' - ') || state.file.fileName.replace(ext, '');
  return `${base} - MMU${ext}`;
}

function refreshReview() {
  if (!state.file) return;
  const meta = collectMetadata();
  $('reviewTitle').textContent = meta.title || 'Untitled song';
  $('reviewArtist').textContent = meta.artist || 'Unknown artist';
  const chips = [];
  if (!meta.noAlbum && meta.album) chips.push(meta.album);
  if (meta.date) chips.push(meta.date);
  if (meta.genre) chips.push(meta.genre);
  if (meta.trackNumber) chips.push(`Track ${meta.trackNumber}${meta.trackTotal ? ` / ${meta.trackTotal}` : ''}`);
  if (meta.discNumber) chips.push(`Disc ${meta.discNumber}${meta.discTotal ? ` / ${meta.discTotal}` : ''}`);
  if (meta.isrc) chips.push(`ISRC ${meta.isrc}`);
  chips.push(`${collectCustomTags().length} custom tag${collectCustomTags().length === 1 ? '' : 's'}`);
  $('reviewChips').innerHTML = chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function updatePlayerLabels() {
  const meta = collectMetadata();
  $('playerTitle').textContent = meta.title || state.file?.fileName || 'Preview';
  $('playerArtist').textContent = `${meta.artist || 'Unknown artist'} · Quiet preview · ${$('volume').value}%`;
}

async function loadFile(probeData) {
  if (!probeData) return;
  state.file = probeData;
  state.replacementCover = null;
  state.coverAction = 'keep';
  state.savedPath = null;
  setUnlocked(true);
  fillMetadata(probeData.common || {});
  renderCustomTags(probeData.tags || {});
  setCoverImage(probeData.coverDataUrl);
  document.querySelectorAll('[data-cover-action]').forEach((btn) => btn.classList.toggle('active', btn.dataset.coverAction === 'keep'));

  $('dropZone').classList.add('hidden');
  $('loadedSummary').classList.remove('hidden');
  $('loadedName').textContent = probeData.fileName;
  $('techFormat').textContent = probeData.extension.replace('.', '').toUpperCase();
  $('techCodec').textContent = probeData.codecShort ? probeData.codecShort.toUpperCase() : probeData.codec;
  $('techDuration').textContent = formatTime(probeData.duration);
  $('techBitrate').textContent = probeData.bitrate ? `${Math.round(probeData.bitrate / 1000)} kbps` : '—';
  $('techSampleRate').textContent = probeData.sampleRate ? `${(probeData.sampleRate / 1000).toFixed(probeData.sampleRate % 1000 ? 1 : 0)} kHz` : '—';
  $('techChannels').textContent = probeData.channels || '—';
  $('sideFileName').textContent = probeData.fileName;
  $('sideFileMeta').textContent = `${probeData.extension.slice(1).toUpperCase()} · ${formatBytes(probeData.size)} · ${formatTime(probeData.duration)}`;
  $('currentFileCard').querySelector('.muted').textContent = 'Current file';
  $('coverSupportNote').textContent = probeData.artworkWritable
    ? (probeData.hasCover ? 'This file already has embedded artwork. You can keep, replace, or remove it.' : 'This format supports embedded cover replacement in MMU.')
    : `MMU can edit tags in ${probeData.extension.toUpperCase()}, but cover replacement is disabled for this container.`;
  $('replaceCoverBtn').disabled = !probeData.artworkWritable;

  audio.src = probeData.previewUrl;
  audio.volume = 0.16;
  $('volume').value = 16;
  $('volumeLabel').textContent = '16%';
  $('playerDock').classList.remove('hidden');
  updatePlayerLabels();
  $('durationTime').textContent = formatTime(probeData.duration);
  $('playPauseBtn').textContent = '❚❚';
  try {
    await audio.play();
    setStatus('File loaded successfully.');
  } catch (_) {
    $('playPauseBtn').textContent = '▶';
    setStatus('File loaded, but failed to autoplay. Select play to start audio.');
  }
  $('nextBtn').disabled = false;
}

async function chooseAudio() {
  try {
    setStatus('Opening music file…');
    const result = await window.mmu.media.chooseAudio();
    if (result) await loadFile(result); else setStatus(state.file ? 'Keeping the current file.' : 'Choose a music file to begin.');
  } catch (error) { setStatus(error.message || 'Could not open this audio file.'); }
}

async function saveMetadata() {
  if (!state.file || state.saving) return;
  state.saving = true;
  setStep(5);
  $('saveResult').classList.add('hidden');
  const replaceOriginal = document.querySelector('input[name="saveMode"]:checked').value === 'replace';
  let outputPath = null;
  try {
    if (!replaceOriginal) {
      outputPath = await window.mmu.media.chooseOutput(state.file.filePath, suggestedOutputName());
      if (!outputPath) { state.saving = false; setStep(5); setStatus('Save cancelled.'); return; }
    }
    setStatus('Writing metadata without re-encoding the audio…');
    const result = await window.mmu.media.save({
      inputPath: state.file.filePath,
      outputPath,
      replaceOriginal,
      metadata: collectMetadata(),
      artwork: { action: state.coverAction, path: state.replacementCover?.path || null }
    });
    state.savedPath = result.outputPath;
    const box = $('saveResult');
    box.style.background = '';
    box.style.borderColor = '';
    box.innerHTML = `<b>✓ Metadata saved</b><span>${result.replacedOriginal ? 'The original file was updated.' : 'A new tagged copy was created.'} ${result.tagsWritten} metadata field${result.tagsWritten === 1 ? '' : 's'} written.</span><button id="revealBtn" class="btn secondary small">Show in folder</button>`;
    box.classList.remove('hidden');
    $('revealBtn').addEventListener('click', () => window.mmu.media.reveal(result.outputPath));
    setStatus('Metadata saved successfully.');
  } catch (error) {
    const box = $('saveResult');
    box.innerHTML = `<b>Could not save metadata</b><span>${escapeHtml(error.message || 'Unknown save error.')}</span>`;
    box.classList.remove('hidden');
    box.style.background = 'rgba(220,38,38,.12)';
    box.style.borderColor = 'rgba(220,38,38,.35)';
    setStatus(error.message || 'Could not save metadata.');
  } finally {
    state.saving = false;
    setStep(5);
  }
}


function playlistEntryLabel(entry) {
  const title = String(entry.title || '').trim();
  const artist = String(entry.artist || '').trim();
  if (artist && title) return `${artist} — ${title}`;
  if (title) return title;
  return String(entry.fileName || 'Untitled track');
}

function renderPlaylist() {
  const list = $('playlistList');
  const entries = playlistState.entries;
  const totalSeconds = entries.reduce((sum, entry) => sum + (Number(entry.duration) || 0), 0);
  $('playlistTrackCount').textContent = `${entries.length} song${entries.length === 1 ? '' : 's'}`;
  $('playlistDuration').textContent = `${formatTime(totalSeconds)} total`;
  $('addPlaylistFilesBtn').disabled = playlistState.saving;
  $('clearPlaylistBtn').disabled = entries.length === 0 || playlistState.saving;
  $('savePlaylistBtn').disabled = entries.length === 0 || playlistState.saving;
  $('savePlaylistBtn').textContent = playlistState.saving ? 'Saving…' : 'Save Playlist';

  if (!entries.length) {
    list.innerHTML = `<div class="playlist-empty"><div class="playlist-empty-icon">♫</div><b>No songs selected yet</b><span>Choose “Select music files” and pick as many tracks as you want.</span></div>`;
    $('playlistStatus').textContent = 'Select one or more songs to make a playlist.';
    return;
  }

  list.innerHTML = entries.map((entry, index) => {
    const artist = String(entry.artist || '').trim();
    const album = String(entry.album || '').trim();
    const details = [artist, album, entry.fileName, formatTime(Number(entry.duration) || 0)].filter(Boolean).join(' · ');
    return `<div class="playlist-item" data-index="${index}">
      <div class="playlist-index">${String(index + 1).padStart(2, '0')}</div>
      <div class="playlist-item-copy"><b>${escapeHtml(playlistEntryLabel(entry))}</b><span>${escapeHtml(details)}</span></div>
      <div class="playlist-item-actions">
        <button class="playlist-icon-btn" data-playlist-action="up" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="playlist-icon-btn" data-playlist-action="down" title="Move down" ${index === entries.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="playlist-icon-btn remove" data-playlist-action="remove" title="Remove">×</button>
      </div>
    </div>`;
  }).join('');
  $('playlistStatus').textContent = `${entries.length} track${entries.length === 1 ? '' : 's'} ready to save.`;
}

function openPlaylistCreator() {
  $('playlistOverlay').classList.remove('hidden');
  $('playlistResult').classList.add('hidden');
  renderPlaylist();
  syncPlaylistPathMode();
  setTimeout(() => $('playlistName').focus(), 0);
}

function closePlaylistCreator() {
  if (playlistState.saving) return;
  $('playlistOverlay').classList.add('hidden');
}

async function addPlaylistFiles() {
  if (playlistState.saving) return;
  try {
    $('playlistStatus').textContent = 'Reading selected songs…';
    const selected = await window.mmu.playlist.chooseAudio();
    if (!selected || !selected.length) {
      renderPlaylist();
      return;
    }
    const existing = new Set(playlistState.entries.map((entry) => entry.filePath));
    let added = 0;
    for (const entry of selected) {
      if (!entry || !entry.filePath || existing.has(entry.filePath)) continue;
      playlistState.entries.push(entry);
      existing.add(entry.filePath);
      added++;
    }
    $('playlistResult').classList.add('hidden');
    renderPlaylist();
    $('playlistStatus').textContent = added
      ? `Added ${added} song${added === 1 ? '' : 's'}. Use the arrows to change playback order.`
      : 'Those songs are already in this playlist.';
  } catch (error) {
    $('playlistStatus').textContent = error.message || 'Could not add those songs.';
  }
}

function movePlaylistEntry(index, direction) {
  const target = index + direction;
  if (index < 0 || target < 0 || index >= playlistState.entries.length || target >= playlistState.entries.length) return;
  const [entry] = playlistState.entries.splice(index, 1);
  playlistState.entries.splice(target, 0, entry);
  $('playlistResult').classList.add('hidden');
  renderPlaylist();
}

async function savePlaylist() {
  if (!playlistState.entries.length || playlistState.saving) return;
  playlistState.saving = true;
  $('playlistResult').classList.add('hidden');
  renderPlaylist();
  $('playlistStatus').textContent = 'Choose where to save the playlist…';
  let finalStatus = '';
  try {
    const mode = playlistPathMode();
    const devicePath = $('playlistDevicePath').value.trim();
    if (mode === 'device' && !devicePath) throw new Error('Enter the Rockbox folder where the songs are stored, such as /Music.');
    const result = await window.mmu.playlist.save({
      name: $('playlistName').value.trim() || 'My Playlist',
      pathMode: mode,
      devicePath,
      entries: playlistState.entries
    });
    if (!result) {
      finalStatus = 'Playlist save cancelled.';
      return;
    }
    const box = $('playlistResult');
    box.style.background = '';
    box.style.borderColor = '';
    box.innerHTML = `<b>✓ Playlist saved</b><span>${result.tracksWritten} song${result.tracksWritten === 1 ? '' : 's'} written to ${escapeHtml(result.outputPath)}.</span><button id="revealPlaylistBtn" class="btn secondary small">Show in folder</button>`;
    box.classList.remove('hidden');
    $('revealPlaylistBtn').addEventListener('click', () => window.mmu.media.reveal(result.outputPath));
    finalStatus = 'M3U8 playlist saved successfully.';
  } catch (error) {
    const box = $('playlistResult');
    box.innerHTML = `<b>Could not save playlist</b><span>${escapeHtml(error.message || 'Unknown playlist save error.')}</span>`;
    box.classList.remove('hidden');
    box.style.background = 'rgba(220,38,38,.12)';
    box.style.borderColor = 'rgba(220,38,38,.35)';
    finalStatus = error.message || 'Could not save playlist.';
  } finally {
    playlistState.saving = false;
    renderPlaylist();
    if (finalStatus) $('playlistStatus').textContent = finalStatus;
  }
}

$('createPlaylistBtn').addEventListener('click', openPlaylistCreator);
$('closePlaylistBtn').addEventListener('click', closePlaylistCreator);
$('cancelPlaylistBtn').addEventListener('click', closePlaylistCreator);
$('addPlaylistFilesBtn').addEventListener('click', addPlaylistFiles);
$('clearPlaylistBtn').addEventListener('click', () => {
  playlistState.entries = [];
  $('playlistResult').classList.add('hidden');
  renderPlaylist();
});
$('savePlaylistBtn').addEventListener('click', savePlaylist);
document.querySelectorAll('input[name="playlistPathMode"]').forEach((input) => {
  input.addEventListener('change', () => {
    $('playlistResult').classList.add('hidden');
    syncPlaylistPathMode();
  });
});
$('playlistDevicePath').addEventListener('input', () => {
  $('playlistResult').classList.add('hidden');
  if (playlistPathMode() === 'device') syncPlaylistPathMode();
});
$('playlistList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-playlist-action]');
  const row = event.target.closest('.playlist-item');
  if (!button || !row) return;
  const index = Number(row.dataset.index);
  const action = button.dataset.playlistAction;
  if (action === 'up') movePlaylistEntry(index, -1);
  if (action === 'down') movePlaylistEntry(index, 1);
  if (action === 'remove') {
    playlistState.entries.splice(index, 1);
    $('playlistResult').classList.add('hidden');
    renderPlaylist();
  }
});
$('playlistOverlay').addEventListener('click', (event) => {
  if (event.target === $('playlistOverlay')) closePlaylistCreator();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('playlistOverlay').classList.contains('hidden')) closePlaylistCreator();
});

$('dropZone').addEventListener('click', chooseAudio);
$('changeFileBtn').addEventListener('click', chooseAudio);
$('noAlbum').addEventListener('change', syncAlbumState);
$('addTagBtn').addEventListener('click', () => addCustomTag());
$('keepCoverBtn').addEventListener('click', () => selectCoverAction('keep'));
$('replaceCoverBtn').addEventListener('click', pickReplacementCover);
$('removeCoverBtn').addEventListener('click', () => selectCoverAction('remove'));

$('backBtn').addEventListener('click', () => setStep(state.step - 1));
$('nextBtn').addEventListener('click', () => state.step === 5 ? saveMetadata() : setStep(state.step + 1));
stepRows.forEach((row) => row.addEventListener('click', () => { if (!row.classList.contains('locked')) setStep(Number(row.dataset.step)); }));
railBtns.forEach((btn) => btn.addEventListener('click', () => { if (!btn.disabled) setStep(Number(btn.dataset.step)); }));

document.addEventListener('dragover', (event) => { event.preventDefault(); $('dropZone').classList.add('dragging'); });
document.addEventListener('dragleave', () => $('dropZone').classList.remove('dragging'));
document.addEventListener('drop', async (event) => {
  event.preventDefault(); $('dropZone').classList.remove('dragging');
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  if (!file.path) return setStatus('Drag-and-drop path access is unavailable here. Use “Choose a music file”.');
  try { await loadFile(await window.mmu.media.probe(file.path)); } catch (error) { setStatus(error.message || 'Could not read that file.'); }
});

$('playPauseBtn').addEventListener('click', async () => {
  if (!state.file) return;
  if (audio.paused) { try { await audio.play(); } catch (_) {} } else audio.pause();
});
audio.addEventListener('play', () => $('playPauseBtn').textContent = '❚❚');
audio.addEventListener('pause', () => $('playPauseBtn').textContent = '▶');
audio.addEventListener('timeupdate', () => {
  $('currentTime').textContent = formatTime(audio.currentTime);
  if (audio.duration) $('seek').value = Math.round((audio.currentTime / audio.duration) * 1000);
});
audio.addEventListener('loadedmetadata', () => $('durationTime').textContent = formatTime(audio.duration));
$('seek').addEventListener('input', () => { if (audio.duration) audio.currentTime = (Number($('seek').value) / 1000) * audio.duration; });
$('volume').addEventListener('input', () => {
  const value = Number($('volume').value);
  audio.volume = value / 100;
  $('volumeLabel').textContent = `${value}%`;
  updatePlayerLabels();
});

for (const id of ['title','artist','album','albumArtist']) $(id).addEventListener('input', updatePlayerLabels);
document.querySelectorAll('input[name="saveMode"]').forEach((radio) => radio.addEventListener('change', () => {
  document.querySelectorAll('.save-option').forEach((label) => label.classList.toggle('active', label.contains(document.querySelector('input[name="saveMode"]:checked'))));
}));

$('themeBtn').addEventListener('click', () => document.body.classList.toggle('midnight'));
$('minBtn').addEventListener('click', () => window.mmu.window.minimize());
$('maxBtn').addEventListener('click', () => window.mmu.window.toggleMaximize());
$('closeBtn').addEventListener('click', () => window.mmu.window.close());

(async () => {
  setUnlocked(false);
  try {
    document.body.dataset.platform = await window.mmu.app.getPlatform();
    $('versionText').textContent = `MMU v${await window.mmu.app.getVersion()}`;
  } catch (_) {}
  setStep(0);
})();
