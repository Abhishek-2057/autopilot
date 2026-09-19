import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Power, Play, CheckCircle2, Clock, LogOut, RefreshCw } from 'lucide-react';
import { isSetup, setupPassword, verifyLogin, isLoggedIn, logout } from './lib/auth';
import { loadState, saveState, State } from './lib/store';
import { requestAccessToken, getEmail, listDriveVideos, downloadBlob, uploadToYouTube, DriveFile } from './lib/google';
import { generateMetadata } from './lib/ai';

function todayStr(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
function nowHM(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  } catch {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function Gate({ mode, onDone }: { mode: 'setup' | 'login'; onDone: () => void }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: any) => {
    e.preventDefault(); setErr('');
    if (!id || !pw) return setErr('ID + password dono bharo');
    if (mode === 'setup') { await setupPassword(id, pw); onDone(); }
    else if (await verifyLogin(id, pw)) onDone();
    else setErr('Wrong ID or password');
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="card p-8 w-full max-w-sm grid gap-3">
        <div className="flex items-center gap-2"><Send className="text-emerald-600" /><h1 className="text-2xl font-bold">Shorts AutoPilot</h1></div>
        <p className="text-sm text-slate-500">{mode === 'setup' ? 'Pehli baar? Apna ID + password set karo' : 'Apne ID + password se login karo'}</p>
        <input className="input" placeholder="ID" value={id} onChange={(e) => setId(e.target.value)} />
        <input className="input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <div className="text-red-600 text-sm">{err}</div>}
        <button className="btn-primary">{mode === 'setup' ? 'Set Password' : 'Login'}</button>
      </form>
    </div>
  );
}

export default function App() {
  const [gate, setGate] = useState<'setup' | 'login' | null>(() => (!isSetup() ? 'setup' : !isLoggedIn() ? 'login' : null));
  const [st, setSt] = useState<State>(() => loadState());
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [pct, setPct] = useState(0);
  const busyRef = useRef(false);
  const stRef = useRef(st);
  stRef.current = st;

  const persist = (s: State) => { setSt(s); saveState(s); };
  const needReconnect = (e: any) => (e as any)?.code === 401;

  const refreshList = useCallback(async (token: string, folderId: string) => {
    const list = await listDriveVideos(token, folderId);
    setFiles(list);
    return list;
  }, []);

  const uploadOne = useCallback(async (source: 'auto' | 'manual') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(source === 'manual' ? 'Uploading…' : 'Auto uploading…');
    setPct(0);
    try {
      const s = stRef.current;
      const list = await refreshList(s.googleToken, s.settings.folderId);
      const done = new Set(s.uploaded.map((u) => u.fileId));
      const next = list.find((f) => !done.has(f.id));
      if (!next) { setMsg('No new videos found in your Google Drive folder.'); return; }
      const meta = await generateMetadata({
        groqKey: s.settings.groqKey, model: s.settings.groqModel,
        niche: s.settings.channelNiche, defaultHashtags: s.settings.defaultHashtags,
        fileNum: String(next.num > 1000000 ? next.name : next.num),
      });
      setMsg(`Uploading ${next.name}…`);
      const blob = await downloadBlob(s.googleToken, next.id);
      const youtubeId = await uploadToYouTube(s.googleToken, blob, {
        title: meta.title,
        description: `${meta.description}\n\n${meta.hashtags.join(' ')}`,
        tags: meta.tags, visibility: s.settings.visibility, categoryId: s.settings.categoryId,
      }, setPct);
      const cur = stRef.current;
      if (!cur.uploaded.some((u) => u.fileId === next.id)) {
        const today = todayStr(cur.settings.timezone);
        persist({
          ...cur,
          uploaded: [...cur.uploaded, { fileId: next.id, name: next.name, youtubeId, title: meta.title, at: new Date().toISOString() }],
          day: today, dayCount: cur.day === today ? cur.dayCount + 1 : 1, lastError: '',
        });
      }
      setMsg(`Uploaded: ${meta.title} ✓`);
      refreshList(stRef.current.googleToken, stRef.current.settings.folderId).catch(() => {});
    } catch (e: any) {
      if (needReconnect(e)) {
        const cur = { ...stRef.current, googleToken: '', lastError: e.message };
        persist(cur);
        setMsg(e.message);
      } else {
        const cur = { ...stRef.current, lastError: e.message };
        persist(cur);
        setMsg('Error: ' + e.message);
      }
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  }, [refreshList]);

  // In-tab scheduler — tab khula rahega tab tak har 30s check. (Backend ke bina browser-band upload possible nahi.)
  useEffect(() => {
    if (gate) return;
    const t = setInterval(() => {
      const s = stRef.current;
      if (!s.enabled || !s.googleToken || !s.settings.folderId || busyRef.current) return;
      const today = todayStr(s.settings.timezone);
      const count = s.day === today ? s.dayCount : 0;
      if (count >= s.settings.videosPerDay) return;
      if (nowHM(s.settings.timezone) < s.settings.uploadTime) return;
      uploadOne('auto');
    }, 30 * 1000);
    return () => clearInterval(t);
  }, [gate, uploadOne]);

  useEffect(() => {
    if (gate) return;
    const s = stRef.current;
    if (s.googleToken && s.settings.folderId) refreshList(s.googleToken, s.settings.folderId).catch((e) => {
      if (needReconnect(e)) persist({ ...stRef.current, googleToken: '' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate]);

  if (gate) return <Gate mode={gate} onDone={() => setGate(null)} />;

  const s = st;
  const doneSet = new Set(s.uploaded.map((u) => u.fileId));
  const ytOf = new Map(s.uploaded.map((u) => [u.fileId, u.youtubeId]));
  const next = files.find((f) => !doneSet.has(f.id));
  const set = (k: string, v: any) => persist({ ...s, settings: { ...s.settings, [k]: v } });

  const connect = async () => {
    if (!s.settings.googleClientId.trim()) return setMsg('Pehle Google Client ID dalo (neeche settings me) aur Save karo.');
    setBusy('Connecting…');
    try {
      const token = await requestAccessToken(s.settings.googleClientId.trim());
      const email = await getEmail(token).catch(() => '');
      persist({ ...stRef.current, googleToken: token, email, lastError: '' });
      setMsg('Google connected ✓');
      refreshList(token, stRef.current.settings.folderId).catch((e) => setMsg('Error: ' + e.message));
    } catch (e: any) {
      setMsg('Error: ' + e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 grid gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Send className="text-emerald-600" /><h1 className="text-xl font-bold">Shorts AutoPilot</h1></div>
        <button className="btn-ghost text-sm flex items-center gap-1" onClick={() => { logout(); setGate('login'); }}>
          <LogOut size={14} /> Logout
        </button>
      </div>

      {msg && <div className="card p-3 text-sm">{msg}{busy && pct > 0 && ` — ${pct}%`}</div>}
      {s.lastError && <div className="card p-3 text-sm text-red-600">{s.lastError}</div>}

      <div className="card p-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="font-semibold">AutoPilot is <span className={s.enabled ? 'text-emerald-600' : 'text-slate-400'}>{s.enabled ? 'ON' : 'OFF'}</span></div>
            <div className="text-sm text-slate-500">
              {s.googleToken ? `Google: ${s.email || 'connected'} ✓` : 'Google not connected'} · Aaj: {s.dayCount}/{s.settings.videosPerDay} · Total: {s.uploaded.length}
            </div>
            {next && <div className="text-sm mt-1">Next up: <b>{next.name}</b></div>}
            <div className="text-xs text-amber-600 mt-1">Note: auto-upload ke liye ye tab khula rakho (frontend-only app).</div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!s.googleToken && <button className="btn-primary text-sm" onClick={connect} disabled={!!busy}>Connect Google</button>}
            <button onClick={() => persist({ ...s, enabled: !s.enabled })} className={`rounded-xl px-5 py-2 font-bold text-white flex items-center gap-1 ${s.enabled ? 'bg-emerald-600' : 'bg-slate-400'}`}>
              <Power size={14} /> {s.enabled ? 'ON' : 'OFF'}
            </button>
            <button onClick={() => uploadOne('manual')} disabled={!!busy || !s.googleToken} className="btn-ghost text-sm flex items-center gap-1 disabled:opacity-50">
              <Play size={14} /> {busy || 'Upload Next Now'}
            </button>
          </div>
        </div>
      </div>

      <div className="card p-5 grid gap-3">
        <h3 className="font-semibold">Settings</h3>
        <label className="text-sm">Google Client ID (OAuth — public hota hai, safe)
          <input className="input mt-1" value={s.settings.googleClientId} onChange={(e) => set('googleClientId', e.target.value)} placeholder="xxxx.apps.googleusercontent.com" />
        </label>
        <label className="text-sm">Groq API Key (sirf tumhare browser me rehti hai)
          <input className="input mt-1" type="password" value={s.settings.groqKey} onChange={(e) => set('groqKey', e.target.value)} placeholder="gsk_..." />
        </label>
        <label className="text-sm">Drive Folder ID (folder jisme 1.mp4, 2.mp4… hain)
          <input className="input mt-1" value={s.settings.folderId} onChange={(e) => set('folderId', e.target.value)} placeholder="Drive URL me /folders/ ke baad wala part" />
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <label>Videos/day<input className="input mt-1" type="number" min={1} max={10} value={s.settings.videosPerDay} onChange={(e) => set('videosPerDay', Math.min(10, Math.max(1, Number(e.target.value) || 1)))} /></label>
          <label>Upload time<input className="input mt-1" type="time" value={s.settings.uploadTime} onChange={(e) => set('uploadTime', e.target.value)} /></label>
          <label>Visibility<select className="input mt-1" value={s.settings.visibility} onChange={(e) => set('visibility', e.target.value)}><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label>
          <label>Timezone<input className="input mt-1" value={s.settings.timezone} onChange={(e) => set('timezone', e.target.value)} /></label>
        </div>
        <label className="text-sm">Channel niche<input className="input mt-1" value={s.settings.channelNiche} onChange={(e) => set('channelNiche', e.target.value)} /></label>
        <label className="text-sm">Default hashtags (comma se)<input className="input mt-1" value={s.settings.defaultHashtags.join(', ')} onChange={(e) => set('defaultHashtags', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></label>
        <div className="flex gap-2">
          <button className="btn-ghost text-sm flex items-center gap-1" onClick={() => s.googleToken && s.settings.folderId && refreshList(s.googleToken, s.settings.folderId).then(() => setMsg('Videos refreshed ✓')).catch((e: any) => setMsg('Error: ' + e.message))}>
            <RefreshCw size={14} /> Refresh Videos
          </button>
          <span className="text-xs text-slate-500 self-center">Settings auto-save hoti hain.</span>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold mb-2">Drive videos (upload order)</h3>
        {files.length === 0 && <p className="text-sm text-slate-500">Client ID + Folder ID dal ke Connect Google karo — 1.mp4, 2.mp4… yahi dikhenge.</p>}
        {files.map((f) => (
          <div key={f.id} className="flex justify-between text-sm py-1.5 border-b last:border-0">
            <span><b className="text-slate-400 mr-2">#{f.num > 1000000 ? '–' : f.num}</b>{f.name}</span>
            {doneSet.has(f.id)
              ? <a className="badge bg-emerald-50 text-emerald-700" target="_blank" rel="noreferrer" href={`https://youtu.be/${ytOf.get(f.id)}`}><CheckCircle2 size={12} /> Uploaded →</a>
              : <span className="badge bg-amber-50 text-amber-700"><Clock size={12} /> Queued</span>}
          </div>
        ))}
      </div>

      {s.uploaded.length > 0 && (
        <div className="card p-5">
          <h3 className="font-semibold mb-2">Recent uploads</h3>
          {[...s.uploaded].reverse().slice(0, 10).map((u) => (
            <div key={u.fileId} className="text-sm py-1.5 border-b last:border-0 flex justify-between gap-2">
              <span className="truncate">{u.title}</span>
              <a className="text-emerald-700 shrink-0" target="_blank" rel="noreferrer" href={`https://youtu.be/${u.youtubeId}`}>Watch →</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
