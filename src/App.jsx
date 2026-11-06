import { useCallback, useEffect, useState } from 'react';
import { request } from './api';
import { match, navigate, usePath } from './router';
import Auth from './Auth';
import Shell from './Shell';
import ChatView from './ChatView';
import ProjectView from './ProjectView';
import Gallery from './Gallery';
import Admin from './Admin';
import Settings from './Settings';
import SharedChat from './SharedChat';
import { HFMark } from './icons';

export default function App() {
  const route = match(usePath());
  const [user, setUser] = useState(undefined); // undefined while checking the session

  useEffect(() => {
    if (route.page === 'share') return;
    request('/auth/me')
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null));
  }, []);

  async function signOut() {
    await request('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    navigate('/');
  }

  if (route.page === 'share') return <SharedChat shareId={route.id} />;
  if (user === undefined) return <Splash />;
  if (!user) return <Auth onSignedIn={setUser} />;
  return <SignedIn key={user.id} user={user} route={route} onSignOut={signOut} />;
}

function Splash() {
  return (
    <div className="auth">
      <HFMark size={44} />
    </div>
  );
}

function SignedIn({ user, route, onSignOut }) {
  const [config, setConfig] = useState(null);
  const [chats, setChats] = useState([]);
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadChats = useCallback(() => {
    request(`/chats${query ? `?q=${encodeURIComponent(query)}` : ''}`)
      .then(({ chats }) => setChats(chats))
      .catch(() => {});
  }, [query]);

  const loadProjects = useCallback(() => {
    request('/account/projects')
      .then(({ projects }) => setProjects(projects))
      .catch(() => {});
  }, []);

  useEffect(() => {
    request('/config').then(setConfig).catch(onSignOut);
    loadProjects();
  }, []);

  useEffect(() => {
    const t = setTimeout(loadChats, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadChats]);

  if (!config) return <Splash />;

  const project = route.page === 'project' ? projects.find((p) => p.id === route.id) : null;

  let page;
  switch (route.page) {
    case 'images':
      page = <Gallery />;
      break;
    case 'admin':
      page = user.role === 'admin' ? <Admin /> : null;
      break;
    case 'project':
      page = project && (
        <div className="project-page">
          <ProjectView key={route.id} projectId={route.id} onChanged={loadProjects} />
          <ChatView key={`p-${route.id}`} project={project} user={user} config={config} onChatsChanged={loadChats} onSignOut={onSignOut} />
        </div>
      );
      break;
    default:
      page = (
        <ChatView
          chatId={route.id}
          user={user}
          config={config}
          onChatsChanged={loadChats}
          onSignOut={onSignOut}
        />
      );
  }

  return (
    <Shell
      user={user}
      route={route}
      chats={chats}
      projects={projects}
      query={query}
      onQuery={setQuery}
      onChatsChanged={loadChats}
      onProjectsChanged={loadProjects}
      onSettings={() => setSettingsOpen(true)}
      onSignOut={onSignOut}
      features={config.features}
    >
      {page}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </Shell>
  );
}
