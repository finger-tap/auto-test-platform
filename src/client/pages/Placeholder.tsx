export default function Placeholder({ title }: { title?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '80px 0', color: '#999' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
      <h2 style={{ fontSize: 20, fontWeight: 500, color: '#666', marginBottom: 8 }}>
        {title || '功能开发中'}
      </h2>
      <p style={{ fontSize: 14 }}>即将上线，敬请期待</p>
    </div>
  );
}
