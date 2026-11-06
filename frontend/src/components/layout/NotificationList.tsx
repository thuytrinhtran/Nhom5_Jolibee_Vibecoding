import { useEffect, useState } from 'react';
import { authorized } from '../../services/auth.service';

interface Notification { id: string; title: string; content: string; created_at: string }

export function NotificationList({ userId }: { userId: string }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    setItems([]); setLoading(true); setError(false);
    const load = async () => {
      const current = ++sequence;
      try {
        const data = await authorized('', {}, '/notifications');
        if (!Array.isArray(data.result)) throw Error('Invalid notifications');
        if (active && current === sequence) { setItems(data.result); setError(false); }
      } catch { if (active && current === sequence) { setItems([]); setError(true); } }
      finally { if (active && current === sequence) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 30000);
    const focus = () => { void load(); };
    window.addEventListener('focus', focus);
    window.addEventListener('jollishift:data-changed', focus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', focus); window.removeEventListener('jollishift:data-changed', focus); };
  }, [userId, refresh]);
  return <><h2>Thông báo</h2>
    {loading ? <p role="status">Đang tải thông báo…</p> : error ? <p role="status">Chưa tải được thông báo. <button onClick={() => setRefresh(x => x + 1)}>Thử lại</button></p> : items.length === 0 ? <p>Chưa có thông báo.</p> :
      <ul style={{ listStyle: 'none', padding: 0, maxHeight: '60vh', overflowY: 'auto' }}>{items.map(item => <li key={item.id} style={{ padding: '10px 0', borderBottom: '1px solid #eee' }}><strong>{item.title}</strong><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.content}</p><small>{new Date(item.created_at).toLocaleString('vi-VN')}</small></li>)}</ul>}
  </>;
}
