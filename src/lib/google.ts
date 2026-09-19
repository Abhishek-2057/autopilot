// Google Drive + YouTube, seedha browser se (Google Identity Services + REST).
// Koi backend nahi — token browser memory me rehta hai (~1 hr), expire pe Reconnect dabao.

declare global {
  interface Window {
    google?: any;
  }
}

export const SCOPES =
  'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/userinfo.email';

export interface DriveFile {
  id: string;
  name: string;
  num: number;
  mimeType?: string;
}

export function numOf(name: string): number {
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

function expired(): Error {
  return Object.assign(new Error('Google session expired. Click Reconnect.'), { code: 401 });
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google script load nahi hua. Internet check karo.'));
    document.head.appendChild(s);
  });
}

export function requestAccessToken(clientId: string): Promise<string> {
  return (async () => {
    await loadGis();
    return new Promise<string>((resolve, reject) => {
      try {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: (resp: any) => {
            if (resp?.access_token) resolve(resp.access_token);
            else reject(new Error('Google login cancel/fail hua.'));
          },
        });
        client.requestAccessToken({ prompt: 'consent' });
      } catch (e) {
        reject(e);
      }
    });
  })();
}

export async function getEmail(token: string): Promise<string> {
  const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401) throw expired();
  const j = await r.json();
  return j.email || '';
}

export async function listDriveVideos(token: string, folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(
    `'${folderId}' in parents and trashed=false and (mimeType contains 'video/' or name contains '.mp4' or name contains '.mov' or name contains '.webm' or name contains '.mkv')`
  );
  let files: any[] = [];
  let pageToken = '';
  do {
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType),nextPageToken&pageSize=200&orderBy=name` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) throw expired();
    if (!r.ok) throw new Error('Drive list fail: ' + r.status);
    const j = await r.json();
    files = files.concat(j.files || []);
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return files
    .filter((f) => /\.(mp4|mov|webm|mkv)$/i.test(f.name || '') || (f.mimeType || '').startsWith('video/'))
    .map((f) => ({ id: f.id, name: f.name, num: numOf(f.name || ''), mimeType: f.mimeType }))
    .sort((a, b) => a.num - b.num || a.name.localeCompare(b.name));
}

export async function downloadBlob(token: string, fileId: string): Promise<Blob> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401) throw expired();
  if (!r.ok) throw new Error('Drive download fail: ' + r.status);
  return await r.blob();
}

export interface YtMeta {
  title: string;
  description: string;
  tags: string[];
  visibility: string;
  categoryId: string;
}

// YouTube resumable upload, seedha browser se (progress ke saath)
export async function uploadToYouTube(
  token: string,
  blob: Blob,
  meta: YtMeta,
  onProgress?: (pct: number) => void
): Promise<string> {
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': blob.type || 'video/mp4',
    },
    body: JSON.stringify({
      snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: meta.categoryId || '22' },
      status: { privacyStatus: meta.visibility },
    }),
  });
  if (init.status === 401) throw expired();
  if (!init.ok) throw new Error('YouTube start fail: ' + (await init.text()).slice(0, 200));
  const sessionUrl = init.headers.get('Location');
  if (!sessionUrl) throw new Error('YouTube session nahi mila.');

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUrl);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && j.id) resolve(j.id);
        else reject(new Error('Upload fail: ' + xhr.status + ' ' + xhr.responseText.slice(0, 200)));
      } catch {
        reject(new Error('Upload fail: ' + xhr.status));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(blob);
  });
}
