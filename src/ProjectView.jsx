import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { readFile, formatSize, fileExtension } from './files';
import { navigate } from './router';
import { TrashIcon, UploadIcon } from './icons';

// ProjectView edits a project's instructions and files. Every chat started
// in the project gets both.
export default function ProjectView({ projectId, onChanged }) {
  const [project, setProject] = useState(null);
  const [instructions, setInstructions] = useState('');
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  useEffect(() => {
    request(`/account/projects/${projectId}`)
      .then((p) => {
        setProject(p);
        setInstructions(p.instructions);
      })
      .catch((err) => setError(err.message));
  }, [projectId]);

  async function saveInstructions() {
    await request(`/account/projects/${projectId}`, { method: 'PATCH', body: { instructions } });
    setSaved(true);
  }

  async function addFiles(list) {
    setError('');
    for (const file of list) {
      try {
        const f = await readFile(file);
        if (f.kind !== 'text') throw new Error(`${file.name}: projects hold text, code and PDF files`);
        const added = await request(`/account/projects/${projectId}/files`, {
          method: 'POST',
          body: { name: f.name, text: f.text, size: f.size },
        });
        setProject((p) => ({ ...p, files: [...p.files, added] }));
      } catch (err) {
        setError(err.message);
      }
    }
  }

  async function removeFile(id) {
    await request(`/account/projects/${projectId}/files/${id}`, { method: 'DELETE' });
    setProject((p) => ({ ...p, files: p.files.filter((f) => f.id !== id) }));
  }

  async function rename() {
    const name = prompt('Project name', project.name);
    if (!name?.trim()) return;
    await request(`/account/projects/${projectId}`, { method: 'PATCH', body: { name } });
    setProject((p) => ({ ...p, name }));
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete the project "${project.name}"? Its chats are kept.`)) return;
    await request(`/account/projects/${projectId}`, { method: 'DELETE' });
    onChanged();
    navigate('/');
  }

  if (!project) return error ? <div className="notice">{error}</div> : null;

  return (
    <section className="project-panel">
      <div className="project-head">
        <h2>{project.name}</h2>
        <button className="ghost" onClick={rename}>Rename</button>
        <button className="ghost danger" onClick={remove}>Delete</button>
      </div>

      <label className="field">
        Instructions
        <textarea
          value={instructions}
          placeholder="e.g. Answer as a support agent for HF Panel. Keep replies short."
          onChange={(e) => {
            setInstructions(e.target.value);
            setSaved(false);
          }}
          onBlur={saveInstructions}
          rows={3}
        />
        <span className="hint">{saved ? 'Saved' : 'Saving when you click away'}</span>
      </label>

      <div className="field">
        Files
        <div className="project-files">
          {project.files.map((f) => (
            <div key={f.id} className="attachment file">
              <span className="ext">{fileExtension(f.name)}</span>
              <span className="meta">
                <span className="name">{f.name}</span>
                <span className="size">{formatSize(f.size)}</span>
              </span>
              <button className="remove visible" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}>
                <TrashIcon size={12} />
              </button>
            </div>
          ))}
          <button className="add-file" onClick={() => fileInput.current.click()}>
            <UploadIcon size={18} /> Add files
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles([...e.target.files]);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
    </section>
  );
}
