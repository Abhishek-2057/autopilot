import cfg from '../app-config.json';

// All app data lives in the BROWSER (localStorage) — no server, no database.
// Uploaded file IDs yahi save hote hain, taaki dobara upload kabhi na ho.
export interface UploadedEntry {
  fileId: string;
  name: string;
  youtubeId: string;
  title: string;
  at: string;
}

export interface Settings {
  googleClientId: string;
  groqKey: string;
  groqModel: string;
  folderId: string;
  videosPerDay: number;
  uploadTime: string;
  timezone: string;
  visibility: 'public' | 'unlisted' | 'private';
  channelNiche: string;
  defaultHashtags: string[];
  categoryId: string;
}

export interface State {
  googleToken: string;
  email: string;
  enabled: boolean;
  settings: Settings;
  uploaded: UploadedEntry[];
  day: string;
  dayCount: number;
  lastError: string;
}

const KEY = 'saw-state-v1';

function defaults(): State {
  return {
    googleToken: '',
    email: '',
    enabled: false,
    settings: {
      googleClientId: (cfg as any).googleClientId || '',
      groqKey: '',
      groqModel: (cfg as any).groqModel || 'openai/gpt-oss-20b',
      folderId: '',
      videosPerDay: (cfg as any).videosPerDay || 1,
      uploadTime: (cfg as any).uploadTime || '19:00',
      timezone: (cfg as any).timezone || 'Asia/Kolkata',
      visibility: (cfg as any).visibility || 'public',
      channelNiche: (cfg as any).channelNiche || 'Luxury lifestyle',
      defaultHashtags: (cfg as any).defaultHashtags || ['#shorts', '#luxury'],
      categoryId: (cfg as any).categoryId || '22',
    },
    uploaded: [],
    day: '',
    dayCount: 0,
    lastError: '',
  };
}

export function loadState(): State {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const d = defaults();
    return { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };
  } catch {
    return defaults();
  }
}

export function saveState(s: State): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
