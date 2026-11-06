import { useRef, useState } from 'react';

// useRecorder records from the microphone and sends the audio to the server
// for transcription. onText receives the recognised text.
export function useRecorder(onText, onError) {
  const [state, setState] = useState('idle'); // idle | recording | working
  const recorder = useRef(null);

  async function start() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError('Microphone access was blocked');
      return;
    }

    const chunks = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setState('working');
      try {
        const res = await fetch('/api/voice/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Blob(chunks, { type: rec.mimeType }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (data.text) onText(data.text);
      } catch (err) {
        onError(err.message || "Couldn't understand the recording");
      } finally {
        setState('idle');
      }
    };
    rec.start();
    recorder.current = rec;
    setState('recording');
  }

  function stop() {
    recorder.current?.stop();
  }

  return { state, start, stop };
}
