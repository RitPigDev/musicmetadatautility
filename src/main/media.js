'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.mp4', '.flac', '.ogg', '.opus', '.wav']);
const ARTWORK_OUTPUT_EXTENSIONS = new Set(['.mp3', '.m4a', '.mp4', '.flac']);

function unpackedPath(binaryPath) {
  if (!binaryPath) return binaryPath;
  const candidate = binaryPath.replace('app.asar', 'app.asar.unpacked');
  return candidate !== binaryPath && fs.existsSync(candidate) ? candidate : binaryPath;
}

function resolveFFmpeg() {
  try { return unpackedPath(require('ffmpeg-static')); } catch (_) { return 'ffmpeg'; }
}

function resolveFFprobe() {
  try { return unpackedPath(require('ffprobe-static').path); } catch (_) { return 'ffprobe'; }
}

const FFMPEG = resolveFFmpeg();
const FFPROBE = resolveFFprobe();

function ensureAudioPath(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid audio file path.');
  if (!fs.existsSync(filePath)) throw new Error('The selected audio file no longer exists.');
  const ext = path.extname(filePath).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) throw new Error(`Unsupported audio format: ${ext || 'unknown'}`);
  return ext;
}

function lowerTagMap(tags = {}) {
  const out = {};
  for (const [key, value] of Object.entries(tags || {})) {
    if (value === undefined || value === null) continue;
    out[String(key).toLowerCase()] = String(value);
  }
  return out;
}

