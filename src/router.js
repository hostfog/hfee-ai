import { useEffect, useState } from 'react';

// A tiny history-based router: the app has only a handful of pages.

export function navigate(path) {
  if (path === window.location.pathname) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return path;
}

// match returns the route name and its id, e.g. "/c/abc" -> { page: 'chat', id: 'abc' }.
export function match(path) {
  const [, first, id] = path.split('/');
  switch (first) {
    case 'c':
      return { page: 'chat', id };
    case 'p':
      return { page: 'project', id };
    case 'share':
      return { page: 'share', id };
    case 'images':
      return { page: 'images' };
    case 'admin':
      return { page: 'admin' };
    default:
      return { page: 'chat', id: null };
  }
}
