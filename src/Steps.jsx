import { useState } from 'react';
import { CheckIcon, ChevronIcon, CloseIcon } from './icons';

// Steps lists what the assistant did while answering: searches, pages read,
// code run, images made. Each finished step can be opened for details.
export default function Steps({ steps }) {
  const running = steps.some((s) => s.status === 'running');
  const [open, setOpen] = useState(false);
  const shown = open || running ? steps : steps.slice(-1);

  return (
    <div className="steps">
      {steps.length > 1 && !running && (
        <button className="steps-toggle" onClick={() => setOpen(!open)}>
          <ChevronIcon size={14} /> {open ? 'Hide steps' : `${steps.length} steps`}
        </button>
      )}
      {shown.map((s) => (
        <Step key={s.id} step={s} />
      ))}
    </div>
  );
}

function Step({ step }) {
  const [open, setOpen] = useState(false);
  const details = step.detail || step.code || step.output;

  return (
    <div className={`step ${step.status}`}>
      <button className="step-row" onClick={() => details && setOpen(!open)} disabled={!details}>
        <span className="step-icon">
          {step.status === 'running' ? <span className="spinner" /> : step.status === 'error' ? <CloseIcon size={12} /> : <CheckIcon size={12} />}
        </span>
        <span className="step-label">{step.label}</span>
        {details && <ChevronIcon size={13} />}
      </button>
      {open && (
        <div className="step-details">
          {step.code && <pre>{step.code}</pre>}
          {step.output && <pre className="output">{step.output}</pre>}
          {step.detail && <p>{step.detail}</p>}
        </div>
      )}
    </div>
  );
}
