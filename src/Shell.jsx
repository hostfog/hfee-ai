import { useState } from 'react';
import { request } from './api';
import { navigate } from './router';
import {
  ChatIcon, CloseIcon, FolderIcon, HFMark, ImageIcon, MenuIcon, PencilIcon, PlusIcon,
  SearchIcon, SettingsIcon, ShieldIcon, TrashIcon,
} from './icons';

// Shell is the frame around every signed-in page: top bar and sidebar.
export default function Shell({ user, route, chats, projects, query, onQuery, onChatsChanged, onProjectsChanged, onSettings, onSignOut, features, desktop, children }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(null);

  const go = (path) => {
    navigate(path);
    setOpen(false);
  };

  async function rename(id, title) {
    setRenaming(null);
    if (!title.trim()) return;
    await request(`/chats/${id}`, { method: 'PATCH', body: { title } });
    onChatsChanged();
  }

  async function remove(id) {
    if (!confirm('Delete this chat?')) return;
    await request(`/chats/${id}`, { method: 'DELETE' });
    if (route.page === 'chat' && route.id === id) go('/');
    onChatsChanged();
  }

  async function newProject() {
    const name = prompt('Project name');
    if (!name?.trim()) return;
    const p = await request('/account/projects', { method: 'POST', body: { name } });
    onProjectsChanged();
    go(`/p/${p.id}`);
  }

  const title =
    route.page === 'images' ? 'Images'
    : route.page === 'admin' ? 'Admin'
    : route.page === 'project' ? projects.find((p) => p.id === route.id)?.name ?? 'Project'
    : chats.find((c) => c.id === route.id)?.title ?? 'New chat';


  async function quit() {
    await request('/quit', { method: 'POST' }).catch(() => {});
    document.body.innerHTML = '<p class="stopped">HFee AI has stopped. You can close this tab.</p>';
  }

  return (
    <div className="shell">
      <header className="topbar">
        <button className="icon-btn menu" onClick={() => setOpen((v) => !v)} aria-label="Menu">
          <MenuIcon />
        </button>
        <button className="lockup" onClick={() => go('/')}>
          <HFMark />
          <span className="product">HFee</span>
          <span className="badge">AI</span>
        </button>
        <span className="crumb">{title}</span>

        <div className="account">
          <button className="icon-btn" onClick={onSettings} aria-label="Settings" title="Settings">
            <SettingsIcon />
          </button>
          <span className="avatar" title={user.email}>{user.name.charAt(0).toUpperCase()}</span>
          <span className="account-name">{user.name}</span>
          {desktop ? (
            <button className="link" onClick={quit}>Quit</button>
          ) : (
            !user.local && <button className="link" onClick={onSignOut}>Sign out</button>
          )}
        </div>
      </header>

      <div className="body">
        <aside className={`sidebar ${open ? 'open' : ''}`}>
          <button className="new-chat" onClick={() => go('/')}>
            <PlusIcon /> New chat
          </button>

          <label className="sidebar-search">
            <SearchIcon size={15} />
            <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search chats" />
            {query && (
              <button onClick={() => onQuery('')} aria-label="Clear search">
                <CloseIcon size={13} />
              </button>
            )}
          </label>

          <nav className="nav">
            {features.images && (
              <NavItem icon={<ImageIcon />} label="Images" active={route.page === 'images'} onClick={() => go('/images')} />
            )}
            {user.role === 'admin' && (
              <NavItem icon={<ShieldIcon />} label="Admin" active={route.page === 'admin'} onClick={() => go('/admin')} />
            )}
          </nav>

          <div className="group">
            Projects
            <button className="group-add" onClick={newProject} aria-label="New project" title="New project">
              <PlusIcon size={14} />
            </button>
          </div>
          <nav className="nav">
            {projects.map((p) => (
              <NavItem key={p.id} icon={<FolderIcon />} label={p.name} active={route.page === 'project' && route.id === p.id} onClick={() => go(`/p/${p.id}`)} />
            ))}
          </nav>

          {chats.length > 0 && <div className="group">{query ? 'Results' : 'Chats'}</div>}
          <nav className="nav chat-list">
            {chats.map((c) =>
              renaming === c.id ? (
                <input
                  key={c.id}
                  className="rename"
                  defaultValue={c.title}
                  autoFocus
                  onBlur={(e) => rename(c.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.target.blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <NavItem
                  key={c.id}
                  icon={<ChatIcon />}
                  label={c.title}
                  active={route.page === 'chat' && route.id === c.id}
                  onClick={() => go(`/c/${c.id}`)}
                  actions={
                    <>
                      <button onClick={() => setRenaming(c.id)} aria-label="Rename chat" title="Rename">
                        <PencilIcon size={14} />
                      </button>
                      <button onClick={() => remove(c.id)} aria-label="Delete chat" title="Delete">
                        <TrashIcon size={14} />
                      </button>
                    </>
                  }
                />
              ),
            )}
          </nav>

          <div className="sidebar-foot">HostFog Ltd</div>
        </aside>
        {open && <div className="scrim" onClick={() => setOpen(false)} />}

        {children}
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, actions }) {
  return (
    <div className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span className="label">{label}</span>
      {actions && (
        <span className="item-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      )}
    </div>
  );
}
