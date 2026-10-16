import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import './Layout.css';

const navItems = [
  { to: '/', label: 'POC Search', icon: '🔍', end: true },
  { to: '/poc/new', label: 'New POC', icon: '➕' },
  { to: '/holiday', label: 'Holiday Planning', icon: '📅' },
  { to: '/line-master', label: 'Line Master', icon: '🏭' },
  { to: '/capacity', label: 'Capacity Building', icon: '⚙️' },
  { to: '/sewing-orders', label: 'Sewing Order Board', icon: '🧵' },
  { to: '/planning-board', label: 'Planning Board', icon: '📊' },
  { to: '/production-units', label: 'Production Units', icon: '🏷️' },
  { to: '/users', label: 'User Administration', icon: '👤' },
];

export default function Layout({ user, onLogout }) {
  const navigate = useNavigate();

  const handleLogout = () => {
    onLogout();
    navigate('/');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">NP</span>
          <span className="brand-name">NexPlanning</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{(user.fullName || user.username || '?').charAt(0).toUpperCase()}</div>
            <div className="user-meta">
              <div className="user-name">{user.fullName || user.username}</div>
              <div className="user-role">{user.username}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </aside>

      <main className="content-area">
        <Outlet />
      </main>
    </div>
  );
}
