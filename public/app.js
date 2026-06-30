const e = React.createElement;
const { useState, useEffect } = React;

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));

  if (!token) return e('div', { className: 'container' }, e(Auth, { onAuth: (t, u) => { setToken(t); setUser(u); localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); } }));
  return e('div', { className: 'container' }, e(Dashboard, { token, user, onLogout: () => { localStorage.removeItem('token'); localStorage.removeItem('user'); setToken(null); setUser(null); } }));
}

function Auth({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    try {
      if (mode === 'login') {
        const res = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || 'Login failed');
        onAuth(j.token, j.user);
      } else {
        const res = await fetch('/api/auth/register', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name }) });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || 'Register failed');
        setMode('login');
      }
    } catch (e) { setErr(e.message); }
  }

  return e('div', { className: 'auth-card card' },
    e('div', { className: 'brand', style: { justifyContent: 'center', marginBottom: 12 } },
      e('div', { className: 'logo' }, 'DP'),
      e('div', { className: 'title' }, 'Document Portal')
    ),
    e('h2', { style: { textAlign: 'center', marginTop: 0 } }, mode === 'login' ? 'Login' : 'Register'),
    err && e('div', { className: 'error' }, err),
    e('div', { className: 'form-row' }, e('input', { className: 'input', placeholder: 'Email', value: email, onChange: (ev) => setEmail(ev.target.value) })),
    e('div', { className: 'form-row' }, e('input', { className: 'input', type: 'password', placeholder: 'Password', value: password, onChange: (ev) => setPassword(ev.target.value) })),
    mode === 'register' && e('div', { className: 'form-row' }, e('input', { className: 'input', placeholder: 'Name', value: name, onChange: (ev) => setName(ev.target.value) })),
    e('div', { style: { display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 } },
      e('button', { className: 'btn btn-primary', onClick: submit }, mode === 'login' ? 'Login' : 'Register'),
      e('button', { className: 'btn', onClick: () => setMode(mode === 'login' ? 'register' : 'login') }, mode === 'login' ? 'Switch to Register' : 'Switch to Login')
    ),
    null
  );
}

function Dashboard({ token, user, onLogout }) {
  const [docs, setDocs] = useState([]);
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { fetchDocs(); }, []);

  async function fetchDocs() {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch('/api/documents', { credentials: 'include', headers });
    const j = await res.json();
    setDocs(j);
  }

  async function upload() {
    if (!file) return setMsg('Pick a file');
    const fd = new FormData();
    fd.append('file', file);
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch('/api/documents/upload', { method: 'POST', credentials: 'include', headers, body: fd });
    const j = await res.json();
    if (!res.ok) return setMsg(j.error || 'Upload failed');
    setMsg('Uploaded');
    setFile(null);
    fetchDocs();
  }

  async function deleteDoc(id) {
    setMsg('');
    try {
      const headers = {};
      if (token) headers.Authorization = 'Bearer ' + token;
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE', credentials: 'include', headers });
      const j = await res.json();
      if (!res.ok) return setMsg(j.error || 'Delete failed');
      setMsg('Deleted');
      fetchDocs();
    } catch (e) {
      setMsg('Error deleting file');
    }
  }

  function viewDoc(id) {
    const url = `/api/documents/${id}/download`;
    window.open(url, '_blank');
  }

  function downloadDoc(id, filename) {
    const url = `/api/documents/${id}/download?download=1`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'file';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return e('div', null,
    e('div', { className: 'dashboard-top' },
      e('div', { className: 'brand' }, e('div', { className: 'logo' }, 'DP'), e('div', { className: 'title' }, `Welcome ${user?.name || user?.email}`)),
      e('div', null, e('button', { className: 'btn', onClick: onLogout }, 'Logout'))
    ),
    e('div', { className: 'card' },
      e('div', { className: 'upload-row' },
        e('input', { type: 'file', onChange: (e) => setFile(e.target.files[0]) }),
        e('button', { className: 'btn btn-primary', onClick: upload }, 'Upload')
      ),
      msg && e('div', { className: msg.startsWith('Uploaded') ? 'msg' : 'error' }, msg),
      e('h3', { style: { marginTop: 18 } }, 'Your documents'),
      docs.length === 0 && e('div', { className: 'muted' }, 'No documents yet'),
      e('div', { className: 'doc-list' }, docs.map(d => e('div', { key: d.id, className: 'doc-item' },
        e('div', { className: 'doc-title' }, d.originalName),
        e('div', { className: 'small muted' }, `Uploaded: ${new Date(d.createdAt).toLocaleString()}`),
        e('div', { className: 'links', style: { marginTop: 8 } },
            e('button', { className: 'btn', onClick: () => viewDoc(d.id) }, 'View'),
            e('button', { className: 'btn', onClick: () => downloadDoc(d.id, d.originalName) }, 'Download'),
            e('button', { className: 'btn', onClick: () => deleteDoc(d.id) }, 'Delete')
        )
      )))
    )
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(e(App));