function first(tags, keys) {
  for (const key of keys) {
    const value = tags[key];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function parseFraction(value) {
  const text = String(value || '').trim();
  if (!text) return { number: '', total: '' };
  const [number = '', total = ''] = text.split('/');
  return { number, total };
}

function extractCoverDataUrl(filePath, hasCover) {
  if (!hasCover) return null;
  try {
    const buffer = execFileSync(FFMPEG, [
      '-v', 'error', '-i', filePath,
      '-map', '0:v:0', '-frames:v', '1',
      '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'
    ], { maxBuffer: 20 * 1024 * 1024, windowsHide: true });
    if (!buffer || !buffer.length) return null;
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (_) {
    return null;
  }
}

function probe(filePath) {
  const ext = ensureAudioPath(filePath);
  const result = spawnSync(FFPROBE, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, windowsHide: true });

  if (result.error) throw new Error(`Could not run ffprobe: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr || 'ffprobe could not read this file.');

  const data = JSON.parse(result.stdout || '{}');
  const audioStream = (data.streams || []).find((stream) => stream.codec_type === 'audio') || {};
  const coverStream = (data.streams || []).find((stream) => stream.codec_type === 'video' && stream.disposition && stream.disposition.attached_pic === 1);
  const formatTags = lowerTagMap((data.format || {}).tags || {});
  const streamTags = lowerTagMap(audioStream.tags || {});
  const tags = { ...streamTags, ...formatTags };
  const track = parseFraction(first(tags, ['track', 'tracknumber']));
  const disc = parseFraction(first(tags, ['disc', 'discnumber']));
  const hasCover = Boolean(coverStream);

  return {
    filePath,
    previewUrl: pathToFileURL(filePath).href,
    fileName: path.basename(filePath),
    extension: ext,
    size: Number((data.format || {}).size || 0),
    duration: Number((data.format || {}).duration || audioStream.duration || 0),
    bitrate: Number((data.format || {}).bit_rate || audioStream.bit_rate || 0),
    codec: audioStream.codec_long_name || audioStream.codec_name || 'Unknown',
    codecShort: audioStream.codec_name || '',
    sampleRate: Number(audioStream.sample_rate || 0),
    channels: Number(audioStream.channels || 0),
    hasCover,
    coverDataUrl: extractCoverDataUrl(filePath, hasCover),
    artworkWritable: ARTWORK_OUTPUT_EXTENSIONS.has(ext),
    tags,
    common: {
      title: first(tags, ['title']),
      artist: first(tags, ['artist']),
      album: first(tags, ['album']),
      albumArtist: first(tags, ['album_artist', 'albumartist', 'album artist']),
      genre: first(tags, ['genre']),
      date: first(tags, ['date', 'year']),
      trackNumber: track.number,
      trackTotal: track.total,
      discNumber: disc.number,
      discTotal: disc.total,
      composer: first(tags, ['composer']),
      conductor: first(tags, ['conductor']),
      lyricist: first(tags, ['lyricist', 'textwriter']),
      publisher: first(tags, ['publisher', 'organization']),
      copyright: first(tags, ['copyright']),
      encodedBy: first(tags, ['encoded_by', 'encodedby']),
      encoder: first(tags, ['encoder']),
      bpm: first(tags, ['bpm', 'tbpm']),
      isrc: first(tags, ['isrc']),
      grouping: first(tags, ['grouping', 'content_group']),
      comment: first(tags, ['comment', 'description']),
      lyrics: first(tags, ['lyrics', 'unsyncedlyrics', 'unsynced_lyrics']),
      language: first(tags, ['language']),
      titleSort: first(tags, ['title-sort', 'titlesort', 'sort_title']),
      artistSort: first(tags, ['artist-sort', 'artistsort', 'sort_artist']),
      albumSort: first(tags, ['album-sort', 'albumsort', 'sort_album']),
      compilation: first(tags, ['compilation', 'cpil'])
    }
  };
}

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function buildMetadataTags(metadata = {}) {
  const tags = {};
  const add = (key, value) => {
    const text = clean(value);
    if (text !== '') tags[key] = text;
  };

  for (const row of Array.isArray(metadata.customTags) ? metadata.customTags : []) {
    const key = clean(row && row.key);
    const value = clean(row && row.value);
    if (key && value) tags[key] = value;
  }

  add('title', metadata.title);
  add('artist', metadata.artist);
  if (!metadata.noAlbum) {
    add('album', metadata.album);
    add('album_artist', metadata.albumArtist);
  }
  add('genre', metadata.genre);
  add('date', metadata.date);
  add('composer', metadata.composer);
  add('conductor', metadata.conductor);
  add('lyricist', metadata.lyricist);
  add('publisher', metadata.publisher);
  add('copyright', metadata.copyright);
  add('encoded_by', metadata.encodedBy);
  add('encoder', metadata.encoder);
  add('bpm', metadata.bpm);
  add('isrc', metadata.isrc);
  add('grouping', metadata.grouping);
  add('comment', metadata.comment);
  add('lyrics', metadata.lyrics);
  add('language', metadata.language);
  add('title-sort', metadata.titleSort);
  add('artist-sort', metadata.artistSort);
  add('album-sort', metadata.albumSort);
  if (metadata.compilation) add('compilation', '1');

  const trackNum = clean(metadata.trackNumber);
  const trackTotal = clean(metadata.trackTotal);
  if (trackNum) add('track', trackTotal ? `${trackNum}/${trackTotal}` : trackNum);

  const discNum = clean(metadata.discNumber);
  const discTotal = clean(metadata.discTotal);
  if (discNum) add('disc', discTotal ? `${discNum}/${discTotal}` : discNum);

  return tags;
}

function uniqueTempOutput(inputPath) {
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  return path.join(dir, `.${base}.mmu-${process.pid}-${Date.now()}${ext}`);
}

function writeMetadata({ inputPath, outputPath, replaceOriginal = false, metadata = {}, artwork = {} }) {
  const ext = ensureAudioPath(inputPath);
  const out = replaceOriginal ? uniqueTempOutput(inputPath) : outputPath;
  if (!out || typeof out !== 'string' || !path.isAbsolute(out)) throw new Error('Choose a valid output path.');
  if (!replaceOriginal && path.resolve(out) === path.resolve(inputPath)) throw new Error('Choose a different file name, or select “Replace the original” in MMU.');
  if (path.extname(out).toLowerCase() !== ext) throw new Error('MMU saves using the original file format so the audio can be copied without quality loss.');

  const action = artwork.action || 'keep';
  if (action === 'replace' && !ARTWORK_OUTPUT_EXTENSIONS.has(ext)) {
    throw new Error(`Replacing embedded artwork is not supported for ${ext} files. Metadata can still be saved.`);
  }
  if (action === 'replace' && (!artwork.path || !fs.existsSync(artwork.path))) throw new Error('The selected artwork file could not be found.');

  const args = ['-y', '-v', 'error', '-i', inputPath];
  if (action === 'replace') args.push('-i', artwork.path);

  args.push('-map', '0:a:0');
  if (action === 'keep') args.push('-map', '0:v?');
  if (action === 'replace') args.push('-map', '1:v:0');

  args.push('-c:a', 'copy');
  if (action === 'keep') args.push('-c:v', 'copy');
  if (action === 'replace') {
    const artExt = path.extname(artwork.path || '').toLowerCase();
    args.push('-c:v', artExt === '.png' ? 'png' : 'mjpeg');
    args.push('-disposition:v:0', 'attached_pic');
  }

  args.push('-map_metadata', '-1');
  const tags = buildMetadataTags(metadata);
  for (const [key, value] of Object.entries(tags)) args.push('-metadata', `${key}=${value}`);

  if (action === 'replace' && ext === '.mp3') {
    args.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)', '-id3v2_version', '3');
  } else if (ext === '.mp3') {
    args.push('-id3v2_version', '3');
  }
  args.push(out);

  const result = spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (result.error) throw new Error(`Could not run ffmpeg: ${result.error.message}`);
  if (result.status !== 0) {
    try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch (_) {}
    throw new Error(result.stderr || 'ffmpeg could not save the metadata.');
  }

  if (replaceOriginal) {
    const backup = path.join(os.tmpdir(), `mmu-backup-${Date.now()}-${path.basename(inputPath)}`);
    try {
      fs.renameSync(inputPath, backup);
      fs.renameSync(out, inputPath);
      fs.unlinkSync(backup);
    } catch (error) {
      try {
        if (!fs.existsSync(inputPath) && fs.existsSync(backup)) fs.renameSync(backup, inputPath);
      } catch (_) {}
      try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch (_) {}
      throw error;
    }
    return { outputPath: inputPath, replacedOriginal: true, tagsWritten: Object.keys(tags).length };
  }

  return { outputPath: out, replacedOriginal: false, tagsWritten: Object.keys(tags).length };
}


function probePlaylistEntry(filePath) {
  const ext = ensureAudioPath(filePath);
  const result = spawnSync(FFPROBE, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_entries', 'format=duration:format_tags=title,artist,album',
    filePath
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true });

  if (result.error) throw new Error(`Could not run ffprobe: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr || `Could not read ${path.basename(filePath)}.`);

  const data = JSON.parse(result.stdout || '{}');
  const tags = lowerTagMap((data.format || {}).tags || {});
  return {
    filePath,
    fileName: path.basename(filePath),
    extension: ext,
    duration: Number((data.format || {}).duration || 0),
    title: first(tags, ['title']),
    artist: first(tags, ['artist']),
    album: first(tags, ['album'])
  };
}

function playlistDisplayTitle(entry = {}) {
  const title = clean(entry.title);
  const artist = clean(entry.artist);
  if (artist && title) return `${artist} - ${title}`;
  if (title) return title;
  const fileName = clean(entry.fileName) || path.basename(clean(entry.filePath));
  return path.basename(fileName, path.extname(fileName)) || 'Untitled track';
}

function normalizeDevicePath(value) {
  let root = String(value || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!root) throw new Error('Enter the folder where the songs are stored on your Rockbox device, such as /Music.');
  if (!root.startsWith('/')) root = `/${root}`;
  if (root.length > 1) root = root.replace(/\/$/, '');
  if (root.includes('/../') || root.endsWith('/..') || root.includes('/./') || root.endsWith('/.')) {
    throw new Error('The Rockbox song path cannot contain . or .. path segments.');
  }
  return root;
}

function playlistPathForOutput(filePath, outputPath, pathMode = 'relative', devicePath = '') {
  const absolute = path.resolve(filePath);
  if (pathMode === 'absolute') return absolute.replace(/\\/g, '/');
  if (pathMode === 'device') {
    const root = normalizeDevicePath(devicePath);
    const fileName = path.basename(absolute).replace(/\\/g, '/');
    return root === '/' ? `/${fileName}` : `${root}/${fileName}`;
  }
  const relative = path.relative(path.dirname(outputPath), absolute);
  const usable = relative && !path.isAbsolute(relative) ? relative : absolute;
  return usable.replace(/\\/g, '/');
}

function writePlaylist({ outputPath, entries = [], playlistName = 'My Playlist', pathMode = 'relative', devicePath = '' }) {
  if (!outputPath || typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) throw new Error('Choose a valid playlist output path.');
  if (path.extname(outputPath).toLowerCase() !== '.m3u8') throw new Error('Playlist files must use the .m3u8 extension.');
  if (!Array.isArray(entries) || !entries.length) throw new Error('Add at least one song before saving the playlist.');

  const normalizedMode = ['relative', 'device', 'absolute'].includes(pathMode) ? pathMode : 'relative';
  const normalizedDevicePath = normalizedMode === 'device' ? normalizeDevicePath(devicePath) : '';

  const checked = entries.map((entry) => {
    if (!entry || typeof entry.filePath !== 'string') throw new Error('One playlist item is missing its file path.');
    ensureAudioPath(entry.filePath);
    return entry;
  });

  const safeLine = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
  const lines = ['#EXTM3U'];
  const name = safeLine(playlistName);
  if (name) lines.push(`#PLAYLIST:${name}`);

  for (const entry of checked) {
    const duration = Number.isFinite(Number(entry.duration)) && Number(entry.duration) >= 0 ? Math.round(Number(entry.duration)) : -1;
    lines.push(`#EXTINF:${duration},${safeLine(playlistDisplayTitle(entry))}`);
    lines.push(playlistPathForOutput(entry.filePath, outputPath, normalizedMode, normalizedDevicePath));
  }

  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
  return {
    outputPath,
    tracksWritten: checked.length,
    pathMode: normalizedMode,
    devicePath: normalizedDevicePath
  };
}

function imageDataUrl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Artwork file not found.');
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const data = fs.readFileSync(filePath);
  if (data.length > 20 * 1024 * 1024) throw new Error('Artwork is too large (20 MB maximum).');
  return `data:${mime};base64,${data.toString('base64')}`;
}

module.exports = {
  AUDIO_EXTENSIONS,
  probe,
  probePlaylistEntry,
  writeMetadata,
  writePlaylist,
  imageDataUrl
};
