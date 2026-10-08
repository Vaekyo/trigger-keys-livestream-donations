import { exitTrace } from './traceApi';

export default function TraceStudio() {
  return (
    <div className="trace-studio">
      <button type="button" onClick={exitTrace}>Back</button>
    </div>
  );
}
