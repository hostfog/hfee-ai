import { useEffect, useState } from 'react';
import { request } from './api';
import { DownloadIcon, TrashIcon } from './icons';

export default function Gallery() {
  const [images, setImages] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    request('/images').then(({ images }) => setImages(images));
  }, []);

  async function remove(id) {
    if (!confirm('Delete this image?')) return;
    await request(`/images/${id}`, { method: 'DELETE' });
    setImages((list) => list.filter((i) => i.id !== id));
    setOpen(null);
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>Images</h1>
        <p>Pictures you created. Turn on “Create image” in a chat to make more.</p>
      </div>

      {images?.length === 0 && <p className="muted">No images yet.</p>}
      <div className="gallery">
        {images?.map((img) => (
          <button key={img.id} className="tile" onClick={() => setOpen(img)} title={img.prompt}>
            <img src={img.url} alt={img.prompt} loading="lazy" />
          </button>
        ))}
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(null)}>
          <div className="lightbox" onClick={(e) => e.stopPropagation()}>
            <img src={open.url} alt={open.prompt} />
            <p>{open.prompt}</p>
            <div className="row">
              <a className="ghost" href={open.url} download={`hfee-${open.id}.png`}>
                <DownloadIcon size={15} /> Download
              </a>
              <button className="ghost danger" onClick={() => remove(open.id)}>
                <TrashIcon size={15} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
